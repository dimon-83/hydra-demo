const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { createClient } = require('@supabase/supabase-js');

class HydraSupabaseSSO {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY // 需要 Service Role Key
    );
    
    // JWKS 客户端用于验证 Hydra JWT
    this.jwksClient = jwksClient({
      jwksUri: `${process.env.HYDRA_PUBLIC_URL}/.well-known/jwks.json`,
      cache: true,
      cacheMaxAge: 600000 // 10 分钟
    });
  }

  /**
   * 验证 Hydra ID Token
   */
  async verifyHydraToken(idToken) {
    try {
      // 解码但不验证签名（先获取 header）
      const decodedHeader = jwt.decode(idToken, { complete: true });
      if (!decodedHeader) {
        throw new Error('Invalid token format');
      }

      // 获取签名密钥
      const key = await this.getSigningKey(decodedHeader.header.kid);
      
      // 验证令牌
      const decoded = jwt.verify(idToken, key, {
        algorithms: ['RS256'],
        audience: process.env.HYDRA_CLIENT_ID, // 您的 Hydra 客户端 ID
        issuer: process.env.HYDRA_PUBLIC_URL
      });

      return decoded;
    } catch (error) {
      console.error('Token verification failed:', error);
      throw new Error('Invalid token');
    }
  }

  /**
   * 获取 JWKS 签名密钥
   */
  async getSigningKey(kid) {
    return new Promise((resolve, reject) => {
      this.jwksClient.getSigningKey(kid, (err, key) => {
        if (err) {
          reject(err);
        } else {
          resolve(key.getPublicKey());
        }
      });
    });
  }

  /**
   * 在 Supabase 中创建或更新用户
   */
  async syncUserToSupabase(hydraUserInfo) {
    try {
      const { sub, email, name, preferred_username } = hydraUserInfo;
      
      // 检查用户是否已存在
      const { data: existingUser, error: fetchError } = await this.supabase.auth.admin
        .getUserById(sub);

      if (fetchError && fetchError.message !== 'User not found') {
        throw fetchError;
      }

      let user;
      
      if (existingUser.user) {
        // 用户已存在，更新信息
        const { data, error } = await this.supabase.auth.admin
          .updateUserById(sub, {
            email: email,
            user_metadata: {
              name: name,
              username: preferred_username,
              hydra_sub: sub
            }
          });
        
        if (error) throw error;
        user = data.user;
      } else {
        // 创建新用户
        const { data, error } = await this.supabase.auth.admin
          .createUser({
            id: sub, // 使用 Hydra sub 作为 Supabase user ID
            email: email,
            email_confirm: true, // 自动确认邮箱
            user_metadata: {
              name: name,
              username: preferred_username,
              hydra_sub: sub
            }
          });
        
        if (error) throw error;
        user = data.user;
      }

      return user;
    } catch (error) {
      console.error('Failed to sync user to Supabase:', error);
      throw error;
    }
  }

  /**
   * 生成 Supabase 访问令牌
   */
  async generateSupabaseToken(userId) {
    try {
      const { data, error } = await this.supabase.auth.admin
        .generateLink({
          type: 'magiclink',
          email: '', // 这里可以留空，因为我们直接使用 user ID
          options: {
            redirectTo: process.env.APP_URL
          }
        });

      if (error) throw error;

      // 或者创建一个自定义会话
      const { data: sessionData, error: sessionError } = await this.supabase.auth.admin
        .createSession({
          user_id: userId,
          session_duration: 3600 // 1小时
        });

      if (sessionError) throw sessionError;

      return sessionData;
    } catch (error) {
      console.error('Failed to generate Supabase token:', error);
      throw error;
    }
  }

  /**
   * 主要的 SSO 处理函数
   */
  async handleSSO(idToken, accessToken) {
    try {
      // 1. 验证 ID Token
      const hydraUserInfo = await this.verifyHydraToken(idToken);
      
      // 2. 同步用户到 Supabase
      const supabaseUser = await this.syncUserToSupabase(hydraUserInfo);
      
      // 3. 生成 Supabase 会话
      const session = await this.generateSupabaseToken(supabaseUser.id);
      
      return {
        success: true,
        user: supabaseUser,
        session: session,
        supabase_access_token: session.access_token,
        supabase_refresh_token: session.refresh_token
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = HydraSupabaseSSO; 