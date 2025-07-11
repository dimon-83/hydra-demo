// Supabase Edge Function: Hydra OIDC 回调处理
// 基于 Supabase 官方第三方身份验证最佳实践

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface OIDCTokenResponse {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
}

interface HydraUserInfo {
  sub: string;
  email: string;
  name?: string;
  preferred_username?: string;
  email_verified?: boolean;
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code) {
      throw new Error('Authorization code not found');
    }

    // 初始化 Supabase 客户端
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Hydra OIDC 配置
    const hydraConfig = {
      tokenEndpoint: Deno.env.get('HYDRA_TOKEN_ENDPOINT') || 'http://localhost:4444/oauth2/token',
      userInfoEndpoint: Deno.env.get('HYDRA_USERINFO_ENDPOINT') || 'http://localhost:4444/userinfo',
      clientId: Deno.env.get('HYDRA_CLIENT_ID') || 'supabase-client',
      clientSecret: Deno.env.get('HYDRA_CLIENT_SECRET') || 'supabase-oidc-secret-2023',
      redirectUri: Deno.env.get('HYDRA_REDIRECT_URI') || `${supabaseUrl}/functions/v1/hydra-oidc-callback`
    };

    console.log('🔄 开始处理 Hydra OIDC 回调', { code: code.substring(0, 10) + '...', state });

    // 步骤 1: 交换授权码获取令牌
    const tokenResponse = await fetch(hydraConfig.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${hydraConfig.clientId}:${hydraConfig.clientSecret}`)}`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: hydraConfig.redirectUri
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('❌ 令牌交换失败:', errorText);
      throw new Error(`Token exchange failed: ${errorText}`);
    }

    const tokens: OIDCTokenResponse = await tokenResponse.json();
    console.log('✅ 令牌交换成功');

    // 步骤 2: 获取用户信息
    const userInfoResponse = await fetch(hydraConfig.userInfoEndpoint, {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`
      }
    });

    if (!userInfoResponse.ok) {
      const errorText = await userInfoResponse.text();
      console.error('❌ 获取用户信息失败:', errorText);
      throw new Error(`UserInfo request failed: ${errorText}`);
    }

    const userInfo: HydraUserInfo = await userInfoResponse.json();
    console.log('✅ 用户信息获取成功:', { sub: userInfo.sub, email: userInfo.email });

    // 步骤 3: 创建或更新 Supabase 用户
    // 使用 Admin API 来创建用户
    const { data: existingUser, error: getUserError } = await supabase.auth.admin.getUserById(userInfo.sub);

    let user;
    if (getUserError && getUserError.message.includes('User not found')) {
      // 创建新用户
      console.log('📝 创建新用户:', userInfo.email);
      
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        id: userInfo.sub,
        email: userInfo.email,
        email_confirm: true,
        user_metadata: {
          name: userInfo.name,
          preferred_username: userInfo.preferred_username,
          provider: 'hydra-oidc',
          email_verified: userInfo.email_verified || false
        },
        app_metadata: {
          provider: 'hydra-oidc',
          providers: ['hydra-oidc']
        }
      });

      if (createError) {
        console.error('❌ 创建用户失败:', createError);
        throw createError;
      }

      user = newUser.user;
      console.log('✅ 新用户创建成功');

    } else if (existingUser) {
      // 更新现有用户
      console.log('🔄 更新现有用户:', userInfo.email);
      
      const { data: updatedUser, error: updateError } = await supabase.auth.admin.updateUserById(
        userInfo.sub,
        {
          email: userInfo.email,
          user_metadata: {
            ...existingUser.user.user_metadata,
            name: userInfo.name,
            preferred_username: userInfo.preferred_username,
            last_sign_in_at: new Date().toISOString(),
            email_verified: userInfo.email_verified || false
          }
        }
      );

      if (updateError) {
        console.error('❌ 更新用户失败:', updateError);
        throw updateError;
      }

      user = updatedUser.user;
      console.log('✅ 用户更新成功');

    } else {
      throw getUserError;
    }

    // 步骤 4: 生成 Supabase 会话
    const { data: session, error: sessionError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: userInfo.email,
      options: {
        redirectTo: state || Deno.env.get('DEFAULT_REDIRECT_URL') || '/'
      }
    });

    if (sessionError) {
      console.error('❌ 生成会话失败:', sessionError);
      throw sessionError;
    }

    console.log('✅ Supabase 会话生成成功');

    // 步骤 5: 记录登录事件（如果需要）
    try {
      const { error: logError } = await supabase
        .from('login_events')
        .insert({
          user_id: user.id,
          email: user.email,
          provider: 'hydra-oidc',
          ip_address: req.headers.get('x-forwarded-for') || 'unknown',
          user_agent: req.headers.get('user-agent') || 'unknown',
          success: true,
          metadata: {
            hydra_sub: userInfo.sub,
            access_token_expires_in: tokens.expires_in
          }
        });

      if (logError) {
        console.warn('⚠️ 记录登录事件失败:', logError);
      }
    } catch (logEventError) {
      console.warn('⚠️ 记录登录事件异常:', logEventError);
    }

    // 步骤 6: 重定向到应用
    const redirectUrl = session.properties?.hashed_token 
      ? `${state || '/'}#access_token=${session.properties.hashed_token}&token_type=bearer`
      : session.properties?.action_link || (state || '/');

    return new Response(
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>登录成功</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            .success { color: #28a745; }
            .loading { color: #007bff; }
          </style>
        </head>
        <body>
          <div class="success">
            <h2>✅ 登录成功！</h2>
            <p class="loading">正在重定向...</p>
          </div>
          <script>
            // 自动重定向
            setTimeout(() => {
              window.location.href = '${redirectUrl}';
            }, 2000);
          </script>
        </body>
      </html>
      `,
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/html',
        },
      }
    );

  } catch (error) {
    console.error('❌ OIDC 回调处理失败:', error);
    
    return new Response(
      JSON.stringify({
        error: 'oidc_callback_failed',
        message: error.message,
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
}); 