# PinsonBot Connector

OpenClaw 插件，用于连接 PinsonBots Platform

## 功能特性

- ✅ 支持多账号（每个账号对应不同的龙虾）
- ✅ 每龙虾独立认证（per-lobster internal_token）
- ✅ 自动重连（指数退避）
- ✅ 消息队列（离线消息处理）
- ✅ 健康检查
- ✅ 优雅关闭

## 架构说明

### 认证机制

**重要**: 每个龙虾拥有独立的 `internal_token`，实现多租户隔离。

```
Lobster A (id: "1")
  └── internal_token: "token_for_lobster_a_only"

Lobster B (id: "2")
  └── internal_token: "token_for_lobster_b_only"
```

这种设计确保：
- 一个龙虾的 token 不能用于访问其他龙虾
- Token 泄露仅影响单个龙虾
- 完全的多租户隔离

### WebSocket 端点

```
ws://localhost:8000/pinsonbots/internal/plugin?token={internalToken}&lobster_id={lobsterId}
```

**双重验证**:
1. 验证 `lobster_id` 是否存在
2. 验证 `token` 是否与该龙虾的 `internal_token` 匹配

## 安装

```bash
npm install
```

## 配置

### 方式 1: 环境变量（推荐）

创建 `.env` 文件：

```bash
# PinsonBots Platform 配置
PINSONBOT_ENABLED=true
PINSONBOT_ENDPOINT=ws://localhost:8000/pinsonbots/internal/plugin

# 账号配置（格式：lobsterId:internalToken）
# ⚠️ 每个龙虾使用其独立的 internal_token
PINSONBOT_ACCOUNT_CUSTOMER_SERVICE=1:token_for_lobster_1_only
PINSONBOT_ACCOUNT_SALES=2:token_for_lobster_2_only

# 日志配置
LOG_LEVEL=info
```

### 方式 2: 配置文件

创建 `config.json`:

```json
{
  "channels": {
    "pinsonbot": {
      "enabled": true,
      "endpoint": "ws://localhost:8000/pinsonbots/internal/plugin",
      "accounts": {
        "customer-service": {
          "lobsterId": "1",
          "internalToken": "token_for_lobster_1_only",
          "name": "Customer Service Bot"
        },
        "sales": {
          "lobsterId": "2",
          "internalToken": "token_for_lobster_2_only",
          "name": "Sales Bot"
        }
      },
      "retry": {
        "maxAttempts": 5,
        "delayMs": 5000,
        "backoffMultiplier": 2
      }
    }
  },
  "logging": {
    "level": "info"
  }
}
```

## 运行

### 开发模式

```bash
npm run dev
```

### 生产模式

```bash
npm run build
npm start
```

## 获取 Lobster 凭证

### 步骤 1: 登录 PinsonBots Platform

```bash
TOKEN=$(curl -X POST http://localhost:8000/pinsonbots/api/login \
  -d "username=your@email.com&password=yourpassword" \
  | jq -r .access_token)
```

### 步骤 2: 创建新龙虾

```bash
curl -X POST http://localhost:8000/pinsonbots/api/lobsters \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "My Bot", "description": "Customer service bot"}'
```

响应示例：

```json
{
  "lobster": {
    "id": "aB3xK9mN2p",
    "name": "My Bot",
    "appid": "...",
    "is_active": true
  },
  "credentials": {
    "id": "aB3xK9mN2p",
    "appid": "...",
    "appkey": "...",
    "internal_token": "ghi789..."  // ← 这是你需要的！
  }
}
```

### 步骤 3: 配置 Connector

将 `internal_token` 和 `lobster_id` 添加到配置：

```bash
PINSONBOT_ACCOUNT_MYBOT=aB3xK9mN2p:ghi789...
```

## 安全最佳实践

### 1. 保护凭证

```bash
# ✅ 正确：使用环境变量
export PINSONBOT_ACCOUNT_BOT=abc123:token123

# ❌ 错误：硬编码在代码中
const token= "hardcoded_token";
```

### 2. 权限隔离

每个龙虾使用独立的 token：

```bash
# ✅ 正确：不同龙虾使用不同 token
PINSONBOT_ACCOUNT_BOT1=id1:token1
PINSONBOT_ACCOUNT_BOT2=id2:token2

# ❌ 错误：共用 token（也不可行，因为 token 是绑定的）
PINSONBOT_ACCOUNT_BOT1=id1:same_token
PINSONBOT_ACCOUNT_BOT2=id2:same_token
```

### 3. 立即保存凭证

创建龙虾后**立即保存** `internal_token`：

```bash
# 保存到安全位置
echo "Lobster ID: aB3xK9mN2p" >> credentials.txt
echo "Internal Token: ghi789..." >> credentials.txt

# 设置权限
chmod 600 credentials.txt
```

### 4. 定期轮换

建议定期更新凭证：

```bash
# 1. 删除旧龙虾
curl -X DELETE http://localhost:8000/pinsonbots/api/lobsters/aB3xK9mN2p \
  -H "Authorization: Bearer $TOKEN"

# 2. 创建新龙虾
# 3. 更新配置
# 4. 重启 Connector
```

## 故障排查

### 连接失败

**症状**: `WebSocket error: connect ECONNREFUSED`

**解决方案**:
1. 确认 PinsonBots Platform 正在运行
2. 检查 endpoint URL 是否正确
3. 验证防火墙设置

### 认证失败

**症状**: `Disconnected: code=4001 - Invalid lobster ID or internal token`

**解决方案**:
1. 检查 `lobsterId` 是否为 10 位字符串
2. 验证 `internalToken` 是否正确（区分大小写）
3. 确认 token 是该龙虾的（不能跨龙虾使用）

### 多账号问题

**症状**: 某个账号无法连接

**解决方案**:
1. 检查该账号的 `internal_token` 是否正确
2. 验证龙虾状态：`GET /pinsonbots/api/lobsters/{id}`
3. 查看平台日志确认认证细节

## 监控

### 健康检查

Connector 会定期发送 ping 消息保持连接活跃。

### 连接状态

```typescript
connector.getStatus();
// 返回：
{
  "customer-service": {
    "connected": true,
    "lobsterId": "aB3xK9mN2p",
    "queueLength": 0,
    "reconnectAttempts": 0
  },
  "sales": {
    "connected": false,
    "lobsterId": "xY7pL2qR5n",
    "queueLength": 2,
    "reconnectAttempts": 3
  }
}
```

## 开发

### 构建

```bash
npm run build
```

### 测试

```bash
npm test
```

### Lint

```bash
npm run lint
```

## 架构说明

### OpenClaw Channel Plugin

PinsonBot Connector 是一个标准的 OpenClaw Channel Plugin，运行在 OpenClaw Gateway 内部：

```
┌─────────────────────────────────────────┐
│         OpenClaw Gateway                │
│  ┌─────────────────────────────────┐    │
│  │     PinsonBot Channel Plugin    │    │
│  │  ┌───────────────────────────┐  │    │
│  │  │   WebSocket Client        │  │    │
│  │  │   (连接 PinsonBots)       │  │    │
│  │  └───────────────────────────┘  │    │
│  │              │                  │    │
│  │              ▼ SDK              │    │
│  │  ┌───────────────────────────┐  │    │
│  │  │   OpenClaw AI Core        │  │    │
│  │  │   (ctx.sendToGateway)     │  │    │
│  │  └───────────────────────────┘  │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

AI 调用通过 OpenClaw Plugin SDK 的 `ctx.sendToGateway()` 完成，无需额外配置。

## 相关项目

- [pinsonbots-platform](https://github.com/pinsonchen/pinsonbots-platform) - 龙虾管理平台
- [openclaw](https://github.com/pinsonchen/openclaw) - OpenClaw 机器人框架

## 许可证

MIT License

---

**版本**: 2.0.0  
**维护者**: PinsonBots Team
