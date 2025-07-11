// Supabase 集成模块 - 用户映射和同步

const { createClient } = require('@supabase/supabase-js');

class SupabaseIntegration {
  constructor() {
    this.supabaseUrl = process.env.SUPABASE_URL;
    this.supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    
    if (!this.supabaseUrl || !this.supabaseServiceKey) {
      console.warn('⚠️ Supabase 配置缺失，跳过用户同步功能');
      this.enabled = false;
      return;
    }
    
    this.supabase = createClient(this.supabaseUrl, this.supabaseServiceKey);
    this.enabled = true;
    console.log('✅ Supabase 集成已启用');
  }

  /**
   * 同步用户到 Supabase auth.users 表
   * @param {Object} userData - 用户数据
   * @returns {Promise<Object>} 同步结果
   */
  async syncUser(userData) {
    if (!this.enabled) {
      return { success: false, reason: 'Supabase 集成未启用' };
    }

    try {
      const { sub, email, name, preferred_username } = userData;
      
      // 检查用户是否已存在
      const { data: existingUser, error: checkError } = await this.supabase
        .from('auth.users')
        .select('id, email')
        .eq('email', email)
        .single();

      if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = no rows found
        console.error('检查用户失败:', checkError);
        return { success: false, error: checkError };
      }

      if (existingUser) {
        // 用户已存在，更新信息
        const { data, error } = await this.supabase
          .from('auth.users')
          .update({
            raw_user_meta_data: {
              name: name,
              preferred_username: preferred_username,
              provider: 'hydra-oidc',
              updated_at: new Date().toISOString()
            },
            updated_at: new Date().toISOString()
          })
          .eq('id', existingUser.id);

        if (error) {
          console.error('更新用户失败:', error);
          return { success: false, error };
        }

        console.log(`✅ 用户已更新: ${email}`);
        return { success: true, action: 'updated', user: existingUser };

      } else {
        // 创建新用户
        const { data, error } = await this.supabase.auth.admin.createUser({
          email: email,
          email_confirm: true,
          user_metadata: {
            sub: sub,
            name: name,
            preferred_username: preferred_username,
            provider: 'hydra-oidc'
          }
        });

        if (error) {
          console.error('创建用户失败:', error);
          return { success: false, error };
        }

        console.log(`✅ 新用户已创建: ${email}`);
        return { success: true, action: 'created', user: data.user };
      }

    } catch (error) {
      console.error('Supabase 用户同步失败:', error);
      return { success: false, error };
    }
  }

  /**
   * 获取用户的 Supabase 配置文件
   * @param {string} email - 用户邮箱
   * @returns {Promise<Object>} 用户配置文件
   */
  async getUserProfile(email) {
    if (!this.enabled) {
      return null;
    }

    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .select('*')
        .eq('email', email)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('获取用户配置文件失败:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('获取用户配置文件异常:', error);
      return null;
    }
  }

  /**
   * 创建或更新用户配置文件
   * @param {Object} userData - 用户数据
   * @returns {Promise<Object>} 操作结果
   */
  async upsertUserProfile(userData) {
    if (!this.enabled) {
      return { success: false, reason: 'Supabase 集成未启用' };
    }

    try {
      const { sub, email, name, preferred_username } = userData;
      
      const { data, error } = await this.supabase
        .from('profiles')
        .upsert({
          id: sub,
          email: email,
          display_name: name,
          username: preferred_username,
          provider: 'hydra-oidc',
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'email'
        });

      if (error) {
        console.error('更新用户配置文件失败:', error);
        return { success: false, error };
      }

      console.log(`✅ 用户配置文件已更新: ${email}`);
      return { success: true, data };

    } catch (error) {
      console.error('更新用户配置文件异常:', error);
      return { success: false, error };
    }
  }

  /**
   * 记录登录事件
   * @param {Object} loginData - 登录数据
   * @returns {Promise<Object>} 记录结果
   */
  async logLoginEvent(loginData) {
    if (!this.enabled) {
      return { success: false, reason: 'Supabase 集成未启用' };
    }

    try {
      const { data, error } = await this.supabase
        .from('login_events')
        .insert({
          user_id: loginData.sub,
          email: loginData.email,
          provider: 'hydra-oidc',
          ip_address: loginData.ip,
          user_agent: loginData.userAgent,
          login_at: new Date().toISOString()
        });

      if (error) {
        console.error('记录登录事件失败:', error);
        return { success: false, error };
      }

      return { success: true, data };

    } catch (error) {
      console.error('记录登录事件异常:', error);
      return { success: false, error };
    }
  }

  /**
   * 验证用户权限
   * @param {string} email - 用户邮箱
   * @param {string} scope - 请求的权限范围
   * @returns {Promise<boolean>} 是否有权限
   */
  async checkUserPermissions(email, scope) {
    if (!this.enabled) {
      return true; // 如果未启用 Supabase，允许所有权限
    }

    try {
      const { data, error } = await this.supabase
        .from('user_permissions')
        .select('scope')
        .eq('email', email)
        .eq('scope', scope)
        .eq('active', true)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('检查用户权限失败:', error);
        return false;
      }

      return !!data;

    } catch (error) {
      console.error('检查用户权限异常:', error);
      return false;
    }
  }

  /**
   * 获取用户角色
   * @param {string} email - 用户邮箱
   * @returns {Promise<Array>} 用户角色列表
   */
  async getUserRoles(email) {
    if (!this.enabled) {
      return ['user']; // 默认角色
    }

    try {
      const { data, error } = await this.supabase
        .from('user_roles')
        .select('role')
        .eq('email', email)
        .eq('active', true);

      if (error) {
        console.error('获取用户角色失败:', error);
        return ['user'];
      }

      return data.map(item => item.role);

    } catch (error) {
      console.error('获取用户角色异常:', error);
      return ['user'];
    }
  }
}

module.exports = SupabaseIntegration; 