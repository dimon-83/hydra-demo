-- Supabase Auth Hooks - 基于官方文档最佳实践
-- https://supabase.com/docs/guides/auth/auth-hooks

-- ============================================================================
-- 1. Before User Created Hook
-- 在用户创建之前执行，用于验证和预处理用户数据
-- ============================================================================

CREATE OR REPLACE FUNCTION public.before_user_created_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  user_email text;
  user_metadata jsonb;
  app_metadata jsonb;
BEGIN
  -- 提取用户信息
  user_email := event->>'email';
  user_metadata := COALESCE(event->'user_metadata', '{}'::jsonb);
  app_metadata := COALESCE(event->'app_metadata', '{}'::jsonb);
  
  -- 日志记录
  RAISE LOG 'Before user created hook triggered for email: %', user_email;
  
  -- 验证用户邮箱域名（可选）
  IF user_email IS NOT NULL THEN
    -- 例如：只允许特定域名注册
    -- IF user_email NOT LIKE '%@allowed-domain.com' THEN
    --   RAISE EXCEPTION 'Email domain not allowed';
    -- END IF;
    
    -- 标准化邮箱地址
    user_email := lower(trim(user_email));
    event := jsonb_set(event, '{email}', to_jsonb(user_email));
  END IF;
  
  -- 设置默认用户元数据
  user_metadata := user_metadata || jsonb_build_object(
    'created_via', 'hydra-oidc',
    'created_at', NOW(),
    'email_verified', true  -- 强制设置为 true，禁用邮箱验证
  );
  
  -- 设置应用元数据
  app_metadata := app_metadata || jsonb_build_object(
    'provider', 'hydra-oidc',
    'providers', jsonb_build_array('hydra-oidc')
  );
  
  -- 更新事件
  event := jsonb_set(event, '{user_metadata}', user_metadata);
  event := jsonb_set(event, '{app_metadata}', app_metadata);
  
  -- 记录用户创建事件到审计表
  BEGIN
    INSERT INTO public.audit_logs (
      table_name,
      operation,
      new_data,
      user_email,
      timestamp
    ) VALUES (
      'auth.users',
      'BEFORE_CREATE',
      event,
      user_email,
      NOW()
    );
  EXCEPTION WHEN OTHERS THEN
    -- 如果审计失败，继续处理但记录警告
    RAISE WARNING 'Failed to log user creation audit: %', SQLERRM;
  END;
  
  RETURN event;
END;
$$;

-- ============================================================================
-- 2. Custom Access Token Hook
-- 为 JWT 添加自定义声明，实现 RBAC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims jsonb;
  user_id uuid;
  user_email text;
  user_roles text[];
  user_permissions text[];
  user_profile record;
BEGIN
  -- 提取用户信息
  user_id := (event->>'user_id')::uuid;
  user_email := event->>'user_email';
  claims := event->'claims';
  
  -- 日志记录
  RAISE LOG 'Custom access token hook triggered for user: %', user_id;
  
  -- 获取用户角色
  SELECT ARRAY_AGG(DISTINCT role) 
  INTO user_roles
  FROM public.user_roles 
  WHERE user_id = (event->>'user_id')::uuid 
    AND active = true 
    AND (expires_at IS NULL OR expires_at > NOW());
  
  -- 获取用户权限
  SELECT ARRAY_AGG(DISTINCT scope) 
  INTO user_permissions
  FROM public.user_permissions 
  WHERE email = user_email 
    AND active = true 
    AND (expires_at IS NULL OR expires_at > NOW());
  
  -- 获取用户配置文件信息
  SELECT * INTO user_profile
  FROM public.profiles 
  WHERE id = user_id::text;
  
  -- 设置默认值
  user_roles := COALESCE(user_roles, ARRAY['user']);
  user_permissions := COALESCE(user_permissions, ARRAY['openid', 'profile', 'email']);
  
  -- 添加自定义声明
  claims := claims || jsonb_build_object(
    'role', 'authenticated',  -- Supabase 标准角色
    'user_roles', user_roles,  -- 应用自定义角色
    'permissions', user_permissions,  -- 用户权限
    'provider', 'hydra-oidc',
    'iss', 'hydra-oidc-provider'
  );
  
  -- 如果有用户配置文件，添加额外信息
  IF user_profile IS NOT NULL THEN
    claims := claims || jsonb_build_object(
      'display_name', user_profile.display_name,
      'username', user_profile.username,
      'avatar_url', user_profile.avatar_url
    );
  END IF;
  
  -- 检查是否是管理员
  IF 'admin' = ANY(user_roles) THEN
    claims := claims || jsonb_build_object(
      'admin', true,
      'can_manage_users', true
    );
  END IF;
  
  -- 更新事件中的 claims
  event := jsonb_set(event, '{claims}', claims);
  
  -- 记录令牌生成事件
  BEGIN
    INSERT INTO public.login_events (
      user_id,
      email,
      provider,
      action,
      success,
      metadata
    ) VALUES (
      user_id::text,
      user_email,
      'hydra-oidc',
      'token_generated',
      true,
      jsonb_build_object(
        'roles', user_roles,
        'permissions', user_permissions,
        'claims_count', jsonb_object_keys(claims)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- 如果记录失败，继续处理但记录警告
    RAISE WARNING 'Failed to log token generation: %', SQLERRM;
  END;
  
  RETURN event;
END;
$$;

-- ============================================================================
-- 3. 权限和安全设置
-- ============================================================================

-- 授予 supabase_auth_admin 执行权限
GRANT EXECUTE ON FUNCTION public.before_user_created_hook TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;

-- 授予 schema 使用权限
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;

-- 撤销其他角色的执行权限
REVOKE EXECUTE ON FUNCTION public.before_user_created_hook FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;

-- 授予 supabase_auth_admin 访问相关表的权限
GRANT SELECT, INSERT, UPDATE ON public.user_roles TO supabase_auth_admin;
GRANT SELECT, INSERT, UPDATE ON public.user_permissions TO supabase_auth_admin;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO supabase_auth_admin;
GRANT SELECT, INSERT ON public.login_events TO supabase_auth_admin;
GRANT SELECT, INSERT ON public.audit_logs TO supabase_auth_admin;

-- 为相关表创建 RLS 策略以允许 auth admin 访问
CREATE POLICY "Allow auth admin full access to user_roles" ON public.user_roles
  AS PERMISSIVE FOR ALL TO supabase_auth_admin USING (true);

CREATE POLICY "Allow auth admin full access to user_permissions" ON public.user_permissions
  AS PERMISSIVE FOR ALL TO supabase_auth_admin USING (true);

CREATE POLICY "Allow auth admin full access to profiles" ON public.profiles
  AS PERMISSIVE FOR ALL TO supabase_auth_admin USING (true);

CREATE POLICY "Allow auth admin insert to login_events" ON public.login_events
  AS PERMISSIVE FOR INSERT TO supabase_auth_admin WITH CHECK (true);

CREATE POLICY "Allow auth admin insert to audit_logs" ON public.audit_logs
  AS PERMISSIVE FOR INSERT TO supabase_auth_admin WITH CHECK (true);

-- ============================================================================
-- 4. 辅助函数 - 用于应用中验证权限
-- ============================================================================

-- 验证当前用户是否有特定权限
CREATE OR REPLACE FUNCTION public.has_permission(required_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.user_permissions 
    WHERE email = auth.email()
      AND scope = required_permission 
      AND active = true
      AND (expires_at IS NULL OR expires_at > NOW())
  );
$$;

-- 获取当前用户的所有角色
CREATE OR REPLACE FUNCTION public.get_current_user_roles()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT ARRAY_AGG(role) 
  FROM public.user_roles 
  WHERE user_id = auth.uid()::text
    AND active = true
    AND (expires_at IS NULL OR expires_at > NOW());
$$;

-- 检查当前用户是否是管理员
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.user_roles 
    WHERE user_id = auth.uid()::text
      AND role = 'admin'
      AND active = true
      AND (expires_at IS NULL OR expires_at > NOW())
  );
$$;

-- 注释
COMMENT ON FUNCTION public.before_user_created_hook(jsonb) IS 'Auth Hook: 在用户创建前执行验证和预处理';
COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS 'Auth Hook: 为访问令牌添加自定义声明和角色信息';
COMMENT ON FUNCTION public.has_permission(text) IS '检查当前用户是否有特定权限';
COMMENT ON FUNCTION public.get_current_user_roles() IS '获取当前用户的所有有效角色';
COMMENT ON FUNCTION public.is_admin() IS '检查当前用户是否是管理员';

-- 完成
SELECT 'Auth Hooks 创建完成！' as result; 