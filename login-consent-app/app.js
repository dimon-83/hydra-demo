const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3000;
const HYDRA_ADMIN_URL = 'http://localhost:4445';

// 配置模板引擎
app.set('view engine', 'ejs');
app.set('views', './views');

// 中间件
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: 'session-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

// 静态文件
app.use(express.static('public'));

// 模拟用户数据库
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
    // 验证用户凭据
    const user = users.find(u => u.username === username && u.password === password);
    
    if (!user) {
      const loginRequest = await axios.get(`${HYDRA_ADMIN_URL}/oauth2/auth/requests/login`, {
        params: { login_challenge: challenge }
      });
      
      return res.render('login', {
        challenge,
        client: loginRequest.data.client,
        error: '用户名或密码错误'
      });
    }

    // 接受登录请求
    const acceptLogin = await axios.put(`${HYDRA_ADMIN_URL}/oauth2/auth/requests/login/accept`, {
      subject: user.id,
      remember: !!remember,
      remember_for: remember ? 3600 : 0,
      context: {
        username: user.username,
        email: user.email,
        name: user.name
      }
    }, {
      params: { login_challenge: challenge }
    });

    res.redirect(acceptLogin.data.redirect_to);

  } catch (error) {
    console.error('登录处理失败:', error.response?.data || error.message);
    res.status(500).send('登录处理失败');
  }
});

// 同意页面
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

    const { skip, client, requested_scope, subject, login_session_id } = consentRequest.data;

    // 如果已经同意过，直接接受同意请求
    if (skip) {
      const acceptConsent = await axios.put(`${HYDRA_ADMIN_URL}/oauth2/auth/requests/consent/accept`, {
        grant_scope: requested_scope,
        grant_access_token_audience: consentRequest.data.requested_access_token_audience,
        session: {
          id_token: {
            email: consentRequest.data.context?.email,
            name: consentRequest.data.context?.name
          }
        }
      }, {
        params: { consent_challenge }
      });
      
      return res.redirect(acceptConsent.data.redirect_to);
    }

    // 获取用户信息
    const user = users.find(u => u.id === subject);

    // 显示同意表单
    res.render('consent', {
      challenge: consent_challenge,
      client,
      user,
      scopes: requested_scope
    });

  } catch (error) {
    console.error('获取同意请求失败:', error.response?.data || error.message);
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
    const publicResponse = await axios.get('http://localhost:4444/health/ready', {
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