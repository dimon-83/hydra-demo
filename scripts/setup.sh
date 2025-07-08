#!/bin/bash

echo "=== Ory Hydra OAuth2 服务设置脚本 ==="

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查 Docker 是否运行
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}错误: Docker 未运行，请先启动 Docker${NC}"
    exit 1
fi

echo -e "${YELLOW}1. 启动数据库和 Hydra 服务...${NC}"
docker-compose up -d postgres

# 等待数据库启动
echo -e "${YELLOW}等待数据库启动...${NC}"
sleep 10

echo -e "${YELLOW}2. 运行数据库迁移...${NC}"
docker-compose run --rm hydra-migrate

echo -e "${YELLOW}3. 启动 Hydra 服务...${NC}"
docker-compose up -d hydra

# 等待 Hydra 启动
echo -e "${YELLOW}等待 Hydra 服务启动...${NC}"
sleep 15

echo -e "${YELLOW}4. 创建 OAuth2 客户端...${NC}"

# 创建演示客户端
docker run --rm -it \
  --network hydra-demo_hydra-net \
  oryd/hydra:v1.11.8 \
  clients create \
  --endpoint http://hydra:4445 \
  --id demo-client \
  --secret demo-secret \
  --name "Demo Client Application" \
  --grant-types authorization_code,refresh_token \
  --response-types code,id_token \
  --scope openid,offline,profile,email \
  --callbacks http://localhost:5555/callback

# 创建另一个客户端用于测试
docker run --rm -it \
  --network hydra-demo_hydra-net \
  oryd/hydra:v1.11.8 \
  clients create \
  --endpoint http://hydra:4445 \
  --id test-client \
  --secret test-secret \
  --name "Test Client Application" \
  --grant-types authorization_code,refresh_token \
  --response-types code \
  --scope openid,profile,email \
  --callbacks http://localhost:8080/callback

echo -e "${GREEN}5. 安装登录同意应用依赖...${NC}"
cd login-consent-app
npm install
cd ..

echo -e "${GREEN}6. 安装客户端应用依赖...${NC}"
cd client-app
npm install
cd ..

echo -e "${GREEN}=== 设置完成! ===${NC}"
echo ""
echo -e "${GREEN}服务地址:${NC}"
echo "  Hydra Public API:  http://localhost:4444"
echo "  Hydra Admin API:   http://localhost:4445"
echo "  登录同意应用:     http://localhost:3000"
echo "  客户端应用:       http://localhost:5555"
echo ""
echo -e "${GREEN}启动应用:${NC}"
echo "  1. 启动登录同意应用: cd login-consent-app && npm start"
echo "  2. 启动客户端应用:   cd client-app && npm start"
echo ""
echo -e "${GREEN}测试登录:${NC}"
echo "  用户名: admin, 密码: admin123"
echo "  用户名: user1, 密码: user123"
echo ""
echo -e "${YELLOW}查看服务状态: docker-compose ps${NC}"
echo -e "${YELLOW}查看日志: docker-compose logs -f hydra${NC}" 