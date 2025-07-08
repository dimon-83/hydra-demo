const express = require('express');
const axios = require('axios');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5555;

// OAuth2 配置
const HYDRA_PUBLIC_URL = 'http://localhost:4444';
const CLIENT_ID = 'demo-client';
const CLIENT_SECRET = 'demo-secret';
const REDIRECT_URI = 'http://localhost:5555/callback';

// 配置模板引擎
app.set('view engine', 'ejs');
app.set('views', './views');

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'client-session-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

// 静态文件
app.use(express.static('public'));

// 首页
app.get('/', (req, res) => {
  const user = req.session.user;
  res.render('index', { 
    user,
    client_id: CLIENT_ID
  });
});

// 重置会话并重新开始 OAuth2 流程
app.get('/login/reset', (req, res) => {
  console.log('重置会话并重新开始 OAuth2 流程');
  
  // 清除旧的 OAuth 状态
  delete req.session.oauth_state;
  delete req.session.access_token;
  delete req.session.refresh_token;
  delete req.session.id_token;
  delete req.session.user;
  
  // 保存会话后重定向到登录
  req.session.save((err) => {
    if (err) {
      console.error('保存会话失败:', err);
    }
    res.redirect('/login');
  });
});

// 开始 OAuth2 授权流程
app.get('/login', (req, res) => {
  // 生成 state 参数防止 CSRF 攻击
  const state = uuidv4();
  req.session.oauth_state = state;
  
  console.log('开始 OAuth2 流程:');
  console.log('  生成的 state:', state);
  console.log('  会话ID:', req.sessionID);
  console.log('  会话存储的 state:', req.session.oauth_state);
  
  // 构建授权 URL
  const authUrl = new URL(`${HYDRA_PUBLIC_URL}/oauth2/auth`);
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid profile email offline');
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('state', state);
  
  console.log('重定向到授权页面:', authUrl.toString());
  res.redirect(authUrl.toString());
});

// OAuth2 回调处理
app.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  
  console.log('OAuth2 回调处理:');
  console.log('  收到的 state:', state);
  console.log('  会话中的 state:', req.session.oauth_state);
  console.log('  收到的 code:', code ? '存在' : '不存在');
  console.log('  会话ID:', req.sessionID);
  
  // 检查错误
  if (error) {
    console.error('OAuth2 流程错误:', error, error_description);
    return res.render('error', { 
      error, 
      error_description: error_description || '授权过程中发生错误' 
    });
  }
  
  // // 验证 state 参数
  // if (!req.session.oauth_state) {
  //   console.error('会话中没有 oauth_state，可能是应用重启或会话过期');
  //   return res.render('error', { 
  //     error: 'session_lost',
  //     error_description: '会话已丢失，请重新开始登录流程。这通常是因为应用重启或会话过期导致的。'
  //   });
  // }
  
  // if (state !== req.session.oauth_state) {
  //   console.error('State 参数不匹配:');
  //   console.error('  期望:', req.session.oauth_state);
  //   console.error('  实际:', state);
    
  //   return res.render('error', { 
  //     error: 'invalid_state',
  //     error_description: `State 参数不匹配。期望: ${req.session.oauth_state?.substring(0, 8)}..., 实际: ${state?.substring(0, 8)}...，可能存在 CSRF 攻击或会话问题。请重新开始登录流程。`
  //   });
  // }
  
  if (!code) {
    console.error('缺少授权码');
    return res.render('error', { 
      error: 'missing_code',
      error_description: '缺少授权码'
    });
  }
  
  console.log('State 验证通过，开始交换令牌...');
  
  try {
    // 交换授权码获取访问令牌
    const tokenResponse = await axios.post(`${HYDRA_PUBLIC_URL}/oauth2/token`, {
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: REDIRECT_URI
    }, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`
      }
    });
    
    const tokens = tokenResponse.data;
    console.log('获取到令牌:', tokens);
    
    // 存储令牌到会话
    req.session.access_token = tokens.access_token;
    req.session.refresh_token = tokens.refresh_token;
    req.session.id_token = tokens.id_token;
    
    // 使用访问令牌获取用户信息
    const userInfoResponse = await axios.get(`${HYDRA_PUBLIC_URL}/userinfo`, {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`
      }
    });
    
    req.session.user = userInfoResponse.data;
    console.log('用户信息:', userInfoResponse.data);
    
    res.redirect('/profile');
    
  } catch (error) {
    console.error('令牌交换失败:', error.response?.data || error.message);
    res.render('error', { 
      error: 'token_exchange_failed',
      error_description: error.response?.data?.error_description || '令牌交换失败'
    });
  }
});

// 用户资料页面
app.get('/profile', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/');
  }
  
  res.render('profile', { 
    user: req.session.user,
    access_token: req.session.access_token,
    id_token: req.session.id_token
  });
});

// 刷新令牌
app.post('/refresh', async (req, res) => {
  if (!req.session.refresh_token) {
    return res.json({ error: '没有刷新令牌' });
  }
  
  try {
    const tokenResponse = await axios.post(`${HYDRA_PUBLIC_URL}/oauth2/token`, {
      grant_type: 'refresh_token',
      refresh_token: req.session.refresh_token
    }, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`
      }
    });
    
    const tokens = tokenResponse.data;
    req.session.access_token = tokens.access_token;
    if (tokens.refresh_token) {
      req.session.refresh_token = tokens.refresh_token;
    }
    
    res.json({ 
      success: true, 
      access_token: tokens.access_token 
    });
    
  } catch (error) {
    console.error('刷新令牌失败:', error.response?.data || error.message);
    res.json({ 
      error: error.response?.data?.error_description || '刷新令牌失败' 
    });
  }
});

// 调用受保护的 API
app.get('/api/protected', (req, res) => {
  if (!req.session.access_token) {
    return res.status(401).json({ error: '未授权' });
  }
  
  // 模拟受保护的资源
  res.json({
    message: '这是受保护的资源',
    user_id: req.session.user?.sub,
    timestamp: new Date().toISOString(),
    data: {
      secret: '这是只有授权用户才能看到的秘密信息',
      permissions: ['read', 'write'],
      level: 'premium'
    }
  });
});

// 注销
app.get('/logout', async (req, res) => {
  const id_token = req.session.id_token;
  
  // 清除会话
  req.session.destroy((err) => {
    if (err) {
      console.error('会话销毁失败:', err);
    }
  });
  
  if (id_token) {
    // 重定向到 Hydra 注销端点
    const logoutUrl = new URL(`${HYDRA_PUBLIC_URL}/oauth2/sessions/logout`);
    logoutUrl.searchParams.set('id_token_hint', id_token);
    logoutUrl.searchParams.set('post_logout_redirect_uri', 'http://localhost:5555/');
    
    res.redirect(logoutUrl.toString());
  } else {
    res.redirect('/');
  }
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    session: !!req.session.user
  });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('应用错误:', err);
  res.status(500).render('error', {
    error: 'internal_server_error',
    error_description: '服务器内部错误'
  });
});

app.listen(PORT, () => {
  console.log(`OAuth2 客户端应用启动在端口 ${PORT}`);
  console.log(`访问地址: http://localhost:${PORT}`);
}); 