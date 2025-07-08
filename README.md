# Ory Hydra OAuth2 单点登录服务

这是一个基于 **Ory Hydra** 的完整 OAuth2 和 OpenID Connect 单点登录解决方案演示项目。

## 🎯 项目特性

- ✅ OAuth2 授权码流程 (Authorization Code Flow)
- ✅ OpenID Connect 支持
- ✅ 完整的登录/同意/注销流程
- ✅ 访问令牌和刷新令牌管理
- ✅ JWT ID Token 支持
- ✅ CSRF 保护 (State 参数)
- ✅ 多客户端支持
- ✅ 美观的用户界面
- ✅ 中文本地化

## 🏗️ 架构组件

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   客户端应用     │    │   登录同意应用   │    │   Ory Hydra     │
│  (Port: 5555)   │◄──►│  (Port: 3000)   │◄──►│  (Port: 4444)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                                       │
                                               ┌─────────────────┐
                                               │   PostgreSQL    │
                                               │  (Port: 5432)   │
                                               └─────────────────┘
```

### 组件说明

1. **Ory Hydra** - OAuth2/OIDC 授权服务器
2. **登录同意应用** - 处理用户登录和授权同意
3. **客户端应用** - 演示如何集成 OAuth2 认证
4. **PostgreSQL** - 存储 Hydra 的配置和会话数据

## 🚀 快速开始

### 前提条件

- Docker 和 Docker Compose
- Node.js 16+ (用于运行示例应用)
- Git

### 1. 克隆项目

```bash
git clone <your-repo-url>
cd hydra-demo
```

### 2. 设置和启动服务

```bash
# 给脚本执行权限
chmod +x scripts/setup.sh

# 运行设置脚本
./scripts/setup.sh
```

设置脚本会自动：
- 启动 PostgreSQL 数据库
- 运行 Hydra 数据库迁移
- 启动 Hydra 服务
- 创建 OAuth2 客户端
- 安装应用依赖

### 3. 启动应用

**启动登录同意应用：**
```bash
cd login-consent-app
npm start
```

**启动客户端应用：**
```bash
cd client-app
npm start
```

### 4. 访问应用

- **客户端应用**: http://localhost:5555
- **Hydra 公共API**: http://localhost:4444
- **Hydra 管理API**: http://localhost:4445
- **登录同意应用**: http://localhost:3000

## 🔧 配置说明

### Hydra 配置 (hydra.yml)

主要配置项：

```yaml
# 数据库连接
dsn: postgres://hydra:secret@localhost:5432/hydra?sslmode=disable

# 服务端口
serve:
  public:
    port: 4444  # 公共API端口
  admin:
    port: 4445  # 管理API端口

# 重要的URL配置
urls:
  login: http://localhost:3000/login      # 登录页面
  consent: http://localhost:3000/consent  # 同意页面
  logout: http://localhost:3000/logout    # 注销页面
```

### OAuth2 客户端配置

默认创建了两个客户端：

```yaml
# 演示客户端
客户端ID: demo-client
客户端密钥: demo-secret
回调URL: http://localhost:5555/callback

# 测试客户端
客户端ID: test-client
客户端密钥: test-secret
回调URL: http://localhost:8080/callback
```

## 👥 测试用户

系统预设了以下测试用户：

| 用户名 | 密码 | 角色 |
|--------|------|------|
| admin | admin123 | 管理员 |
| user1 | user123 | 普通用户 |
| user2 | user456 | 普通用户 |

## 🔄 OAuth2 流程说明

### 1. 授权码流程

```
1. 用户访问客户端应用
2. 客户端重定向到 Hydra 授权端点
3. Hydra 重定向到登录页面
4. 用户输入凭据，登录应用验证并接受登录
5. Hydra 重定向到同意页面
6. 用户确认授权，同意应用接受同意
7. Hydra 重定向回客户端并带上授权码
8. 客户端使用授权码交换访问令牌
9. 客户端使用访问令牌获取用户信息
```

### 2. 令牌类型

- **Access Token**: 用于访问受保护资源的 JWT 令牌
- **Refresh Token**: 用于刷新访问令牌的长期令牌
- **ID Token**: 包含用户身份信息的 JWT 令牌

## 🏗️ 会话存储架构

### 📊 多服务器 Session 存储说明

在本项目中，有**多个独立的服务器**，每个都有自己的 Session 存储：

```
┌─────────────────────────────────────────────────────────────────┐
│                    会话存储架构图                                │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   浏览器 Browser │    │  客户端应用服务器  │    │   Hydra 服务器   │
│                │    │  (client-app)   │    │ (OAuth2 Server) │
│  只存 Cookie ID  │◄──►│   Port: 5555    │◄──►│   Port: 4444    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                       │
                                ▼                       ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │   Session 存储   │    │  Hydra Session  │
                       │                │    │                │
                       │ • access_token  │    │ • login_session │
                       │ • id_token      │    │ • consent_data  │
                       │ • user_info     │    │ • oauth_state   │
                       │ • oauth_state   │    │                │
                       └─────────────────┘    └─────────────────┘
```

### 🔍 Session 存储位置详解

#### 1. **客户端应用 Session** (您常用的 `req.session`)
```javascript
// 存储位置：客户端应用服务器 (localhost:5555)
req.session = {
  oauth_state: "uuid-generated-by-client",     // 客户端生成的状态
  access_token: "eyJhbGci...",                // 从 Hydra 获取的访问令牌
  id_token: "eyJhbGci...",                    // 从 Hydra 获取的身份令牌
  refresh_token: "refresh_token_string",       // 刷新令牌
  user: {                                     // 用户信息
    sub: "1",
    name: "管理员",
    email: "admin@example.com"
  }
}
```

**特点**：
- 🏠 存储在：**客户端应用服务器内存中**
- 🔄 生命周期：应用重启时丢失
- 🎯 用途：管理用户登录状态和令牌

#### 2. **Hydra Session** (OAuth2 服务器内部)
```javascript
// 存储位置：Hydra 服务器 + PostgreSQL 数据库
{
  login_session_id: "hydra-generated-id",     // Hydra 生成的登录会话
  subject: "1",                               // 用户主体
  login_challenge: "challenge-string",         // 登录挑战
  consent_challenge: "consent-string",         // 同意挑战
  authenticated_at: "2023-12-01T10:00:00Z",  // 认证时间
  expires_at: "2023-12-01T11:00:00Z"         // 过期时间
}
```

**特点**：
- 🏠 存储在：**Hydra 服务器 + PostgreSQL 数据库**
- 🔄 生命周期：持久化存储，支持集群
- 🎯 用途：OAuth2 流程状态管理

#### 3. **登录同意应用 Session** (可选)
```javascript
// 存储位置：登录同意应用服务器 (localhost:3000)
// 通常用于临时存储登录表单数据等
```

### 🔄 完整的数据流程

```mermaid
sequenceDiagram
    participant Browser as 浏览器
    participant ClientApp as 客户端应用<br/>(Port: 5555)
    participant Hydra as Hydra 服务器<br/>(Port: 4444)
    participant LoginApp as 登录同意应用<br/>(Port: 3000)

    Browser->>ClientApp: 1. 访问 /login
    ClientApp->>ClientApp: 2. 生成 state，存储在自己的 session
    ClientApp->>Browser: 3. 重定向到 Hydra
    Browser->>Hydra: 4. OAuth2 授权请求
    Hydra->>Hydra: 5. 创建 login_challenge，存储在自己的数据库
    Hydra->>Browser: 6. 重定向到登录页面
    Browser->>LoginApp: 7. 访问登录页面
    LoginApp->>LoginApp: 8. 可能有临时 session 存储表单数据
    LoginApp->>Hydra: 9. 接受登录请求
    Hydra->>Browser: 10. 重定向回客户端
    Browser->>ClientApp: 11. 携带授权码返回
    ClientApp->>ClientApp: 12. 验证 state（从自己的 session）
    ClientApp->>Hydra: 13. 交换令牌
    Hydra->>ClientApp: 14. 返回 access_token、id_token
    ClientApp->>ClientApp: 15. 存储令牌到自己的 session
```

### �� 关键区别

| 存储位置 | 服务器 | 存储内容 | 访问方式 | 生命周期 |
|----------|--------|----------|----------|----------|
| **客户端应用 Session** | localhost:5555 | 用户令牌、状态 | `req.session.access_token` | 应用重启丢失 |
| **Hydra Session** | localhost:4444 | OAuth2 流程状态 | Hydra 内部管理 | 持久化存储 |
| **浏览器 Cookie** | 浏览器本地 | Session ID | 自动发送 | 过期时间控制 |

### 💡 为什么这样设计？

#### 1. **安全隔离**
- 客户端应用只管理自己的用户状态
- Hydra 只管理 OAuth2 协议相关状态
- 各自负责各自的安全边界

#### 2. **可扩展性**
- 多个客户端应用可以连接同一个 Hydra
- 每个客户端应用独立管理自己的用户会话
- Hydra 可以服务多个不同的应用

#### 3. **职责分离**
```javascript
// 客户端应用负责：
- 用户体验相关的会话管理
- 令牌的本地存储和使用
- 业务逻辑相关的状态

// Hydra 负责：
- OAuth2 协议的标准实现
- 安全的令牌颁发和验证
- 跨应用的身份联合
```

### 🔧 实际验证方法

您可以通过以下方式验证这个架构：

#### 1. **重启客户端应用**
```bash
# 重启客户端应用
cd client-app
# Ctrl+C 停止，然后重新启动
npm start
# 结果：客户端的 req.session 数据丢失，需要重新登录
```

#### 2. **重启 Hydra 服务**
```bash
# 重启 Hydra 服务
docker-compose restart hydra
# 结果：Hydra 的 session 数据保留（存储在数据库中）
```

#### 3. **查看数据库**
```bash
# 连接到 PostgreSQL 查看 Hydra 的会话数据
docker exec -it hydra-postgres psql -U hydra -d hydra
\dt  # 查看表结构，会看到 Hydra 相关的会话表
```

## ✅ 总结

**重要澄清**：
- ❌ Session **不是**存储在 OSS 认证中心（Hydra）
- ✅ Session **是**存储在**客户端应用自己的服务器**上
- 🔄 Hydra 有自己独立的会话管理机制
- 🏗️ 这是一个**多服务器分布式架构**，每个服务器管理自己的会话数据

这种设计确保了安全性、可扩展性和职责分离！

## 📁 项目结构

```
hydra-demo/
├── hydra.yml                 # Hydra 主配置文件
├── docker-compose.yml        # Docker 服务编排
├── scripts/
│   └── setup.sh             # 自动设置脚本
├── login-consent-app/        # 登录同意应用
│   ├── app.js               # 主应用逻辑
│   ├── package.json         # 依赖配置
│   └── views/               # EJS 模板
│       ├── login.ejs        # 登录页面
│       ├── consent.ejs      # 同意页面
│       └── error.ejs        # 错误页面
├── client-app/              # 客户端应用
│   ├── client.js           # 主应用逻辑
│   ├── package.json        # 依赖配置
│   └── views/              # EJS 模板
│       ├── index.ejs       # 首页
│       ├── profile.ejs     # 用户资料页
│       └── error.ejs       # 错误页面
└── README.md               # 项目文档
```

## 🔧 开发和调试

### 查看服务状态

```bash
# 查看所有服务状态
docker-compose ps

# 查看 Hydra 日志
docker-compose logs -f hydra

# 查看数据库日志
docker-compose logs -f postgres
```

### 重启服务

```bash
# 重启 Hydra 服务
docker-compose restart hydra

# 重启所有服务
docker-compose restart
```

### 管理 OAuth2 客户端

```bash
# 列出所有客户端
docker run --rm --network hydra-demo_hydra-net \
  oryd/hydra:v1.11.8 clients list --endpoint http://hydra:4445

# 创建新客户端
docker run --rm --network hydra-demo_hydra-net \
  oryd/hydra:v1.11.8 clients create \
  --endpoint http://hydra:4445 \
  --id my-client \
  --secret my-secret \
  --grant-types authorization_code,refresh_token \
  --response-types code \
  --scope openid,profile,email \
  --callbacks http://localhost:8080/callback

# 删除客户端
docker run --rm --network hydra-demo_hydra-net \
  oryd/hydra:v1.11.8 clients delete my-client --endpoint http://hydra:4445
```

## 🔐 安全注意事项

### 生产环境配置

1. **更改默认密钥**：
   ```yaml
   secrets:
     system:
       - "your-production-secret-key"
     cookie:
       - "your-production-cookie-secret"
   ```

2. **启用 HTTPS**：
   ```yaml
   serve:
     public:
       tls:
         cert_path: /path/to/cert.pem
         key_path: /path/to/key.pem
   ```

3. **配置安全的数据库连接**：
   ```yaml
   dsn: postgres://user:password@host:5432/hydra?sslmode=require
   ```

4. **限制 CORS 设置**：
   ```yaml
   serve:
     public:
       cors:
         allowed_origins:
           - "https://your-domain.com"
   ```

## 🛠️ 故障排除

### 常见问题

1. **Docker 服务启动失败**
   ```bash
   # 检查端口占用
   netstat -tulpn | grep :4444
   
   # 清理并重新启动
   docker-compose down -v
   docker-compose up -d
   ```

2. **数据库连接失败**
   ```bash
   # 检查数据库状态
   docker-compose logs postgres
   
   # 重新运行迁移
   docker-compose run --rm hydra-migrate
   ```

3. **客户端认证失败**
   ```bash
   # 验证客户端是否存在
   docker run --rm --network hydra-demo_hydra-net \
     oryd/hydra:v1.11.8 clients get demo-client --endpoint http://hydra:4445
   ```

### 调试技巧

1. **启用调试日志**：
   在 `hydra.yml` 中设置 `log.level: debug`

2. **检查网络连接**：
   ```bash
   # 测试 Hydra 健康状态
   curl http://localhost:4444/health/ready
   
   # 测试管理API
   curl http://localhost:4445/health/ready
   ```

### 📊 HTTP 500 错误解决方案

如果访问 `http://localhost:3000/login?login_challenge=xxx` 时遇到 500 错误：

#### 自动诊断

**Windows 用户:**
```powershell
.\scripts\diagnose.ps1
```

**Linux/Mac 用户:**
```bash
chmod +x scripts/diagnose.sh
./scripts/diagnose.sh
```

#### 手动排查步骤

1. **检查服务状态**
   ```bash
   # 检查所有容器状态
   docker-compose ps
   
   # 检查端口占用
   netstat -an | grep -E ":(3000|4444|4445|5432|5555)"
   ```

2. **检查 Hydra 连接**
   ```bash
   # 测试 Hydra API (Windows 用户请用 PowerShell)
   curl http://localhost:4444/health/ready
   curl http://localhost:4445/health/ready
   ```

3. **检查登录同意应用**
   ```bash
   # 进入应用目录
   cd login-consent-app
   
   # 重启应用 (会显示详细日志)
   npm start
   ```

4. **常见错误类型和解决方案**

   | 错误 | 原因 | 解决方案 |
   |------|------|----------|
   | `ECONNREFUSED` | Hydra 服务未启动 | `docker-compose restart hydra` |
   | `login_challenge 过期` | Challenge 时效性 | 重新开始 OAuth2 流程 |
   | `404 Not Found` | Challenge 无效 | 使用正确的客户端开始流程 |
   | `客户端不存在` | OAuth2 客户端未创建 | 运行 `./scripts/setup.sh` |

#### 快速修复

1. **重新开始完整流程**
   ```bash
   # 1. 停止所有服务
   docker-compose down
   
   # 2. 重新启动
   docker-compose up -d
   
   # 3. 等待服务启动 (约 30 秒)
   
   # 4. 重新设置
   ./scripts/setup.sh
   
   # 5. 启动应用
   cd login-consent-app && npm start
   cd client-app && npm start
   ```

2. **使用测试页面重新开始**
   - 打开 `test-oauth-flow.html` 文件
   - 点击 "开始 OAuth2 登录" 按钮
   - 这会生成新的 login_challenge

#### 特定错误处理

**login_challenge 过期错误:**
```
错误: login_challenge 已过期，请重新开始登录流程
解决: 访问 http://localhost:5555 重新开始 OAuth2 流程
```

**Hydra 服务连接失败:**
```
错误: ECONNREFUSED 或 ENOTFOUND
解决: 
1. 检查 Docker 服务: docker-compose ps
2. 重启 Hydra: docker-compose restart hydra
3. 查看日志: docker-compose logs hydra
```

**客户端配置错误:**
```
错误: 客户端不存在或配置错误
解决: 运行 ./scripts/setup.sh 重新创建客户端
```

## 📚 相关文档

- [Ory Hydra 官方文档](https://www.ory.sh/hydra/docs/)
- [OAuth 2.0 RFC](https://tools.ietf.org/html/rfc6749)
- [OpenID Connect 规范](https://openid.net/connect/)

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## �� 许可证

MIT License 