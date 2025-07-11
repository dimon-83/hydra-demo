# 认证 API 参考

## 📋 概述

本文档详细描述了 Hydra-Supabase 集成系统的认证 API，包括用户登录、令牌管理、用户信息查询等核心功能。

## 🔗 基础信息

- **Base URL**: `https://api.example.com`
- **认证方式**: Bearer Token (JWT)
- **内容类型**: `application/json`
- **API 版本**: v1

## 🔐 认证流程

### 1. 获取授权码

#### 授权端点
```
GET /oauth2/auth
```

**查询参数**:
| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `client_id` | string | ✅ | 客户端ID |
| `response_type` | string | ✅ | 必须为 `code` |
| `scope` | string | ✅ | 请求的权限范围 |
| `redirect_uri` | string | ✅ | 回调地址 |
| `state` | string | ✅ | CSRF 保护参数 |

**示例请求**:
```http
GET /oauth2/auth?client_id=demo-client&response_type=code&scope=openid%20profile%20email&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback&state=xyz123
```

**响应**:
```http
HTTP/1.1 302 Found
Location: https://login.example.com/login?login_challenge=abc123
```

### 2. 交换访问令牌

#### 令牌端点
```
POST /oauth2/token
```

**请求头**:
```http
Content-Type: application/x-www-form-urlencoded
Authorization: Basic <base64(client_id:client_secret)>
```

**请求体**:
```
grant_type=authorization_code&code=<authorization_code>&redirect_uri=<redirect_uri>
```

**示例请求**:
```bash
curl -X POST https://api.example.com/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic ZGVtby1jbGllbnQ6ZGVtby1zZWNyZXQ=" \
  -d "grant_type=authorization_code&code=abc123&redirect_uri=https://app.example.com/callback"
```

**成功响应**:
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "id_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "refresh_token_string",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "openid profile email"
}
```

### 3. 刷新访问令牌

#### 刷新端点
```
POST /oauth2/token
```

**请求体**:
```
grant_type=refresh_token&refresh_token=<refresh_token>
```

**示例请求**:
```bash
curl -X POST https://api.example.com/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic ZGVtby1jbGllbnQ6ZGVtby1zZWNyZXQ=" \
  -d "grant_type=refresh_token&refresh_token=refresh_token_string"
```

## 👤 用户信息 API

### 1. 获取用户信息

#### 用户信息端点
```
GET /oauth2/userinfo
```

**请求头**:
```http
Authorization: Bearer <access_token>
```

**示例请求**:
```bash
curl -X GET https://api.example.com/oauth2/userinfo \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**成功响应**:
```json
{
  "sub": "user-123",
  "email": "user@example.com",
  "email_verified": true,
  "name": "John Doe",
  "given_name": "John",
  "family_name": "Doe",
  "picture": "https://example.com/avatar.jpg",
  "locale": "zh-CN",
  "tenant_id": "tenant-123",
  "roles": ["user", "admin"]
}
```

### 2. 获取用户详细信息

#### 用户详情端点
```
GET /api/v1/user/profile
```

**请求头**:
```http
Authorization: Bearer <access_token>
X-Tenant-ID: <tenant_id>
```

**示例请求**:
```bash
curl -X GET https://api.example.com/api/v1/user/profile \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "X-Tenant-ID: tenant-123"
```

**成功响应**:
```json
{
  "id": "user-123",
  "email": "user@example.com",
  "name": "John Doe",
  "avatar_url": "https://example.com/avatar.jpg",
  "created_at": "2024-01-01T00:00:00Z",
  "last_login": "2024-01-15T10:30:00Z",
  "tenant": {
    "id": "tenant-123",
    "name": "Demo Company",
    "role": "admin"
  },
  "preferences": {
    "language": "zh-CN",
    "timezone": "Asia/Shanghai",
    "theme": "dark"
  }
}
```

### 3. 更新用户信息

#### 更新用户端点
```
PATCH /api/v1/user/profile
```

**请求头**:
```http
Authorization: Bearer <access_token>
Content-Type: application/json
X-Tenant-ID: <tenant_id>
```

**请求体**:
```json
{
  "name": "John Smith",
  "avatar_url": "https://example.com/new-avatar.jpg",
  "preferences": {
    "language": "en-US",
    "timezone": "America/New_York",
    "theme": "light"
  }
}
```

**示例请求**:
```bash
curl -X PATCH https://api.example.com/api/v1/user/profile \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: tenant-123" \
  -d '{"name":"John Smith","preferences":{"theme":"light"}}'
```

**成功响应**:
```json
{
  "id": "user-123",
  "email": "user@example.com",
  "name": "John Smith",
  "avatar_url": "https://example.com/new-avatar.jpg",
  "preferences": {
    "language": "en-US",
    "timezone": "America/New_York",
    "theme": "light"
  },
  "updated_at": "2024-01-15T10:35:00Z"
}
```

## 🎫 会话管理 API

### 1. 获取会话状态

#### 会话状态端点
```
GET /api/v1/auth/session
```

**请求头**:
```http
Authorization: Bearer <access_token>
```

**示例请求**:
```bash
curl -X GET https://api.example.com/api/v1/auth/session \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**成功响应**:
```json
{
  "active": true,
  "user_id": "user-123",
  "client_id": "demo-client",
  "scope": ["openid", "profile", "email"],
  "issued_at": "2024-01-15T10:00:00Z",
  "expires_at": "2024-01-15T11:00:00Z",
  "tenant_id": "tenant-123"
}
```

### 2. 注销会话

#### 注销端点
```
POST /oauth2/revoke
```

**请求头**:
```http
Content-Type: application/x-www-form-urlencoded
Authorization: Basic <base64(client_id:client_secret)>
```

**请求体**:
```
token=<access_token_or_refresh_token>&token_type_hint=access_token
```

**示例请求**:
```bash
curl -X POST https://api.example.com/oauth2/revoke \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic ZGVtby1jbGllbnQ6ZGVtby1zZWNyZXQ=" \
  -d "token=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...&token_type_hint=access_token"
```

**成功响应**:
```http
HTTP/1.1 200 OK
```

### 3. 全局注销

#### 全局注销端点
```
GET /oauth2/sessions/logout
```

**查询参数**:
| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `post_logout_redirect_uri` | string | ❌ | 注销后重定向地址 |

**示例请求**:
```http
GET /oauth2/sessions/logout?post_logout_redirect_uri=https%3A%2F%2Fapp.example.com%2Flogout
```

**响应**:
```http
HTTP/1.1 302 Found
Location: https://app.example.com/logout
```

## 🔑 令牌验证 API

### 1. 内省令牌

#### 内省端点
```
POST /oauth2/introspect
```

**请求头**:
```http
Content-Type: application/x-www-form-urlencoded
Authorization: Basic <base64(client_id:client_secret)>
```

**请求体**:
```
token=<access_token>&token_type_hint=access_token
```

**示例请求**:
```bash
curl -X POST https://api.example.com/oauth2/introspect \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic ZGVtby1jbGllbnQ6ZGVtby1zZWNyZXQ=" \
  -d "token=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...&token_type_hint=access_token"
```

**活跃令牌响应**:
```json
{
  "active": true,
  "client_id": "demo-client",
  "scope": "openid profile email",
  "sub": "user-123",
  "exp": 1642681200,
  "iat": 1642677600,
  "iss": "https://auth.example.com",
  "tenant_id": "tenant-123",
  "email": "user@example.com",
  "name": "John Doe"
}
```

**非活跃令牌响应**:
```json
{
  "active": false
}
```

### 2. 获取公钥

#### JWKS 端点
```
GET /.well-known/jwks.json
```

**示例请求**:
```bash
curl -X GET https://api.example.com/.well-known/jwks.json
```

**成功响应**:
```json
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "kid": "key-1",
      "n": "0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbIS",
      "e": "AQAB",
      "alg": "RS256"
    }
  ]
}
```

## 🏢 租户管理 API

### 1. 获取租户信息

#### 租户信息端点
```
GET /api/v1/tenant/info
```

**请求头**:
```http
Authorization: Bearer <access_token>
X-Tenant-ID: <tenant_id>
```

**示例请求**:
```bash
curl -X GET https://api.example.com/api/v1/tenant/info \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "X-Tenant-ID: tenant-123"
```

**成功响应**:
```json
{
  "id": "tenant-123",
  "name": "Demo Company",
  "domain": "demo.example.com",
  "logo_url": "https://example.com/logo.png",
  "settings": {
    "theme": {
      "primary_color": "#007bff",
      "logo_url": "https://example.com/logo.png"
    },
    "features": {
      "sso_enabled": true,
      "mfa_required": false,
      "password_policy": "strong"
    }
  },
  "subscription": {
    "plan": "premium",
    "status": "active",
    "expires_at": "2024-12-31T23:59:59Z"
  }
}
```

## ⚠️ 错误响应

所有 API 错误都遵循统一的格式：

```json
{
  "error": "error_code",
  "error_description": "Human readable error description",
  "error_uri": "https://docs.example.com/errors/error_code",
  "request_id": "req_123456789"
}
```

### 常见错误码

| 错误码 | HTTP状态 | 说明 |
|--------|----------|------|
| `invalid_request` | 400 | 请求参数错误 |
| `invalid_client` | 401 | 客户端认证失败 |
| `invalid_grant` | 400 | 授权码无效或过期 |
| `unauthorized_client` | 400 | 客户端无权限 |
| `unsupported_grant_type` | 400 | 不支持的授权类型 |
| `invalid_scope` | 400 | 无效的权限范围 |
| `access_denied` | 403 | 访问被拒绝 |
| `temporarily_unavailable` | 503 | 服务暂时不可用 |

## 🔧 SDK 和示例代码

### JavaScript SDK

```javascript
import { HydraAuthClient } from '@example/hydra-auth-sdk';

const authClient = new HydraAuthClient({
  issuer: 'https://auth.example.com',
  clientId: 'demo-client',
  clientSecret: 'demo-secret',
  redirectUri: 'https://app.example.com/callback'
});

// 获取授权URL
const authUrl = authClient.getAuthorizationUrl({
  scope: 'openid profile email',
  state: 'xyz123'
});

// 交换访问令牌
const tokens = await authClient.exchangeAuthorizationCode(code);

// 获取用户信息
const userInfo = await authClient.getUserInfo(tokens.access_token);
```

### Python SDK

```python
from hydra_auth_sdk import HydraAuthClient

auth_client = HydraAuthClient(
    issuer='https://auth.example.com',
    client_id='demo-client',
    client_secret='demo-secret',
    redirect_uri='https://app.example.com/callback'
)

# 获取授权URL
auth_url = auth_client.get_authorization_url(
    scope='openid profile email',
    state='xyz123'
)

# 交换访问令牌
tokens = auth_client.exchange_authorization_code(code)

# 获取用户信息
user_info = auth_client.get_user_info(tokens.access_token)
```

## 📊 速率限制

| 端点 | 限制 | 窗口期 |
|------|------|--------|
| `/oauth2/token` | 100 requests | 1 minute |
| `/oauth2/userinfo` | 1000 requests | 1 minute |
| `/api/v1/user/profile` | 500 requests | 1 minute |
| `/oauth2/introspect` | 2000 requests | 1 minute |

**速率限制响应头**:
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1642681200
```

**超限响应**:
```json
{
  "error": "rate_limit_exceeded",
  "error_description": "API rate limit exceeded",
  "retry_after": 60
}
```

## 📚 相关文档

- [用户管理 API](./user-management.md)
- [权限管理 API](./permissions.md)
- [租户管理 API](./tenant-management.md)
- [安全最佳实践](../security/best-practices.md)
- [错误处理指南](../guides/error-handling.md)

---

> **提示**: 在生产环境中，请确保所有 API 调用都使用 HTTPS，并妥善保管客户端密钥等敏感信息。 