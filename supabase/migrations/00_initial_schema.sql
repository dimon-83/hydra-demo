-- Supabase 数据库架构 - 支持 Hydra OIDC 集成

-- 1. 用户配置文件表 (profiles)
CREATE TABLE IF NOT EXISTS public.profiles (
  id TEXT PRIMARY KEY,  -- 对应 Hydra 的 subject
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  username TEXT,
  provider TEXT DEFAULT 'hydra-oidc',
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 为 profiles 表创建索引
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles(username);

-- 2. 用户角色表 (user_roles)
CREATE TABLE IF NOT EXISTS public.user_roles (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,  -- 改为 user_id 以匹配 auth hooks
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  assigned_by TEXT,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  UNIQUE(user_id, role)
);

-- 为 user_roles 表创建索引
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_email ON public.user_roles(email);
CREATE INDEX IF NOT EXISTS idx_user_roles_active ON public.user_roles(active);

-- 3. 用户权限表 (user_permissions)
CREATE TABLE IF NOT EXISTS public.user_permissions (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  scope TEXT NOT NULL,  -- OAuth2 scope
  active BOOLEAN DEFAULT TRUE,
  granted_by TEXT,
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  UNIQUE(email, scope)
);

-- 为 user_permissions 表创建索引
CREATE INDEX IF NOT EXISTS idx_user_permissions_email ON public.user_permissions(email);
CREATE INDEX IF NOT EXISTS idx_user_permissions_scope ON public.user_permissions(scope);
CREATE INDEX IF NOT EXISTS idx_user_permissions_active ON public.user_permissions(active);

-- 4. 登录事件表 (login_events)
CREATE TABLE IF NOT EXISTS public.login_events (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  provider TEXT DEFAULT 'hydra-oidc',
  action TEXT DEFAULT 'login',
  ip_address INET,
  user_agent TEXT,
  success BOOLEAN DEFAULT TRUE,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 为 login_events 表创建索引
CREATE INDEX IF NOT EXISTS idx_login_events_user_id ON public.login_events(user_id);
CREATE INDEX IF NOT EXISTS idx_login_events_email ON public.login_events(email);
CREATE INDEX IF NOT EXISTS idx_login_events_created_at ON public.login_events(created_at);

-- 5. 审计日志表 (audit_logs)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id SERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL,  -- INSERT, UPDATE, DELETE
  old_data JSONB,
  new_data JSONB,
  user_id TEXT,
  user_email TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- 为 audit_logs 表创建索引
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_name ON public.audit_logs(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON public.audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_email ON public.audit_logs(user_email);

-- 插入默认数据以支持开发环境
INSERT INTO public.profiles (id, email, display_name, username) VALUES
('1', 'admin@example.com', '管理员', 'admin'),
('2', 'user1@example.com', '用户一', 'user1'),
('3', 'user2@example.com', '用户二', 'user2')
ON CONFLICT (email) DO NOTHING;

-- 默认角色
INSERT INTO public.user_roles (user_id, email, role, assigned_by) VALUES
('1', 'admin@example.com', 'admin', 'system'),
('1', 'admin@example.com', 'user', 'system'),
('2', 'user1@example.com', 'user', 'system'),
('3', 'user2@example.com', 'user', 'system')
ON CONFLICT (user_id, role) DO NOTHING;

-- 默认权限 (OAuth2 scopes) - 禁用邮箱验证要求
INSERT INTO public.user_permissions (email, scope, granted_by) VALUES
-- 管理员权限
('admin@example.com', 'openid', 'system'),
('admin@example.com', 'profile', 'system'),
('admin@example.com', 'email', 'system'),
('admin@example.com', 'offline', 'system'),
-- 普通用户权限
('user1@example.com', 'openid', 'system'),
('user1@example.com', 'profile', 'system'),
('user1@example.com', 'email', 'system'),
('user2@example.com', 'openid', 'system'),
('user2@example.com', 'profile', 'system'),
('user2@example.com', 'email', 'system')
ON CONFLICT (email, scope) DO NOTHING; 