# 前后端分离架构 - OAuth2 认证流程

## 🏗️ 架构组件

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   前端应用       │    │   后端 API      │    │   Hydra OAuth2  │
│   (React/Vue)   │    │   (Node.js)     │    │   服务器        │
│   Port: 3000    │◄──►│   Port: 8080    │◄──►│   Port: 4444    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
        │                        │                        │
        │                        ▼                        ▼
        │               ┌─────────────────┐    ┌─────────────────┐
        │               │   Redis Store   │    │   PostgreSQL    │
        └─ API 调用 ──►  │   Session 数据  │    │   OAuth2 数据   │
                        └─────────────────┘    └─────────────────┘
```

## 🔄 完整认证流程

### 1. 前端发起登录请求
```javascript
// 前端 (React/Vue)
const handleLogin = async () => {
  // 调用后端 API 获取授权 URL
  const response = await fetch('http://localhost:8080/api/auth/login', {
    method: 'POST',
    credentials: 'include',  // 重要：包含 Cookie
    headers: {
      'Content-Type': 'application/json'
    }
  });
  
  const { authUrl } = await response.json();
  // 重定向到授权页面
  window.location.href = authUrl;
};
```

### 2. 后端生成授权 URL
```javascript
// 后端 API (Node.js)
app.post('/api/auth/login', (req, res) => {
  // 生成 state 参数
  const state = uuidv4();
  
  // 存储 state 到 Session（Redis）
  req.session.oauth_state = state;
  
  // 构建授权 URL
  const authUrl = new URL('http://localhost:4444/oauth2/auth');
  authUrl.searchParams.set('client_id', 'demo-client');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid profile email');
  authUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
  authUrl.searchParams.set('state', state);
  
  res.json({ authUrl: authUrl.toString() });
});
```

### 3. OAuth2 授权流程
```
用户登录 → Hydra 验证 → 重定向到前端 /callback
```

### 4. 前端处理回调
```javascript
// 前端 /callback 页面
useEffect(() => {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const state = urlParams.get('state');
  
  if (code && state) {
    // 发送到后端 API 交换令牌
    fetch('http://localhost:8080/api/auth/callback', {
      method: 'POST',
      credentials: 'include',  // 重要：包含 Session Cookie
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ code, state })
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        // 登录成功，跳转到主页
        window.location.href = '/dashboard';
      }
    });
  }
}, []);
```

### 5. 后端交换令牌并存储
```javascript
// 后端 API 处理回调
app.post('/api/auth/callback', async (req, res) => {
  const { code, state } = req.body;
  
  // 验证 state 参数（从 Redis Session 获取）
  if (state !== req.session.oauth_state) {
    return res.status(400).json({ error: 'Invalid state parameter' });
  }
  
  try {
    // 交换授权码获取令牌
    const tokenResponse = await axios.post('http://localhost:4444/oauth2/token', {
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: 'http://localhost:3000/callback'
    }, {
      headers: {
        'Authorization': `Basic ${Buffer.from('demo-client:demo-secret').toString('base64')}`
      }
    });
    
    const tokens = tokenResponse.data;
    
    // 获取用户信息
    const userResponse = await axios.get('http://localhost:4444/userinfo', {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`
      }
    });
    
    // 存储到 Session（Redis）
    req.session.access_token = tokens.access_token;
    req.session.refresh_token = tokens.refresh_token;
    req.session.id_token = tokens.id_token;
    req.session.user = userResponse.data;
    
    res.json({ success: true, user: userResponse.data });
    
  } catch (error) {
    res.status(500).json({ error: 'Token exchange failed' });
  }
});
```

### 6. 前端调用受保护的 API
```javascript
// 前端调用受保护的 API
const callProtectedAPI = async () => {
  try {
    const response = await fetch('http://localhost:8080/api/protected', {
      method: 'GET',
      credentials: 'include',  // 重要：自动发送 Session Cookie
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('Protected data:', data);
    } else if (response.status === 401) {
      // 未授权，重新登录
      window.location.href = '/login';
    }
  } catch (error) {
    console.error('API call failed:', error);
  }
};
```

### 7. 后端验证 Session 并响应
```javascript
// 后端受保护的 API 端点
app.get('/api/protected', (req, res) => {
  // 检查 Session 中的访问令牌（从 Redis 获取）
  if (!req.session.access_token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // 返回受保护的数据
  res.json({
    message: 'This is protected data',
    user: req.session.user,
    timestamp: new Date().toISOString()
  });
});
```

## 🔧 关键配置

### 后端 Session 配置
```javascript
const session = require('express-session');
const RedisStore = require('connect-redis')(session);
const cors = require('cors');

// CORS 配置
app.use(cors({
  origin: 'http://localhost:3000',  // 前端域名
  credentials: true  // 允许发送 Cookie
}));

// Session 配置
app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: 'backend-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,  // 开发环境设为 false，生产环境设为 true
    httpOnly: true,  // 防止 XSS 攻击
    maxAge: 24 * 60 * 60 * 1000,  // 24 小时
    sameSite: 'lax'  // CSRF 保护
  }
}));
```

### 前端 Axios 配置
```javascript
// 前端全局 Axios 配置
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8080/api',
  withCredentials: true  // 自动发送 Cookie
});

// 请求拦截器
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      // 自动重定向到登录页
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
```

## 🔐 Session 安全考虑

### 1. Cookie 安全配置
```javascript
cookie: {
  secure: process.env.NODE_ENV === 'production',  // HTTPS only
  httpOnly: true,  // 防止 XSS
  sameSite: 'strict',  // 防止 CSRF
  maxAge: 24 * 60 * 60 * 1000  // 过期时间
}
```

### 2. CORS 安全配置
```javascript
app.use(cors({
  origin: ['http://localhost:3000', 'https://your-domain.com'],
  credentials: true,
  optionsSuccessStatus: 200
}));
```

### 3. Session 数据最小化
```javascript
// 只存储必要的信息
req.session.user = {
  id: user.sub,
  email: user.email,
  // 不存储敏感信息如密码等
};
```

## ✅ 总结

在前后端分离架构中：

1. **Session 存储位置**：后端 API 服务器 + Redis
2. **前端职责**：UI 渲染 + API 调用
3. **后端职责**：Session 管理 + 业务逻辑 + OAuth2 流程
4. **通信方式**：HTTP API + Cookie Session ID
5. **安全保证**：CORS + HttpOnly + SameSite + HTTPS 