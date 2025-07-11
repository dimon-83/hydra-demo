# Hydra-Supabase 跨命名空间网络共享配置指南

## 概述

本配置实现了 Hydra 和 Supabase 在不同命名空间下通过共享网络进行通信的架构。Supabase 命名空间下的服务可以通过内部域名 `hydra:4444` 访问 Hydra OAuth2/OIDC 服务。

## 架构说明

### 网络架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    hydra-shared-network                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────┐    ┌─────────────────────────┐    │
│  │   hydra-demo 命名空间    │    │   supabase 命名空间      │    │
│  │                         │    │                         │    │
│  │  ┌─────────────────┐    │    │  ┌─────────────────┐    │    │
│  │  │ hydra-server    │    │    │  │ supabase-auth   │    │    │
│  │  │ (hydra:4444)    │◄───┼────┼──┤ 访问 hydra:4444  │    │    │
│  │  └─────────────────┘    │    │  └─────────────────┘    │    │
│  │                         │    │                         │    │
│  │  ┌─────────────────┐    │    │  ┌─────────────────┐    │    │
│  │  │ postgres        │    │    │  │ postgres-supabase│    │    │
│  │  └─────────────────┘    │    │  └─────────────────┘    │    │
│  │                         │    │                         │    │
│  │  ┌─────────────────┐    │    │  ┌─────────────────┐    │    │
│  │  │ login-consent   │    │    │  │ supabase-rest   │    │    │
│  │  │ (10.38.211.67)  │    │    │  └─────────────────┘    │    │
│  │  └─────────────────┘    │    │                         │    │
│  └─────────────────────────┘    └─────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 服务端口映射

| 服务                    | 内部端口 | 外部端口 | 访问地址                  |
|-------------------------|----------|----------|---------------------------|
| Hydra Public API        | 4444     | 4444     | http://localhost:4444     |
| Hydra Admin API         | 4445     | 4445     | http://localhost:4445     |
| Hydra Login-Consent     | 3000     | 3000     | http://10.38.211.67:3000  |
| Supabase Auth           | 8080     | 9999     | http://localhost:9999     |
| Supabase REST           | 3000     | 3001     | http://localhost:3001     |
| Supabase Dashboard      | 3000     | 3002     | http://localhost:3002     |

## 配置文件说明

### 1. docker-compose.shared-network.yml
Hydra 命名空间的配置文件，包含：
- PostgreSQL 数据库
- Hydra OAuth2/OIDC 服务器
- Login-Consent 应用
- 数据库迁移任务

关键配置：
- 使用外部共享网络 `hydra-shared-network`
- Login-Consent 使用 IP 地址 `10.38.211.67:3000`
- 启用 CORS 支持跨域访问

### 2. docker-compose.supabase-namespace.yml
Supabase 命名空间的配置文件，包含：
- PostgreSQL 数据库
- Supabase Auth 服务
- Supabase REST API
- Supabase Dashboard

关键配置：
- 同时连接本地网络和共享网络
- 通过 `hydra:4444` 访问 Hydra 服务

### 3. hydra.shared-network.yml
Hydra 服务的配置文件，配置了：
- 内部域名访问方式
- CORS 跨域设置
- OAuth2/OIDC 参数
- Login-Consent 的 IP 地址

## 启动步骤

### 使用 PowerShell 脚本（推荐）

```powershell
# 在 PowerShell 中执行
./start-shared-network.ps1
```

### 使用 Bash 脚本

```bash
# 在 Git Bash 或 WSL 中执行
chmod +x start-shared-network.sh
./start-shared-network.sh
```

### 手动启动

1. **创建共享网络**
```bash
docker network create hydra-shared-network
```

2. **启动 Hydra 命名空间**
```bash
docker-compose -f docker-compose.shared-network.yml up -d
```

3. **等待 Hydra 启动并检查健康状态**
```bash
curl http://localhost:4444/health/ready
```

4. **启动 Supabase 命名空间**
```bash
docker-compose -f docker-compose.supabase-namespace.yml up -d
```

5. **创建 OAuth2 客户端**
```bash
docker exec hydra-server hydra clients create \
    --endpoint http://localhost:4445 \
    --id supabase-client \
    --secret supabase-oidc-secret-2023 \
    --grant-types authorization_code,refresh_token \
    --response-types code,id_token \
    --scope openid,offline \
    --callbacks http://localhost:9999/callback \
    --token-endpoint-auth-method client_secret_post \
    --skip-tls-verify
```

## 验证配置

### 1. 检查 Hydra 服务状态
```bash
curl http://localhost:4444/health/ready
curl http://localhost:4444/.well-known/openid_configuration
```

### 2. 检查网络连接
```bash
# 检查 Supabase 容器是否能访问 Hydra
docker exec supabase-auth nslookup hydra
docker exec supabase-auth curl -s http://hydra:4444/health/ready
```

### 3. 验证 OAuth2 客户端
```bash
docker exec hydra-server hydra clients get supabase-client --endpoint http://localhost:4445
```

## 重要配置说明

### 1. 网络配置
- **共享网络名称**: `hydra-shared-network`
- **网络类型**: Bridge
- **DNS 解析**: 容器名称自动解析

### 2. 安全配置
- Hydra 使用 HTTP（开发环境）
- 启用了 CORS 支持
- 客户端密钥：`supabase-oidc-secret-2023`

### 3. 关键环境变量

#### Hydra 服务
```yaml
- URLS_SELF_ISSUER=http://hydra:4444
- URLS_CONSENT=http://10.38.211.67:3000/consent
- URLS_LOGIN=http://10.38.211.67:3000/login
- URLS_LOGOUT=http://10.38.211.67:3000/logout
- URLS_ERROR=http://10.38.211.67:3000/error
```

#### Supabase Auth
```yaml
- EXTERNAL_HYDRA_OIDC_ENABLED=true
- EXTERNAL_HYDRA_OIDC_CLIENT_ID=supabase-client
- EXTERNAL_HYDRA_OIDC_SECRET=supabase-oidc-secret-2023
- EXTERNAL_HYDRA_OIDC_URL=http://hydra:4444
```

## 故障排除

### 1. 网络连接问题
```bash
# 检查共享网络是否存在
docker network ls | grep hydra-shared-network

# 检查容器是否在共享网络中
docker network inspect hydra-shared-network
```

### 2. 服务启动问题
```bash
# 查看 Hydra 服务日志
docker-compose -f docker-compose.shared-network.yml logs hydra

# 查看 Supabase 服务日志
docker-compose -f docker-compose.supabase-namespace.yml logs supabase-auth
```

### 3. DNS 解析问题
```bash
# 在 Supabase 容器中测试 DNS 解析
docker exec supabase-auth nslookup hydra
docker exec supabase-auth ping hydra
```

## 停止服务

```bash
# 停止 Supabase 命名空间
docker-compose -f docker-compose.supabase-namespace.yml down

# 停止 Hydra 命名空间
docker-compose -f docker-compose.shared-network.yml down

# 删除共享网络（可选）
docker network rm hydra-shared-network
```

## 生产环境注意事项

1. **使用 HTTPS**: 在生产环境中应配置 SSL/TLS
2. **安全配置**: 修改默认密钥和敏感信息
3. **网络隔离**: 考虑使用更严格的网络策略
4. **监控和日志**: 配置适当的监控和日志收集
5. **备份策略**: 实施数据库备份和恢复策略

## 参考资料

- [Ory Hydra 官方文档](https://www.ory.sh/hydra/docs/)
- [Supabase 官方文档](https://supabase.com/docs)
- [Docker Compose 网络配置](https://docs.docker.com/compose/networking/)
- [OAuth2/OIDC 标准](https://oauth.net/2/) 