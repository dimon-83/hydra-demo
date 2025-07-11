#!/bin/bash

# Hydra-Supabase OIDC 集成测试脚本
# 用于验证集成是否正常工作

set -e

echo "🚀 开始测试 Hydra-Supabase OIDC 集成..."

# 配置变量
HYDRA_PUBLIC_URL="http://localhost:4444"
HYDRA_ADMIN_URL="http://localhost:4445"
SUPABASE_AUTH_URL="http://localhost:9999"
CLIENT_ID="supabase-client"
CLIENT_SECRET="supabase-oidc-secret-2023"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 测试函数
test_endpoint() {
    local url=$1
    local description=$2
    
    echo -n "测试 $description... "
    if curl -s -f "$url" > /dev/null; then
        echo -e "${GREEN}✓ 成功${NC}"
        return 0
    else
        echo -e "${RED}✗ 失败${NC}"
        return 1
    fi
}

test_json_endpoint() {
    local url=$1
    local description=$2
    
    echo -n "测试 $description... "
    response=$(curl -s "$url")
    if echo "$response" | jq . > /dev/null 2>&1; then
        echo -e "${GREEN}✓ 成功${NC}"
        return 0
    else
        echo -e "${RED}✗ 失败 - 无效的JSON响应${NC}"
        return 1
    fi
}

echo "📋 步骤 1: 检查服务健康状态"

# 测试 Hydra 健康状态
test_endpoint "$HYDRA_PUBLIC_URL/health/ready" "Hydra Public 健康检查"
test_endpoint "$HYDRA_ADMIN_URL/health/ready" "Hydra Admin 健康检查"

# 测试 Supabase Auth 健康状态
test_endpoint "$SUPABASE_AUTH_URL/health" "Supabase Auth 健康检查"

echo ""
echo "📋 步骤 2: 检查 OIDC 配置"

# 测试 OIDC 发现端点
test_json_endpoint "$HYDRA_PUBLIC_URL/.well-known/openid_configuration" "OIDC Discovery"

# 测试 JWKS 端点
test_json_endpoint "$HYDRA_PUBLIC_URL/.well-known/jwks.json" "JWKS 端点"

echo ""
echo "📋 步骤 3: 验证 OAuth2 客户端配置"

# 检查客户端是否存在
echo -n "检查 OAuth2 客户端... "
client_response=$(curl -s -H "Content-Type: application/json" \
    "$HYDRA_ADMIN_URL/admin/clients/$CLIENT_ID" 2>/dev/null || echo "")

if echo "$client_response" | jq -e '.client_id' > /dev/null 2>&1; then
    echo -e "${GREEN}✓ 客户端存在${NC}"
    
    # 检查客户端配置
    echo "客户端详情:"
    echo "$client_response" | jq '{
        client_id: .client_id,
        grant_types: .grant_types,
        response_types: .response_types,
        scope: .scope,
        redirect_uris: .redirect_uris
    }'
else
    echo -e "${RED}✗ 客户端不存在或配置错误${NC}"
    echo "创建客户端命令:"
    echo "docker exec hydra hydra create client \\"
    echo "    --endpoint $HYDRA_ADMIN_URL \\"
    echo "    --id $CLIENT_ID \\"
    echo "    --secret $CLIENT_SECRET \\"
    echo "    --grant-types authorization_code,refresh_token \\"
    echo "    --response-types code,id_token \\"
    echo "    --scope openid,offline,email,profile \\"
    echo "    --callbacks $SUPABASE_AUTH_URL/callback"
fi

echo ""
echo "📋 步骤 4: 测试 OAuth2 授权流程"

# 生成授权 URL
echo "生成授权 URL..."
auth_url="$HYDRA_PUBLIC_URL/oauth2/auth"
auth_url+="?client_id=$CLIENT_ID"
auth_url+="&response_type=code"
auth_url+="&scope=openid+email+profile"
auth_url+="&redirect_uri=$SUPABASE_AUTH_URL/callback"
auth_url+="&state=test-state-123"

echo "授权 URL: $auth_url"

echo ""
echo "📋 步骤 5: 测试 Supabase Auth 外部提供商配置"

# 测试 Supabase Auth 配置
echo -n "测试 Supabase Auth 外部提供商端点... "
if curl -s "$SUPABASE_AUTH_URL/authorize?provider=hydra_oidc" | grep -q "redirect\|location" 2>/dev/null; then
    echo -e "${GREEN}✓ 成功${NC}"
else
    echo -e "${YELLOW}⚠ 需要确认配置${NC}"
fi

echo ""
echo "📋 步骤 6: 环境变量检查"

echo "请确认以下环境变量已正确设置:"
echo "EXTERNAL_HYDRA_OIDC_ENABLED=true"
echo "EXTERNAL_HYDRA_OIDC_CLIENT_ID=$CLIENT_ID"
echo "EXTERNAL_HYDRA_OIDC_SECRET=$CLIENT_SECRET"
echo "EXTERNAL_HYDRA_OIDC_REDIRECT_URI=$SUPABASE_AUTH_URL/callback"
echo "EXTERNAL_HYDRA_OIDC_URL=$HYDRA_PUBLIC_URL"

echo ""
echo "📋 步骤 7: 完整流程测试说明"

echo "手动测试完整登录流程:"
echo "1. 访问你的前端应用"
echo "2. 点击 'Sign in with Hydra OIDC'"
echo "3. 应该重定向到 Hydra 登录页面"
echo "4. 完成登录后重定向回应用"
echo "5. 检查 Supabase 会话是否创建成功"

echo ""
echo "📋 测试用例"

# 创建简单的前端测试页面
cat > test-login.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>Hydra OIDC 测试</title>
    <script src="https://unpkg.com/@supabase/supabase-js@2"></script>
</head>
<body>
    <h1>Hydra OIDC 登录测试</h1>
    <button onclick="signInWithHydra()">使用 Hydra OIDC 登录</button>
    <button onclick="checkSession()">检查会话</button>
    <button onclick="signOut()">登出</button>
    
    <div id="result"></div>

    <script>
        const supabase = supabase.createClient(
            'http://localhost:9999',
            'your-anon-key' // 替换为实际的 anon key
        );

        async function signInWithHydra() {
            try {
                const { data, error } = await supabase.auth.signInWithOAuth({
                    provider: 'hydra_oidc',
                    options: {
                        redirectTo: window.location.origin + '/test-login.html',
                        scopes: 'openid profile email'
                    }
                });
                
                if (error) {
                    document.getElementById('result').innerHTML = 
                        '<p style="color:red;">登录错误: ' + error.message + '</p>';
                }
            } catch (err) {
                document.getElementById('result').innerHTML = 
                    '<p style="color:red;">异常: ' + err.message + '</p>';
            }
        }

        async function checkSession() {
            try {
                const { data: { session }, error } = await supabase.auth.getSession();
                if (session) {
                    document.getElementById('result').innerHTML = 
                        '<p style="color:green;">会话有效</p>' +
                        '<pre>' + JSON.stringify(session.user, null, 2) + '</pre>';
                } else {
                    document.getElementById('result').innerHTML = 
                        '<p style="color:orange;">无有效会话</p>';
                }
            } catch (err) {
                document.getElementById('result').innerHTML = 
                    '<p style="color:red;">检查会话异常: ' + err.message + '</p>';
            }
        }

        async function signOut() {
            try {
                const { error } = await supabase.auth.signOut();
                if (!error) {
                    document.getElementById('result').innerHTML = 
                        '<p style="color:green;">已登出</p>';
                }
            } catch (err) {
                document.getElementById('result').innerHTML = 
                    '<p style="color:red;">登出异常: ' + err.message + '</p>';
            }
        }

        // 检查 URL 中的认证结果
        window.addEventListener('load', () => {
            const urlParams = new URLSearchParams(window.location.hash.substring(1));
            if (urlParams.get('access_token')) {
                document.getElementById('result').innerHTML = 
                    '<p style="color:green;">登录成功！</p>';
                checkSession();
            }
        });
    </script>
</body>
</html>
EOF

echo "已创建测试页面: test-login.html"
echo "可以在浏览器中打开此文件进行手动测试"

echo ""
echo "🎉 测试脚本执行完成！"
echo ""
echo -e "${YELLOW}下一步操作：${NC}"
echo "1. 确保所有服务都在运行"
echo "2. 确认客户端配置正确"
echo "3. 使用 test-login.html 进行手动测试"
echo "4. 检查各服务的日志以排查问题"
echo ""
echo -e "${GREEN}如果所有测试都通过，你的 Hydra-Supabase OIDC 集成应该已经正常工作！${NC}" 