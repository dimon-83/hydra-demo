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
  email TEXT NOT NULL REFERENCES public.profiles(email) ON DELETE CASCADE,
  role TEXT NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  assigned_by TEXT,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  UNIQUE(email, role)
);

-- 为 user_roles 表创建索引
CREATE INDEX IF NOT EXISTS idx_user_roles_email ON public.user_roles(email);
CREATE INDEX IF NOT EXISTS idx_user_roles_active ON public.user_roles(active);

-- 3. 用户权限表 (user_permissions)
CREATE TABLE IF NOT EXISTS public.user_permissions (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL REFERENCES public.profiles(email) ON DELETE CASCADE,
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
  action TEXT DEFAULT 'login',  -- 'login' 或 'logout'
  ip_address INET,
  user_agent TEXT,
  login_at TIMESTAMPTZ DEFAULT NOW(),
  session_id TEXT,
  success BOOLEAN DEFAULT TRUE
);

-- 为 login_events 表创建索引
CREATE INDEX IF NOT EXISTS idx_login_events_user_id ON public.login_events(user_id);
CREATE INDEX IF NOT EXISTS idx_login_events_email ON public.login_events(email);
CREATE INDEX IF NOT EXISTS idx_login_events_login_at ON public.login_events(login_at);

-- 5. 应用程序表 (applications) - 管理集成的应用
CREATE TABLE IF NOT EXISTS public.applications (
  id SERIAL PRIMARY KEY,
  client_id TEXT UNIQUE NOT NULL,
  client_name TEXT NOT NULL,
  client_secret_hash TEXT,  -- 加密存储
  allowed_scopes TEXT[] DEFAULT ARRAY['openid', 'profile', 'email'],
  callback_urls TEXT[] NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 为 applications 表创建索引
CREATE INDEX IF NOT EXISTS idx_applications_client_id ON public.applications(client_id);
CREATE INDEX IF NOT EXISTS idx_applications_active ON public.applications(active);

-- 6. 审计日志表 (audit_logs)
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

-- 创建更新 updated_at 字段的函数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- 为需要的表创建 updated_at 触发器
CREATE TRIGGER update_profiles_updated_at 
  BEFORE UPDATE ON public.profiles 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_applications_updated_at 
  BEFORE UPDATE ON public.applications 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 创建审计触发器函数
CREATE OR REPLACE FUNCTION audit_trigger_function()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs (table_name, operation, old_data, user_email)
    VALUES (TG_TABLE_NAME, TG_OP, to_jsonb(OLD), current_setting('app.current_user_email', true));
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_logs (table_name, operation, old_data, new_data, user_email)
    VALUES (TG_TABLE_NAME, TG_OP, to_jsonb(OLD), to_jsonb(NEW), current_setting('app.current_user_email', true));
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (table_name, operation, new_data, user_email)
    VALUES (TG_TABLE_NAME, TG_OP, to_jsonb(NEW), current_setting('app.current_user_email', true));
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ language 'plpgsql';

-- 为需要审计的表创建审计触发器
CREATE TRIGGER audit_profiles_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_user_roles_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_user_permissions_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.user_permissions
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- 插入默认数据

-- 默认角色
INSERT INTO public.user_roles (email, role, assigned_by) VALUES
('admin@example.com', 'admin', 'system'),
('admin@example.com', 'user', 'system'),
('user1@example.com', 'user', 'system'),
('user2@example.com', 'user', 'system')
ON CONFLICT (email, role) DO NOTHING;

-- 默认权限 (OAuth2 scopes)
INSERT INTO public.user_permissions (email, scope, granted_by) VALUES
-- 管理员权限
('admin@example.com', 'openid', 'system'),
('admin@example.com', 'profile', 'system'),
('admin@example.com', 'email', 'system'),
('admin@example.com', 'offline_access', 'system'),
-- 普通用户权限
('user1@example.com', 'openid', 'system'),
('user1@example.com', 'profile', 'system'),
('user1@example.com', 'email', 'system'),
('user2@example.com', 'openid', 'system'),
('user2@example.com', 'profile', 'system'),
('user2@example.com', 'email', 'system')
ON CONFLICT (email, scope) DO NOTHING;

-- Supabase 应用注册
INSERT INTO public.applications (client_id, client_name, callback_urls, allowed_scopes) VALUES
('supabase-client', 'Supabase Application', 
 ARRAY['https://your-project.supabase.co/auth/v1/callback'],
 ARRAY['openid', 'profile', 'email', 'offline_access'])
ON CONFLICT (client_id) DO NOTHING;

-- 创建 RLS (Row Level Security) 策略

-- 启用 RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- profiles 表的 RLS 策略
CREATE POLICY "用户可以查看自己的配置文件" ON public.profiles
  FOR SELECT USING (email = current_setting('app.current_user_email', true));

CREATE POLICY "用户可以更新自己的配置文件" ON public.profiles
  FOR UPDATE USING (email = current_setting('app.current_user_email', true));

CREATE POLICY "管理员可以查看所有配置文件" ON public.profiles
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_roles 
      WHERE email = current_setting('app.current_user_email', true) 
      AND role = 'admin' AND active = true
    )
  );

-- user_roles 表的 RLS 策略
CREATE POLICY "用户可以查看自己的角色" ON public.user_roles
  FOR SELECT USING (email = current_setting('app.current_user_email', true));

CREATE POLICY "管理员可以管理用户角色" ON public.user_roles
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_roles admin_roles
      WHERE admin_roles.email = current_setting('app.current_user_email', true) 
      AND admin_roles.role = 'admin' AND admin_roles.active = true
    )
  );

-- user_permissions 表的 RLS 策略
CREATE POLICY "用户可以查看自己的权限" ON public.user_permissions
  FOR SELECT USING (email = current_setting('app.current_user_email', true));

CREATE POLICY "管理员可以管理用户权限" ON public.user_permissions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_roles 
      WHERE email = current_setting('app.current_user_email', true) 
      AND role = 'admin' AND active = true
    )
  );

-- login_events 表的 RLS 策略
CREATE POLICY "用户可以查看自己的登录事件" ON public.login_events
  FOR SELECT USING (email = current_setting('app.current_user_email', true));

CREATE POLICY "管理员可以查看所有登录事件" ON public.login_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_roles 
      WHERE email = current_setting('app.current_user_email', true) 
      AND role = 'admin' AND active = true
    )
  );

-- applications 表的 RLS 策略
CREATE POLICY "只有管理员可以管理应用" ON public.applications
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_roles 
      WHERE email = current_setting('app.current_user_email', true) 
      AND role = 'admin' AND active = true
    )
  );

-- audit_logs 表的 RLS 策略
CREATE POLICY "只有管理员可以查看审计日志" ON public.audit_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_roles 
      WHERE email = current_setting('app.current_user_email', true) 
      AND role = 'admin' AND active = true
    )
  );

-- 创建有用的视图

-- 用户详细信息视图
CREATE OR REPLACE VIEW public.user_details AS
SELECT 
  p.id,
  p.email,
  p.display_name,
  p.username,
  p.provider,
  p.avatar_url,
  p.created_at,
  p.updated_at,
  ARRAY_AGG(DISTINCT ur.role) FILTER (WHERE ur.active = true) as roles,
  ARRAY_AGG(DISTINCT up.scope) FILTER (WHERE up.active = true) as permissions
FROM public.profiles p
LEFT JOIN public.user_roles ur ON p.email = ur.email
LEFT JOIN public.user_permissions up ON p.email = up.email
GROUP BY p.id, p.email, p.display_name, p.username, p.provider, p.avatar_url, p.created_at, p.updated_at;

-- 登录统计视图
CREATE OR REPLACE VIEW public.login_statistics AS
SELECT 
  email,
  COUNT(*) as total_logins,
  COUNT(*) FILTER (WHERE action = 'login') as login_count,
  COUNT(*) FILTER (WHERE action = 'logout') as logout_count,
  MAX(login_at) as last_login,
  MIN(login_at) as first_login
FROM public.login_events
GROUP BY email;

-- 创建函数来检查用户权限
CREATE OR REPLACE FUNCTION public.check_user_permission(user_email TEXT, required_scope TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM public.user_permissions 
    WHERE email = user_email 
    AND scope = required_scope 
    AND active = true
    AND (expires_at IS NULL OR expires_at > NOW())
  );
END;
$$ LANGUAGE plpgsql;

-- 创建函数来获取用户角色
CREATE OR REPLACE FUNCTION public.get_user_roles(user_email TEXT)
RETURNS TEXT[] AS $$
BEGIN
  RETURN ARRAY(
    SELECT role 
    FROM public.user_roles 
    WHERE email = user_email 
    AND active = true
    AND (expires_at IS NULL OR expires_at > NOW())
  );
END;
$$ LANGUAGE plpgsql;

-- 注释
COMMENT ON TABLE public.profiles IS 'Hydra OIDC 用户配置文件表';
COMMENT ON TABLE public.user_roles IS '用户角色表，支持多角色和过期时间';
COMMENT ON TABLE public.user_permissions IS '用户权限表，基于 OAuth2 scopes';
COMMENT ON TABLE public.login_events IS '用户登录/注销事件记录';
COMMENT ON TABLE public.applications IS '已注册的 OIDC 客户端应用';
COMMENT ON TABLE public.audit_logs IS '系统操作审计日志';

COMMENT ON FUNCTION public.check_user_permission(TEXT, TEXT) IS '检查用户是否有特定权限';
COMMENT ON FUNCTION public.get_user_roles(TEXT) IS '获取用户的所有有效角色';

-- 完成
SELECT 'Supabase 数据库架构创建完成！' as result; 