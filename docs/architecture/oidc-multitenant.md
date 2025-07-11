# OIDC 多租户架构设计指南

## 📋 概述

本文档详细介绍如何使用 OIDC (OpenID Connect) 构建多租户身份验证系统，涵盖不同的租户隔离策略、实现模式和最佳实践。

## 🏗️ 多租户模式对比

### 模式 A: 单一 OIDC 提供者 + 租户隔离
```
┌─────────────────────────────────────────┐
│          Single OIDC Provider           │
├─────────────────────────────────────────┤
│  Tenant A    │  Tenant B    │  Tenant C │
│  Client      │  Client      │  Client   │
│  ┌─────────┐ │  ┌─────────┐ │  ┌──────┐ │
│  │ App A   │ │  │ App B   │ │  │ App C│ │
│  └─────────┘ │  └─────────┘ │  └──────┘ │
└─────────────────────────────────────────┘
```

**优势**:
- ✅ 统一身份管理
- ✅ 简化运维
- ✅ 成本效益高
- ✅ 跨租户 SSO 可能

**劣势**:
- ❌ 租户品牌定制有限
- ❌ 安全隔离相对较弱
- ❌ 租户间数据泄露风险

### 模式 B: 每租户独立 OIDC 提供者
```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  Tenant A   │  │  Tenant B   │  │  Tenant C   │
│    OIDC     │  │    OIDC     │  │    OIDC     │
│  Provider   │  │  Provider   │  │  Provider   │
├─────────────┤  ├─────────────┤  ├─────────────┤
│   App A     │  │   App B     │  │   App C     │
└─────────────┘  └─────────────┘  └─────────────┘
```

**优势**:
- ✅ 完全租户隔离
- ✅ 独立品牌定制
- ✅ 独立安全策略
- ✅ 数据主权保障

**劣势**:
- ❌ 运维复杂度高
- ❌ 成本较高
- ❌ 无法跨租户 SSO

## 🛠️ 推荐架构：混合模式

结合两种模式的优势，使用 Hydra + Supabase 的混合架构：

```
┌─────────────────────────────────────────────────────┐
│                 Hydra OIDC Provider                 │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │
│  │  Tenant A   │ │  Tenant B   │ │  Tenant C   │   │
│  │   Client    │ │   Client    │ │   Client    │   │
│  └─────────────┘ └─────────────┘ └─────────────┘   │
└─────────────────────────────────────────────────────┘
              │                     │
              ▼                     ▼
┌─────────────────────┐ ┌─────────────────────┐
│   Supabase A        │ │   Supabase B        │
│   (Tenant A Data)   │ │   (Tenant B Data)   │
└─────────────────────┘ └─────────────────────┘
```

## 🔧 技术实现

### 1. Hydra 多租户客户端配置

```javascript
// 租户客户端管理
class TenantClientManager {
  constructor(hydraClient) {
    this.hydraClient = hydraClient;
    this.tenantClients = new Map();
  }

  // 创建租户客户端
  async createTenantClient(tenantId, config) {
    const clientConfig = {
      client_id: `tenant-${tenantId}-client`,
      client_name: config.name || `Tenant ${tenantId} Client`,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'openid profile email tenant:' + tenantId,
      redirect_uris: [
        `https://${config.domain}/auth/callback`,
        `https://${tenantId}.example.com/auth/callback`
      ],
      post_logout_redirect_uris: [
        `https://${config.domain}/logout`,
        `https://${tenantId}.example.com/logout`
      ],
      // 租户特定元数据
      metadata: {
        tenant_id: tenantId,
        tenant_name: config.name,
        tenant_domain: config.domain,
        supabase_url: config.supabaseUrl,
        supabase_anon_key: config.supabaseAnonKey
      }
    };

    const client = await this.hydraClient.createOAuth2Client(clientConfig);
    this.tenantClients.set(tenantId, client);
    return client;
  }

  // 获取租户客户端
  getTenantClient(tenantId) {
    return this.tenantClients.get(tenantId);
  }
}
```

### 2. 动态租户识别

```javascript
// 租户识别中间件
const tenantIdentifier = (req, res, next) => {
  let tenantId = null;
  
  // 方法1: 通过子域名识别
  const subdomain = req.get('host').split('.')[0];
  if (subdomain !== 'www' && subdomain !== 'api') {
    tenantId = subdomain;
  }
  
  // 方法2: 通过路径识别
  const pathMatch = req.path.match(/^\/tenant\/([^\/]+)/);
  if (pathMatch) {
    tenantId = pathMatch[1];
  }
  
  // 方法3: 通过查询参数识别
  if (req.query.tenant) {
    tenantId = req.query.tenant;
  }
  
  // 方法4: 通过自定义header识别
  if (req.get('X-Tenant-ID')) {
    tenantId = req.get('X-Tenant-ID');
  }
  
  if (!tenantId) {
    return res.status(400).json({ 
      error: 'Tenant identification required' 
    });
  }
  
  req.tenantId = tenantId;
  next();
};

// 使用示例
app.use('/auth', tenantIdentifier);
app.get('/auth/login', async (req, res) => {
  const { tenantId } = req;
  const client = clientManager.getTenantClient(tenantId);
  
  if (!client) {
    return res.status(404).json({ 
      error: 'Tenant not found' 
    });
  }
  
  // 构建授权URL
  const authUrl = `${hydraBaseUrl}/oauth2/auth?` + 
    new URLSearchParams({
      client_id: client.client_id,
      response_type: 'code',
      scope: 'openid profile email tenant:' + tenantId,
      redirect_uri: client.redirect_uris[0],
      state: generateState()
    });
  
  res.redirect(authUrl);
});
```

### 3. 租户数据隔离

```javascript
// Supabase 租户数据管理
class TenantSupabaseManager {
  constructor() {
    this.tenantClients = new Map();
  }

  // 获取租户的 Supabase 客户端
  getTenantClient(tenantId) {
    if (!this.tenantClients.has(tenantId)) {
      const config = this.getTenantConfig(tenantId);
      const client = createClient(
        config.supabaseUrl,
        config.supabaseAnonKey,
        {
          auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true
          }
        }
      );
      this.tenantClients.set(tenantId, client);
    }
    return this.tenantClients.get(tenantId);
  }

  // 租户数据访问控制
  async withTenantRLS(tenantId, operation) {
    const client = this.getTenantClient(tenantId);
    
    // 设置 RLS 上下文
    await client.rpc('set_tenant_context', { 
      tenant_id: tenantId 
    });
    
    try {
      return await operation(client);
    } finally {
      // 清理上下文
      await client.rpc('clear_tenant_context');
    }
  }
}

// 使用示例
const tenantDB = new TenantSupabaseManager();

app.get('/api/users', authenticate, async (req, res) => {
  const { tenantId, user } = req;
  
  try {
    const users = await tenantDB.withTenantRLS(tenantId, async (client) => {
      return await client
        .from('users')
        .select('*')
        .eq('tenant_id', tenantId); // 额外的租户过滤
    });
    
    res.json(users.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### 4. 租户级权限管理

```javascript
// 租户权限系统
class TenantPermissionManager {
  constructor() {
    this.permissions = {
      'tenant-admin': [
        'users:read', 'users:write', 'users:delete',
        'settings:read', 'settings:write',
        'billing:read', 'billing:write'
      ],
      'tenant-user': [
        'users:read', 'profile:write'
      ],
      'tenant-viewer': [
        'users:read'
      ]
    };
  }

  // 检查用户在租户中的权限
  async checkTenantPermission(userId, tenantId, permission) {
    // 从数据库获取用户在该租户中的角色
    const userRole = await this.getUserTenantRole(userId, tenantId);
    
    if (!userRole) {
      return false;
    }
    
    const rolePermissions = this.permissions[userRole];
    return rolePermissions && rolePermissions.includes(permission);
  }

  // 权限中间件
  requireTenantPermission(permission) {
    return async (req, res, next) => {
      const { user, tenantId } = req;
      
      const hasPermission = await this.checkTenantPermission(
        user.sub, 
        tenantId, 
        permission
      );
      
      if (!hasPermission) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          required: permission,
          tenant: tenantId
        });
      }
      
      next();
    };
  }
}

// 使用示例
const permissionManager = new TenantPermissionManager();

app.delete('/api/users/:userId', 
  authenticate,
  tenantIdentifier,
  permissionManager.requireTenantPermission('users:delete'),
  async (req, res) => {
    // 删除用户逻辑
  }
);
```

## 🗄️ 数据库设计

### 租户表结构
```sql
-- 租户表
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  domain VARCHAR(255) UNIQUE NOT NULL,
  subdomain VARCHAR(100) UNIQUE NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  
  -- Hydra 配置
  hydra_client_id VARCHAR(255) UNIQUE NOT NULL,
  hydra_client_secret VARCHAR(255) NOT NULL,
  
  -- Supabase 配置
  supabase_url VARCHAR(255) NOT NULL,
  supabase_anon_key VARCHAR(255) NOT NULL,
  supabase_service_key VARCHAR(255) NOT NULL,
  
  -- 品牌定制
  logo_url VARCHAR(255),
  primary_color VARCHAR(7),
  theme_config JSONB,
  
  -- 功能配置
  features JSONB DEFAULT '{}',
  limits JSONB DEFAULT '{}',
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 租户用户关联表
CREATE TABLE tenant_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL, -- Hydra user ID
  role VARCHAR(50) NOT NULL DEFAULT 'tenant-user',
  status VARCHAR(50) DEFAULT 'active',
  
  -- 用户在租户中的自定义信息
  display_name VARCHAR(255),
  tenant_specific_data JSONB DEFAULT '{}',
  
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_active_at TIMESTAMP WITH TIME ZONE,
  
  UNIQUE(tenant_id, user_id)
);

-- 租户配置表
CREATE TABLE tenant_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  category VARCHAR(100) NOT NULL,
  key VARCHAR(100) NOT NULL,
  value JSONB NOT NULL,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(tenant_id, category, key)
);

-- 行级安全策略 (RLS)
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;

-- RLS 策略
CREATE POLICY "Users can only access their tenant data" 
ON tenant_users 
FOR ALL 
USING (
  tenant_id = current_setting('app.current_tenant_id')::UUID
);
```

## 🔐 安全考虑

### 1. 租户隔离安全
```javascript
// JWT 验证中间件，包含租户验证
const verifyJWTWithTenant = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    // 验证 JWT
    const decoded = jwt.verify(token, getPublicKey());
    
    // 验证租户权限
    const tenantScope = `tenant:${req.tenantId}`;
    if (!decoded.scope?.includes(tenantScope)) {
      return res.status(403).json({ 
        error: 'Token does not have access to this tenant',
        tenant: req.tenantId 
      });
    }

    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};
```

### 2. 数据泄露防护
```sql
-- 强制租户过滤的视图
CREATE VIEW tenant_users_secure AS
SELECT 
  u.*,
  t.name as tenant_name
FROM tenant_users u
JOIN tenants t ON u.tenant_id = t.id
WHERE u.tenant_id = current_setting('app.current_tenant_id')::UUID;

-- 防止跨租户数据访问的函数
CREATE OR REPLACE FUNCTION ensure_tenant_access(check_tenant_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  IF check_tenant_id != current_setting('app.current_tenant_id')::UUID THEN
    RAISE EXCEPTION 'Unauthorized tenant access attempt';
  END IF;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

## 📱 前端集成

### React 多租户客户端
```jsx
// 租户上下文
const TenantContext = createContext();

export const TenantProvider = ({ children }) => {
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 从URL或配置获取租户信息
    const tenantId = getTenantFromURL();
    fetchTenantConfig(tenantId)
      .then(setTenant)
      .finally(() => setLoading(false));
  }, []);

  return (
    <TenantContext.Provider value={{ tenant, loading }}>
      {children}
    </TenantContext.Provider>
  );
};

// OIDC 集成
export const AuthProvider = ({ children }) => {
  const { tenant } = useContext(TenantContext);
  
  if (!tenant) return <div>Loading...</div>;

  const oidcConfig = {
    authority: tenant.oidc_issuer,
    client_id: tenant.client_id,
    redirect_uri: `${window.location.origin}/auth/callback`,
    response_type: 'code',
    scope: `openid profile email tenant:${tenant.id}`,
    post_logout_redirect_uri: `${window.location.origin}/logout`
  };

  return (
    <AuthProvider userManager={new UserManager(oidcConfig)}>
      {children}
    </AuthProvider>
  );
};
```

## 🚀 部署策略

### 1. 单实例多租户部署
```yaml
# docker-compose.yml
version: '3.8'
services:
  hydra:
    image: oryd/hydra:latest
    environment:
      - DSN=postgres://user:pass@postgres:5432/hydra
    volumes:
      - ./hydra-config.yml:/etc/config/hydra/hydra.yml
    
  app:
    build: .
    environment:
      - HYDRA_ADMIN_URL=http://hydra:4445
      - HYDRA_PUBLIC_URL=http://localhost:4444
    depends_on:
      - hydra
      - postgres
    
  postgres:
    image: postgres:13
    environment:
      - POSTGRES_DB=hydra
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
```

### 2. 租户特定配置管理
```javascript
// 配置管理系统
class TenantConfigManager {
  constructor() {
    this.configs = new Map();
  }

  async loadTenantConfig(tenantId) {
    if (!this.configs.has(tenantId)) {
      const config = await this.fetchFromDatabase(tenantId);
      this.configs.set(tenantId, config);
    }
    return this.configs.get(tenantId);
  }

  async updateTenantConfig(tenantId, updates) {
    await this.updateDatabase(tenantId, updates);
    this.configs.delete(tenantId); // 清除缓存
  }
}
```

## 📊 监控和分析

### 租户级别监控
```javascript
// 租户使用统计
class TenantAnalytics {
  async trackLogin(tenantId, userId) {
    await this.record('login', {
      tenant_id: tenantId,
      user_id: userId,
      timestamp: new Date()
    });
  }

  async getTenantStats(tenantId, timeRange) {
    return {
      activeUsers: await this.getActiveUsers(tenantId, timeRange),
      loginCount: await this.getLoginCount(tenantId, timeRange),
      apiUsage: await this.getAPIUsage(tenantId, timeRange)
    };
  }
}
```

## 🔍 故障排除

### 常见问题
1. **租户识别失败**
   - 检查域名配置
   - 验证租户存在性
   - 确认中间件执行顺序

2. **权限问题**
   - 验证 JWT 中的租户声明
   - 检查 RLS 策略
   - 确认用户-租户关联

3. **数据隔离问题**
   - 检查数据库连接配置
   - 验证 RLS 上下文设置
   - 审查查询条件

## 📚 相关文档

- [SAML vs OIDC 协议对比](./protocols-comparison.md)
- [系统整体架构](./system-overview.md)
- [Supabase 集成配置](../guides/supabase-integration.md)
- [安全最佳实践](../security/best-practices.md)

---

> **总结**: OIDC 多租户架构提供了灵活性和安全性的平衡，通过合理的设计可以满足大多数多租户应用的需求。关键是在租户隔离、性能和管理复杂度之间找到平衡点。 