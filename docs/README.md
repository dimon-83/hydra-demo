# Hydra-Supabase 集成文档

## 📚 文档导航

### 🏗️ 架构设计
- [SAML vs OIDC 协议对比](./architecture/protocols-comparison.md)
- [OIDC 多租户架构设计](./architecture/oidc-multitenant.md)
- [前后端分离认证流程](./architecture/frontend-backend-flow.md)
- [系统整体架构](./architecture/system-overview.md)

### 📖 使用指南
- [快速开始指南](./guides/quick-start.md)
- [本地开发环境配置](./guides/local-development.md)
- [Hydra OIDC 配置指南](./guides/hydra-setup.md)
- [Supabase 集成配置](./guides/supabase-integration.md)
- [Auth Hooks 配置](./guides/auth-hooks.md)

### 🔧 API 文档
- [认证 API 参考](./api/auth-api.md)
- [用户管理 API](./api/user-management.md)
- [权限管理 API](./api/permissions.md)
- [租户管理 API](./api/tenant-management.md)

### 🚀 部署指南
- [Docker 部署](./deployment/docker.md)
- [生产环境配置](./deployment/production.md)
- [监控和日志](./deployment/monitoring.md)
- [故障排除](./deployment/troubleshooting.md)

### 🔒 安全配置
- [安全最佳实践](./security/best-practices.md)
- [JWT 配置和验证](./security/jwt-security.md)
- [数据库安全配置](./security/database-security.md)

### 🧪 测试
- [测试指南](./testing/testing-guide.md)
- [集成测试](./testing/integration-tests.md)
- [安全测试](./testing/security-tests.md)

## 📝 文档贡献指南

### 文档结构
```
docs/
├── README.md                 # 主导航页面
├── architecture/            # 架构设计文档
├── guides/                  # 使用指南
├── api/                     # API 文档
├── deployment/              # 部署相关
├── security/                # 安全配置
└── testing/                 # 测试相关
```

### 编写规范
- 使用中文编写，代码注释可使用英文
- 遵循 Markdown 格式规范
- 包含实际代码示例
- 添加图表说明复杂流程
- 保持文档更新，与代码同步

### 文档模板
每个文档都应包含：
1. 文档标题和简介
2. 目标受众
3. 前置条件
4. 详细步骤或说明
5. 代码示例
6. 常见问题和解决方案
7. 相关链接

## 🔄 文档更新日志

| 日期 | 版本 | 更新内容 | 作者 |
|------|------|----------|------|
| 2024-01-15 | v1.0.0 | 初始文档结构创建 | - |

## 📞 支持和反馈

如果你发现文档中的错误或有改进建议，请：
1. 提交 Issue 描述问题
2. 直接修改文档并提交 Pull Request
3. 联系项目维护者

---

> **提示**: 建议按照文档顺序阅读，特别是新用户应该从 [快速开始指南](./guides/quick-start.md) 开始。 