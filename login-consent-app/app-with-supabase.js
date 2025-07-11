const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');
const SupabaseIntegration = require('./supabase-integration');

const app = express();
const PORT = 3000;
const HYDRA_ADMIN_URL = process.env.HYDRA_ADMIN_URL || 'http://localhost:4445';

// 初始化 Supabase 集成
const supabaseIntegration = new SupabaseIntegration();

// 配置模板引擎
app.set('view engine', 'ejs');
app.set('views', './views');

// 中间件
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'session-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

// 静态文件
app.use(express.static('public'));

// 模拟用户数据库（在生产环境中应该从 Supabase 获取）
const users = [
  { 
    id: '1', 
    username: 'admin', 
    password: 'admin123', 
    email: 'admin@example.com', 
    name: '管理员',
    roles: ['admin', 'user']
  },
  { 
    id: '2', 
    username: 'user1', 
    password: 'user123', 
    email: 'user1@example.com', 
    name: '用户一',
    roles: ['user']
  },
  { 
    id: '3', 
    username: 'user2', 
    password: 'user456', 
    email: 'user2@example.com', 
    name: '用户二',
    roles: ['user']
  }
];

// 登录页面
app.get('/login', async (req, res) => {
  const { login_challenge } = req.query;
  
  console.log('🔐 收到登录请求:', { login_challenge, timestamp: new Date().toISOString() });
  
  if (!login_challenge) {
    console.error('❌ 缺少 login_challenge 参数');
    return res.status(400).send('缺少 login_challenge 参数');
  }

  try {
    console.log('📡 正在向 Hydra 管理 API 请求登录信息...');
    
    // 获取登录请求信息
    const loginRequest = await axios.get(`${HYDRA_ADMIN_URL}/oauth2/auth/requests/login`, {
      params: { login_challenge },
      timeout: 10000
    });

    console.log('✅ Hydra 响应成功:', loginRequest.status);
    
    const { skip, subject, client } = loginRequest.data;

    // 如果已经认证过，直接接受登录请求
    if (skip) {
      console.log('⏭️ 用户已认证，跳过登录页面');
      
      const acceptLogin = await axios.put(`${HYDRA_ADMIN_URL}/oauth2/auth/requests/login/accept`, {
        subject: subject,
        remember: true,
        remember_for: 3600
      }, {
        params: { login_challenge },
        timeout: 10000
      });
      
      console.log('🔄 自动接受登录成功，重定向到:', acceptLogin.data.redirect_to);
      return res.redirect(acceptLogin.data.redirect_to);
    }

    console.log('📝 显示登录表单');
    
    // 显示登录表单
    res.render('login', { 
      challenge: login_challenge,
      client: client,
      error: null,
      supabaseEnabled: supabaseIntegration.enabled
    });

  } catch (error) {
    console.error('❌ 获取登录请求失败:', error.message);
    
    if (error.response) {
      console.error('HTTP 状态:', error.response.status);
      console.error('响应数据:', error.response.data);
    }
    
    // 返回友好的错误页面
    return res.status(500).render('error', {
      error: 'login_request_failed',
      error_description: '登录请求处理失败，请重试'
    });
  }
});

// 处理登录表单提交 - 增强版支持 Supabase 集成
app.post('/login', async (req, res) => {
  const { challenge, username, password, remember } = req.body;

  try {
    // 验证用户凭据
    const user = users.find(u => u.username === username && u.password === password);
    
    if (!user) {
      const loginRequest = await axios.get(`${HYDRA_ADMIN_URL}/oauth2/auth/requests/login`, {
        params: { login_challenge: challenge }
      });
      
      return res.render('login', {
        challenge,
        client: loginRequest.data.client,
        error: '用户名或密码错误',
        supabaseEnabled: supabaseIntegration.enabled
      });
    }

    console.log(`✅ 用户认证成功: ${user.email}`);

    // 🆕 Supabase 集成：同步用户数据
    if (supabaseIntegration.enabled) {
      try {
        console.log('🔄 正在同步用户到 Supabase...');
        
        const syncResult = await supabaseIntegration.syncUser({
          sub: user.id,
          email: user.email,
          name: user.name,
          preferred_username: user.username
        });

        if (syncResult.success) {
          console.log(`✅ Supabase 用户同步成功: ${syncResult.action}`);
        } else {
          console.warn(`⚠️ Supabase 用户同步失败: ${syncResult.reason || syncResult.error?.message}`);
        }

        // 更新用户配置文件
        await supabaseIntegration.upsertUserProfile({
          sub: user.id,
          email: user.email,
          name: user.name,
          preferred_username: user.username
        });

        // 记录登录事件
        await supabaseIntegration.logLoginEvent({
          sub: user.id,
          email: user.email,
          ip: req.ip || req.connection.remoteAddress,
          userAgent: req.get('User-Agent')
        });

        // 获取用户角色（如果启用了 Supabase）
        user.supabaseRoles = await supabaseIntegration.getUserRoles(user.email);

      } catch (supabaseError) {
        console.error('⚠️ Supabase 集成处理失败:', supabaseError.message);
        // 即使 Supabase 失败，也继续 OAuth2 流程
      }
    }

    // 接受登录请求
    const acceptLogin = await axios.put(`${HYDRA_ADMIN_URL}/oauth2/auth/requests/login/accept`, {
      subject: user.id,
      remember: !!remember,
      remember_for: remember ? 3600 : 0,
      context: {
        // 基本用户信息
        username: user.username,
        email: user.email,
        name: user.name,
        // 🆕 增强用户信息
        roles: user.roles || ['user'],
        supabaseRoles: user.supabaseRoles || [],
        provider: 'hydra-oidc',
        loginTime: new Date().toISOString()
      }
    }, {
      params: { login_challenge: challenge }
    });

    console.log('🔄 登录请求已接受，重定向到:', acceptLogin.data.redirect_to);
    res.redirect(acceptLogin.data.redirect_to);

  } catch (error) {
    console.error('❌ 登录处理失败:', error.response?.data || error.message);
    res.status(500).render('error', {
      error: 'login_failed',
      error_description: '登录处理失败，请重试'
    });
  }
});

// 同意页面 - 增强版支持权限检查
app.get('/consent', async (req, res) => {
  const { consent_challenge } = req.query;

  if (!consent_challenge) {
    return res.status(400).send('缺少 consent_challenge 参数');
  }

  try {
    // 获取同意请求信息
    const consentRequest = await axios.get(`${HYDRA_ADMIN_URL}/oauth2/auth/requests/consent`, {
      params: { consent_challenge }
    });

    const { skip, client, requested_scope, subject, context } = consentRequest.data;

    console.log('🤝 收到同意请求:', {
      client: client.client_name || client.client_id,
      subject,
      requested_scope,
      skip
    });

    // 🆕 Supabase 集成：检查用户权限
    let allowedScopes = requested_scope;
    if (supabaseIntegration.enabled && context?.email) {
      try {
        // 检查用户对每个 scope 的权限
        const scopePermissions = await Promise.all(
          requested_scope.map(async (scope) => {
            const hasPermission = await supabaseIntegration.checkUserPermissions(context.email, scope);
            return { scope, allowed: hasPermission };
          })
        );

        allowedScopes = scopePermissions
          .filter(sp => sp.allowed)
          .map(sp => sp.scope);

        console.log('🔐 权限检查结果:', scopePermissions);

        if (allowedScopes.length === 0) {
          console.warn('⚠️ 用户无任何权限');
          return res.status(403).render('error', {
            error: 'insufficient_permissions',
            error_description: '您没有访问此应用的权限'
          });
        }

      } catch (permissionError) {
        console.error('⚠️ 权限检查失败:', permissionError.message);
        // 权限检查失败时，使用默认权限
      }
    }

    // 如果已经同意过，直接接受同意请求
    if (skip) {
      console.log('⏭️ 用户已同意，跳过同意页面');
      
      const acceptConsent = await axios.put(`${HYDRA_ADMIN_URL}/oauth2/auth/requests/consent/accept`, {
        grant_scope: allowedScopes,
        grant_access_token_audience: consentRequest.data.requested_access_token_audience,
        session: {
          id_token: {
            email: context?.email,
            name: context?.name,
            preferred_username: context?.username,
            roles: context?.roles || [],
            supabaseRoles: context?.supabaseRoles || [],
            provider: 'hydra-oidc'
          },
          access_token: {
            roles: context?.roles || [],
            supabaseRoles: context?.supabaseRoles || []
          }
        }
      }, {
        params: { consent_challenge }
      });
      
      return res.redirect(acceptConsent.data.redirect_to);
    }

    // 渲染同意页面
    res.render('consent', {
      challenge: consent_challenge,
      client: client,
      requested_scope: requested_scope,
      allowed_scope: allowedScopes,
      user: context,
      supabaseEnabled: supabaseIntegration.enabled
    });

  } catch (error) {
    console.error('❌ 获取同意请求失败:', error.response?.data || error.message);
    res.status(500).render('error', {
      error: 'consent_request_failed',
      error_description: '同意请求处理失败'
    });
  }
});

// 处理同意表单提交
app.post('/consent', async (req, res) => {
  const { challenge, grant_scope } = req.body;

  try {
    // 获取同意请求信息
    const consentRequest = await axios.get(`${HYDRA_ADMIN_URL}/oauth2/auth/requests/consent`, {
      params: { consent_challenge: challenge }
    });

    const grantedScopes = Array.isArray(grant_scope) ? grant_scope : (grant_scope ? [grant_scope] : []);
    const { context } = consentRequest.data;

    console.log('✅ 用户同意权限:', grantedScopes);

    // 接受同意请求
    const acceptConsent = await axios.put(`${HYDRA_ADMIN_URL}/oauth2/auth/requests/consent/accept`, {
      grant_scope: grantedScopes,
      grant_access_token_audience: consentRequest.data.requested_access_token_audience,
      remember: true,
      remember_for: 3600,
      session: {
        id_token: {
          email: context?.email,
          name: context?.name,
          preferred_username: context?.username,
          roles: context?.roles || [],
          supabaseRoles: context?.supabaseRoles || [],
          provider: 'hydra-oidc',
          granted_scopes: grantedScopes
        },
        access_token: {
          roles: context?.roles || [],
          supabaseRoles: context?.supabaseRoles || [],
          granted_scopes: grantedScopes
        }
      }
    }, {
      params: { consent_challenge: challenge }
    });

    console.log('🔄 同意请求已接受，重定向到:', acceptConsent.data.redirect_to);
    res.redirect(acceptConsent.data.redirect_to);

  } catch (error) {
    console.error('❌ 同意处理失败:', error.response?.data || error.message);
    res.status(500).render('error', {
      error: 'consent_failed',
      error_description: '同意处理失败'
    });
  }
});

// 注销页面
app.get('/logout', async (req, res) => {
  const { logout_challenge } = req.query;

  if (!logout_challenge) {
    return res.status(400).send('缺少 logout_challenge 参数');
  }

  try {
    // 获取注销请求信息
    const logoutRequest = await axios.get(`${HYDRA_ADMIN_URL}/oauth2/auth/requests/logout`, {
      params: { logout_challenge }
    });

    const { subject } = logoutRequest.data;

    console.log('🚪 收到注销请求:', { subject });

    // 🆕 记录注销事件到 Supabase（可选）
    if (supabaseIntegration.enabled && subject) {
      try {
        const user = users.find(u => u.id === subject);
        if (user) {
          await supabaseIntegration.logLoginEvent({
            sub: user.id,
            email: user.email,
            ip: req.ip || req.connection.remoteAddress,
            userAgent: req.get('User-Agent'),
            action: 'logout'
          });
        }
      } catch (logoutError) {
        console.error('⚠️ 记录注销事件失败:', logoutError.message);
      }
    }

    // 接受注销请求
    const acceptLogout = await axios.put(`${HYDRA_ADMIN_URL}/oauth2/auth/requests/logout/accept`, {}, {
      params: { logout_challenge }
    });

    res.redirect(acceptLogout.data.redirect_to);

  } catch (error) {
    console.error('❌ 注销处理失败:', error.response?.data || error.message);
    res.status(500).send('注销处理失败');
  }
});

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    supabase: {
      enabled: supabaseIntegration.enabled,
      url: supabaseIntegration.supabaseUrl ? 'configured' : 'not_configured'
    }
  });
});

// 🆕 Supabase 用户管理 API 端点
app.get('/api/users/:email/profile', async (req, res) => {
  if (!supabaseIntegration.enabled) {
    return res.status(503).json({ error: 'Supabase integration not enabled' });
  }

  try {
    const profile = await supabaseIntegration.getUserProfile(req.params.email);
    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users/:email/roles', async (req, res) => {
  if (!supabaseIntegration.enabled) {
    return res.status(503).json({ error: 'Supabase integration not enabled' });
  }

  try {
    const roles = await supabaseIntegration.getUserRoles(req.params.email);
    res.json({ roles });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 检查 Hydra 连接
async function checkHydraConnection() {
  try {
    const response = await axios.get(`${HYDRA_ADMIN_URL}/health/ready`, { timeout: 5000 });
    console.log('✅ Hydra 连接正常');
    return true;
  } catch (error) {
    console.error('❌ Hydra 连接失败:', error.message);
    return false;
  }
}

// 启动服务器
app.listen(PORT, async () => {
  console.log(`🚀 登录同意应用启动在端口 ${PORT}`);
  console.log(`📡 Hydra 管理 API: ${HYDRA_ADMIN_URL}`);
  console.log(`🔗 Supabase 集成: ${supabaseIntegration.enabled ? '✅ 已启用' : '❌ 未启用'}`);
  
  // 检查 Hydra 连接
  const hydraConnected = await checkHydraConnection();
  if (!hydraConnected) {
    console.warn('⚠️ 警告: Hydra 服务不可用，请确保 Hydra 服务正在运行');
  }
  
  console.log('📋 可用端点:');
  console.log('  - GET  /login    - 登录页面');
  console.log('  - POST /login    - 登录处理');
  console.log('  - GET  /consent  - 同意页面');
  console.log('  - POST /consent  - 同意处理');
  console.log('  - GET  /logout   - 注销处理');
  console.log('  - GET  /health   - 健康检查');
  if (supabaseIntegration.enabled) {
    console.log('  - GET  /api/users/:email/profile - 用户配置文件');
    console.log('  - GET  /api/users/:email/roles   - 用户角色');
  }
});

module.exports = app; 