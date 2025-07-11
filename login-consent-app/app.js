// 加载环境变量
require('dotenv').config();

const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const HYDRA_ADMIN_URL = process.env.HYDRA_ADMIN_URL || 'http://10.38.211.67:4445';

// Supabase 配置
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('⚠️ Supabase 配置缺失，将使用备用验证方式');
  console.warn('请在 .env 文件中配置 SUPABASE_URL 和 SUPABASE_ANON_KEY');
}

const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// 配置模板引擎
app.set('view engine', 'ejs');
app.set('views', './views');

// 中间件
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: 'login-consent-session-secret-key-for-hydra-demo',
  name: 'hydra.login.consent.session',
  resave: false,
  saveUninitialized: false,  // 改为 false，避免创建空 session
  cookie: { 
    secure: false,           // HTTP 环境下设为 false
    httpOnly: true,          // 防止 XSS
    maxAge: 24 * 60 * 60 * 1000,  // 24小时
    sameSite: 'lax'          // 允许跨站但限制 CSRF
  },
  rolling: true              // 每次请求都刷新 session 过期时间
}));

// 静态文件
app.use(express.static('public'));

// 用户验证函数 - 使用 Supabase Auth
async function authenticateUser(email, password) {
  try {
    if (!supabase) {
      console.log('⚠️ Supabase 未配置，跳过 Auth 验证');
      return { success: false, error: 'Supabase 未配置' };
    }

    console.log('🔐 尝试通过 Supabase Auth 验证用户:', email);
    
    // 使用 Supabase Auth API 验证用户
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password
    });

    if (error) {
      console.log('❌ Supabase Auth 验证失败:', error.message);
      return { success: false, error: error.message };
    }

    if (data.user) {
      console.log('✅ Supabase Auth 验证成功:', data.user.id);
      
      // 获取用户完整信息
      const { data: userProfile, error: profileError } = await supabase
        .from('profiles')  // 假设有一个 profiles 表存储用户详细信息
        .select('*')
        .eq('id', data.user.id)
        .single();

      const user = {
        id: data.user.id,
        email: data.user.email,
        username: userProfile?.username || data.user.email.split('@')[0],
        name: userProfile?.full_name || data.user.user_metadata?.full_name || '用户',
        avatar_url: userProfile?.avatar_url || data.user.user_metadata?.avatar_url,
        created_at: data.user.created_at
      };

      return { success: true, user };
    }

    return { success: false, error: '用户验证失败' };

  } catch (error) {
    console.error('🚨 用户验证异常:', error);
    return { success: false, error: '服务器内部错误' };
  }
}

// 备用验证函数 - 直接查询数据库（如果不使用 Supabase Auth）
async function authenticateUserFromDatabase(username, password) {
  try {
    if (!supabase) {
      console.log('⚠️ Supabase 未配置，使用本地用户验证');
      // 使用本地用户数组验证（仅用于开发测试）
      const user = users.find(u => 
        (u.username === username || u.email === username) && u.password === password
      );
      
      if (user) {
        console.log('✅ 本地用户验证成功:', user.username);
        return { 
          success: true, 
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            name: user.name
          }
        };
      }
      
      return { success: false, error: '用户名或密码错误' };
    }

    console.log('🔐 尝试通过数据库验证用户:', username);
    
    // 查询用户表
    const { data: users, error } = await supabase
      .from('users')
      .select('id, username, email, full_name, password_hash')
      .or(`username.eq.${username},email.eq.${username}`)
      .limit(1);

    if (error) {
      console.error('❌ 数据库查询失败:', error);
      return { success: false, error: '数据库查询失败' };
    }

    if (!users || users.length === 0) {
      return { success: false, error: '用户不存在' };
    }

    const user = users[0];
    
    // 这里需要使用密码哈希验证，例如 bcrypt
    // const bcrypt = require('bcrypt');
    // const isValidPassword = await bcrypt.compare(password, user.password_hash);
    
    // 临时简单验证（生产环境请使用密码哈希）
    const isValidPassword = password === 'demo123'; // 临时演示

    if (!isValidPassword) {
      return { success: false, error: '密码错误' };
    }

    console.log('✅ 数据库验证成功:', user.id);
    
    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.full_name || user.username
      }
    };

  } catch (error) {
    console.error('🚨 数据库验证异常:', error);
    return { success: false, error: '服务器内部错误' };
  }
}

// 模拟用户数据库（备用，建议删除）
const users = [
  { id: '1', username: 'admin', password: 'admin123', email: 'admin@example.com', name: '管理员' },
  { id: '2', username: 'user1', password: 'user123', email: 'user1@example.com', name: '用户一' },
  { id: '3', username: 'user2', password: 'user456', email: 'user2@example.com', name: '用户二' }
];

// 登录页面
app.get('/login', async (req, res) => {
  const { login_challenge } = req.query;
  
  console.log('收到登录请求:', { login_challenge, timestamp: new Date().toISOString() });
  
  if (!login_challenge) {
    console.error('缺少 login_challenge 参数');
    return res.status(400).send('缺少 login_challenge 参数');
  }

  try {
    console.log('正在向 Hydra 管理 API 请求登录信息...');
    console.log('请求 URL:', `${HYDRA_ADMIN_URL}/oauth2/auth/requests/login?login_challenge=${login_challenge}`);
    
    // 获取登录请求信息
    const loginRequest = await axios.get(`${HYDRA_ADMIN_URL}/oauth2/auth/requests/login`, {
      params: { login_challenge },
      timeout: 10000 // 10秒超时
    });

    console.log('Hydra 响应状态:', loginRequest.status);
    console.log('Hydra 响应数据:', JSON.stringify(loginRequest.data, null, 2));

    const { skip, subject } = loginRequest.data;

    // 如果已经认证过，直接接受登录请求
    if (skip) {
      console.log('用户已认证，跳过登录页面');
      
      const acceptLogin = await axios.put(`${HYDRA_ADMIN_URL}/oauth2/auth/requests/login/accept`, {
        subject: subject,
        remember: true,
        remember_for: 3600
      }, {
        params: { login_challenge },
        timeout: 10000
      });
      
      console.log('自动接受登录成功，重定向到:', acceptLogin.data.redirect_to);
      return res.redirect(acceptLogin.data.redirect_to);
    }

    console.log('显示登录表单');
    // 显示登录表单
    res.render('login', { 
      challenge: login_challenge,
      client: loginRequest.data.client,
      error: null
    });

  } catch (error) {
    console.error('获取登录请求失败:');
    console.error('错误类型:', error.constructor.name);
    console.error('错误消息:', error.message);
    
    if (error.response) {
      console.error('HTTP 状态:', error.response.status);
      console.error('响应头:', error.response.headers);
      console.error('响应数据:', error.response.data);
    } else if (error.request) {
      console.error('请求配置:', error.config);
      console.error('无响应 - 可能是网络问题或服务不可用');
    }
    
    // 根据错误类型返回不同的错误页面
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return res.status(500).render('error', {
        error: 'service_unavailable',
        error_description: 'Hydra 服务不可用，请确认服务是否正常运行'
      });
    } else if (error.response?.status === 404) {
      return res.status(400).render('error', {
        error: 'invalid_challenge',
        error_description: 'login_challenge 无效或已过期，请重新开始登录流程'
      });
    } else if (error.response?.status === 410) {
      return res.status(400).render('error', {
        error: 'challenge_expired',
        error_description: 'login_challenge 已过期，请重新开始登录流程'
      });
    } else {
      return res.status(500).render('error', {
        error: 'internal_error',
        error_description: '登录请求处理失败: ' + (error.response?.data?.error_description || error.message)
      });
    }
  }
});

// 处理登录表单提交
app.post('/login', async (req, res) => {
  const { challenge, username, password, remember } = req.body;

  try {
    console.log('📝 处理登录请求:', { username, challenge });

    // 🔐 使用 Supabase 验证用户
    let authResult;
    
    // 方案一：使用 Supabase Auth API（推荐）
    // 如果用户输入的是邮箱，直接使用；如果是用户名，需要先查找邮箱
    let email = username;
    if (!username.includes('@')) {
      // 输入的是用户名，需要查找对应的邮箱
      console.log('🔍 输入的是用户名，查找对应邮箱...');
      
      if (supabase) {
        const { data: userProfile, error: profileError } = await supabase
          .from('profiles')
          .select('email')
          .eq('username', username)
          .single();
        
        // 打印 userProfile 调试信息
        console.log('📊 userProfile 查询结果:', userProfile);
        console.log('❗ profileError:', profileError);
        
        if (profileError || !userProfile) {
          console.log('❌ 用户名不存在:', username);
          const loginRequest = await axios.get(`${HYDRA_ADMIN_URL}/oauth2/auth/requests/login`, {
            params: { login_challenge: challenge }
          });
          
          return res.render('login', {
            challenge,
            client: loginRequest.data.client,
            error: '用户名不存在'
          });
        }
        
        email = userProfile.email;
        console.log('✅ 找到邮箱:', email);
      } else {
        // Supabase 未配置，使用本地用户查找
        const localUser = users.find(u => u.username === username);
        if (localUser) {
          email = localUser.email;
          console.log('✅ 本地找到邮箱:', email);
        } else {
          console.log('❌ 本地用户名不存在:', username);
          const loginRequest = await axios.get(`${HYDRA_ADMIN_URL}/oauth2/auth/requests/login`, {
            params: { login_challenge: challenge }
          });
          
          return res.render('login', {
            challenge,
            client: loginRequest.data.client,
            error: '用户名不存在'
          });
        }
      }
    }

    // 使用 Supabase Auth 验证
    authResult = await authenticateUser(email, password);
    
    // // 如果 Supabase Auth 失败，尝试数据库验证（备用）
    // if (!authResult.success) {
    //   console.log('🔄 尝试备用验证方式...');
    //   authResult = await authenticateUserFromDatabase(username, password);
    // }

    // 验证失败
    if (!authResult.success) {
      console.log('❌ 用户验证失败:', authResult.error);
      
      const loginRequest = await axios.get(`${HYDRA_ADMIN_URL}/oauth2/auth/requests/login`, {
        params: { login_challenge: challenge }
      });
      
      return res.render('login', {
        challenge,
        client: loginRequest.data.client,
        error: authResult.error || '用户名或密码错误'
      });
    }

    // 验证成功
    const user = authResult.user;
    console.log('✅ 用户验证成功:', { 
      id: user.id, 
      username: user.username, 
      email: user.email 
    });

    // 接受登录请求
    const acceptLogin = await axios.put(`${HYDRA_ADMIN_URL}/oauth2/auth/requests/login/accept`, {
      subject: user.id,
      remember: !!remember,
      remember_for: remember ? 3600 : 0,
      context: {
        username: user.username,
        email: user.email,
        name: user.name,
        avatar_url: user.avatar_url,
        auth_method: 'supabase_auth'  // 标记认证方式
      }
    }, {
      params: { login_challenge: challenge }
    });

    console.log('🎉 登录成功，重定向到:', acceptLogin.data.redirect_to);
    res.redirect(acceptLogin.data.redirect_to);

  } catch (error) {
    console.error('🚨 登录处理失败:', error.response?.data || error.message);
    
    // 如果是 Hydra 相关错误
    if (error.response?.status) {
      return res.status(500).render('error', {
        error: 'login_error',
        error_description: '登录处理失败: ' + (error.response?.data?.error_description || error.message)
      });
    }
    
    // 其他错误
    res.status(500).render('error', {
      error: 'internal_error',
      error_description: '服务器内部错误，请稍后重试'
    });
  }
});

// 同意页面
app.get('/consent', async (req, res) => {
  const { consent_challenge } = req.query;

  if (!consent_challenge) {
    return res.status(400).send('缺少 consent_challenge 参数');
  }

  try {
    console.log('🤝 收到 consent 请求:', { consent_challenge });
    
    // 获取同意请求信息
    const consentRequest = await axios.get(`${HYDRA_ADMIN_URL}/oauth2/auth/requests/consent`, {
      params: { consent_challenge }
    });

    const { skip, client, requested_scope, subject, context } = consentRequest.data;

    // 🔍 详细调试信息
    console.log('=' * 60);
    console.log('🔍 详细的 Consent 调试信息:');
    console.log('=' * 60);
    console.log('📋 完整的 consentRequest.data:');
    console.log(JSON.stringify(consentRequest.data, null, 2));
    console.log('');
    console.log('🔑 关键字段分析:');
    console.log('  - skip:', skip, `(类型: ${typeof skip})`);
    console.log('  - client.skip_consent:', client.skip_consent, `(类型: ${typeof client.skip_consent})`);
    console.log('  - client.skip_logout_consent:', client.skip_logout_consent, `(类型: ${typeof client.skip_logout_consent})`);
    console.log('  - client_id:', client.client_id);
    console.log('  - client_name:', client.client_name);
    console.log('  - subject:', subject);
    console.log('  - requested_scope:', requested_scope);
    console.log('');
    console.log('📊 客户端完整配置:');
    console.log(JSON.stringify(client, null, 2));
    console.log('');
    console.log('🎯 判断逻辑:');
    console.log('  - 是否应该跳过 consent?', skip ? 'YES' : 'NO');
    if (skip) {
      console.log('  - 跳过原因分析:');
      console.log('    * client.skip_consent =', client.skip_consent);
      console.log('    * 如果 client.skip_consent 为 true，说明是客户端配置跳过');
      console.log('    * 如果 client.skip_consent 为 false/undefined，说明是用户记忆跳过');
    } else {
      console.log('  - 不跳过原因分析:');
      console.log('    * skip 字段为 false，将显示 consent 页面');
      console.log('    * 请检查 hydra.yml 中的客户端配置');
      console.log('    * 或者检查客户端是否正确创建/更新');
    }
    console.log('=' * 60);

    console.log('📋 Consent 请求详情:', {
      client_id: client.client_id,
      client_name: client.client_name,
      subject: subject,
      requested_scope: requested_scope,
      skip: skip,  // 🔑 关键字段：是否跳过 consent
      skip_reason: skip ? (client.skip_consent ? 'client_trusted' : 'user_remembered') : 'none'
    });

    // 🎯 检查是否跳过 consent（Hydra 配置 + 用户记忆）
    if (true) {//skip
      console.log('⏭️ 跳过 consent 页面');
      console.log('📝 跳过原因:', client.skip_consent ? 
        '客户端配置为受信任 (skip_consent: true)' : 
        '用户之前已同意且选择了记住选择'
      );
      
      const acceptConsent = await axios.put(`${HYDRA_ADMIN_URL}/oauth2/auth/requests/consent/accept`, {
        grant_scope: requested_scope,  // 授权所有请求的权限
        grant_access_token_audience: consentRequest.data.requested_access_token_audience,
        remember: true,               // 记住此次授权
        remember_for: 3600,           // 1小时内有效
        session: {
          id_token: {
            email: context?.email,
            name: context?.name,
            username: context?.username,
            // 标记这是自动授权
            auto_granted: true,
            skip_reason: client.skip_consent ? 'trusted_client' : 'remembered_consent'
          },
          access_token: {
            user_id: subject,
            auto_granted: true
          }
        }
      }, {
        params: { consent_challenge }
      });
      
      console.log('✅ Consent 自动接受成功');
      console.log('🔄 重定向到:', acceptConsent.data.redirect_to);
      return res.redirect(acceptConsent.data.redirect_to);
    }

    // 获取用户信息用于显示
    // const user = users.find(u => u.id === subject);
    // console.log('📄 显示 consent 页面给用户:', user?.username || subject);
    // console.log('⚠️ 注意: skip 为 false，将显示 consent 表单');

    // // 显示同意表单
    // res.render('consent', {
    //   challenge: consent_challenge,
    //   client,
    //   user,
    //   scopes: requested_scope
    // });

  } catch (error) {
    console.error('❌ 获取同意请求失败:', error.response?.data || error.message);
    res.status(500).send('同意请求处理失败');
  }
});

// 处理同意表单提交
app.post('/consent', async (req, res) => {
  const { challenge, grant_scope, remember } = req.body;

  try {
    const consentRequest = await axios.get(`${HYDRA_ADMIN_URL}/oauth2/auth/requests/consent`, {
      params: { consent_challenge: challenge }
    });

    const user = users.find(u => u.id === consentRequest.data.subject);

    if (grant_scope) {
      // 接受同意请求
      const grantScopes = Array.isArray(grant_scope) ? grant_scope : [grant_scope];
      
      const acceptConsent = await axios.put(`${HYDRA_ADMIN_URL}/oauth2/auth/requests/consent/accept`, {
        grant_scope: grantScopes,
        grant_access_token_audience: consentRequest.data.requested_access_token_audience,
        remember: !!remember,
        remember_for: remember ? 3600 : 0,
        session: {
          id_token: {
            email: user?.email,
            name: user?.name,
            username: user?.username
          },
          access_token: {
            user_id: user?.id
          }
        }
      }, {
        params: { consent_challenge: challenge }
      });

      res.redirect(acceptConsent.data.redirect_to);
    } else {
      // 拒绝同意请求
      const rejectConsent = await axios.put(`${HYDRA_ADMIN_URL}/oauth2/auth/requests/consent/reject`, {
        error: 'access_denied',
        error_description: '用户拒绝授权'
      }, {
        params: { consent_challenge: challenge }
      });

      res.redirect(rejectConsent.data.redirect_to);
    }

  } catch (error) {
    console.error('同意处理失败:', error.response?.data || error.message);
    res.status(500).send('同意处理失败');
  }
});

// 注销页面
app.get('/logout', async (req, res) => {
  const { logout_challenge } = req.query;

  if (!logout_challenge) {
    return res.status(400).send('缺少 logout_challenge 参数');
  }

  try {
    // 接受注销请求
    const acceptLogout = await axios.put(`${HYDRA_ADMIN_URL}/oauth2/auth/requests/logout/accept`, {}, {
      params: { logout_challenge }
    });

    res.redirect(acceptLogout.data.redirect_to);

  } catch (error) {
    console.error('注销处理失败:', error.response?.data || error.message);
    res.status(500).send('注销处理失败');
  }
});

// 错误页面
app.get('/error', (req, res) => {
  res.render('error', { 
    error: req.query.error,
    error_description: req.query.error_description 
  });
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 检查 Hydra 服务连通性
async function checkHydraConnection() {
  console.log('检查 Hydra 服务连通性...');
  
  try {
    // 检查管理 API
    const adminResponse = await axios.get(`${HYDRA_ADMIN_URL}/health/ready`, {
      timeout: 5000
    });
    console.log('✅ Hydra 管理 API 连接正常');
    
    // 检查公共 API
    const publicResponse = await axios.get('http://10.38.211.67:4444/health/ready', {
      timeout: 5000
    });
    console.log('✅ Hydra 公共 API 连接正常');
    
    return true;
  } catch (error) {
    console.error('❌ Hydra 服务连接失败:');
    console.error('错误:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('   - 连接被拒绝，请确认 Hydra 服务是否启动');
      console.error('   - 检查 Docker 容器状态: docker-compose ps');
      console.error('   - 查看 Hydra 日志: docker-compose logs hydra');
    } else if (error.code === 'ENOTFOUND') {
      console.error('   - 主机名解析失败，请检查网络配置');
    } else if (error.code === 'ETIMEDOUT') {
      console.error('   - 连接超时，Hydra 服务可能正在启动中');
    }
    
    return false;
  }
}

app.listen(PORT, async () => {
  console.log(`登录同意应用启动在端口 ${PORT}`);
  console.log(`访问地址: http://localhost:${PORT}`);
  console.log('');
  
  // 检查 Hydra 连接
  const hydraConnected = await checkHydraConnection();
  
  if (!hydraConnected) {
    console.log('');
    console.log('⚠️  警告: Hydra 服务连接失败！');
    console.log('');
    console.log('故障排除步骤:');
    console.log('1. 检查 Docker 服务状态: docker-compose ps');
    console.log('2. 重启 Hydra 服务: docker-compose restart hydra');
    console.log('3. 查看 Hydra 日志: docker-compose logs hydra');
    console.log('4. 确认防火墙设置');
    console.log('');
  } else {
    console.log('');
    console.log('🎉 所有服务连接正常，可以开始测试！');
    console.log('');
  }
}); 