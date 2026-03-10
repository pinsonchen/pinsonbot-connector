# PinsonBot Connector 架构修复文档

## 问题描述

### 原始架构错误

**错误设计**: 使用全局唯一的 `internal_token`，所有龙虾共享同一个 token。

```typescript
// ❌ 错误的实现
const config = {
  internalToken: "GLOBAL_TOKEN_SHARED_BY_ALL_LOBSTERS"
};
```

**问题**:
1. **安全风险**: 一个 token 泄露影响所有龙虾
2. **无隔离**: 无法区分不同龙虾的连接
3. **权限过大**: 单个凭证可访问所有龙虾资源

### 正确架构

**正确设计**: 每个龙虾拥有独立的 `internal_token`，实现多租户隔离。

```typescript
// ✅ 正确的实现
const config = {
  accounts: {
    "lobster1": {
      lobsterId: "aB3xK9mN2p",
      internalToken: "token_for_lobster_aB3xK9mN2p_only"
    },
    "lobster2": {
      lobsterId: "xY7pL2qR5n",
      internalToken: "token_for_lobster_xY7pL2qR5n_only"
    }
  }
};
```

**优势**:
1. ✅ **安全隔离**: Token 泄露仅影响单个龙虾
2. ✅ **权限最小化**: 每个 token 只能访问对应的龙虾
3. ✅ **可追溯**: 可以追踪每个龙虾的连接和活动

## 架构对比

| 特性 | 旧架构（错误） | 新架构（正确） |
|------|---------------|---------------|
| Token 范围 | 全局共享 | 每龙虾独立 |
| 认证方式 | 单 token 验证 | lobster_id + token 双重验证 |
| 安全性 | 低（一损俱损） | 高（隔离保护） |
| 权限控制 | 粗粒度 | 细粒度 |
| 多租户支持 | ❌ 不支持 | ✅ 完整支持 |

## 平台端验证逻辑

### 旧逻辑（不安全）

```python
# ❌ 错误的验证
if token == GLOBAL_INTERNAL_TOKEN:
    accept_connection()
```

### 新逻辑（安全）

```python
# ✅ 正确的验证
@app.websocket("/pinsonbots/internal/plugin")
async def plugin_endpoint(websocket, token: str, lobster_id: str):
    # 同时验证 lobster_id 存在 AND token 匹配该龙虾
    lobster= db.query(Lobster).filter(
        Lobster.id == lobster_id,
        Lobster.internal_token == token  # 关键：验证 token 属于这个 lobster
    ).first()
    
    if not lobster:
        await websocket.close(code=4001, reason="Invalid credentials")
       return
    
    await accept_connection(lobster)
```

## 迁移指南

### 步骤 1: 获取新凭证

登录 PinsonBots Platform，为每个龙虾获取新的 `internal_token`:

```bash
# 查询现有龙虾列表
curl http://localhost:8000/pinsonbots/api/lobsters \
  -H "Authorization: Bearer $TOKEN"

# ⚠️ 注意：API 不再返回 internal_token
# 需要删除并重新创建龙虾以获取新 token
```

### 步骤 2: 更新配置

修改 `.env` 或 `config.json`:

```bash
# 旧配置（错误）
PINSONBOT_INTERNAL_TOKEN=global_shared_token

# 新配置（正确）
PINSONBOT_ACCOUNT_BOT1=aB3xK9mN2p:token_for_bot1_only
PINSONBOT_ACCOUNT_BOT2=xY7pL2qR5n:token_for_bot2_only
```

### 步骤 3: 重启 Connector

```bash
npm restart
```

### 步骤 4: 验证连接

检查日志确认每个账号独立连接：

```
🦞 Initializing account: customer-service
   Lobster ID: aB3xK9mN2p
   Internal Token: token_for_a...

🦞 Initializing account: sales
   Lobster ID: xY7pL2qR5n
   Internal Token: token_for_x...

✅ [customer-service] Connected to PinsonBots Platform
✅ [sales] Connected to PinsonBots Platform
```

## 测试用例

### 测试 1: 正常连接

```bash
# 配置正确的凭证
PINSONBOT_ACCOUNT_TEST=aB3xK9mN2p:correct_token

# 预期结果：连接成功
✅ [test] Connected to PinsonBots Platform
```

### 测试 2: 错误 Token

```bash
# 配置错误的 token
PINSONBOT_ACCOUNT_TEST=aB3xK9mN2p:wrong_token

# 预期结果：认证失败
❌ [test] Disconnected: 4001 - Invalid lobster ID or internal token
```

### 测试 3: 跨龙虾攻击

```bash
# 使用 Lobster A 的 token 尝试连接 Lobster B
PINSONBOT_ATTACKER=xY7pL2qR5n:token_from_lobster_A

# 预期结果：认证失败（即使 token 是有效的，但不属于这个 lobster）
❌ [attacker] Disconnected: 4001 - Invalid credentials
```

## 代码变更总结

### ws-client.ts

```typescript
// ✅ 新增：支持 per-lobster 认证
export class PinsonBotWSClient {
  constructor(
    lobsterId: string,      // ← 新增参数
    internalToken: string,  // ← 改为 per-lobster
   endpoint: string
  ) {
    // 构建 URL 时包含 lobster_id
   const url = new URL(endpoint);
    url.searchParams.append('token', this.internalToken);
    url.searchParams.append('lobster_id', this.lobsterId); // ← 新增
  }
}
```

### config-schema.ts

```typescript
// ✅ 新增：多账号支持
interface ConfigSchema {
  channels: {
    pinsonbot: {
      accounts: {
        [accountName: string]: {
          lobsterId: string;      // ← 新增
          internalToken: string;  // ← per-lobster token
        };
      };
    };
  };
}
```

### index.ts

```typescript
// ✅ 新增：遍历所有账号
for (const [accountName, accountConfig] of Object.entries(accounts)) {
  const client = new PinsonBotWSClient(
    accountConfig.lobsterId,      // ← 每个账号独立的 lobster_id
    accountConfig.internalToken   // ← 每个账号独立的 token
  );
}
```

## 安全建议

### 1. 凭证管理

```bash
# ✅ 推荐：使用密钥管理工具
aws secretsmanager create-secret \
  --name pinsonbot/credentials \
  --secret-string '{"lobsterId":"abc","internalToken":"xyz"}'

# ❌ 避免：明文存储
echo "token=abc123" > credentials.txt  # 危险！
```

### 2. 访问控制

```bash
# ✅ 推荐：最小权限原则
chmod 600 .env  # 仅所有者可读写

# ❌ 避免：宽松权限
chmod 777 .env  # 任何人都可读取！
```

### 3. 监控告警

```typescript
// 监控异常连接
client.on('disconnected', ({ code }) => {
  if (code === 4001) {
    // 认证失败，可能遭到攻击
    sendAlert('Authentication failed!');
  }
});
```

## 常见问题

### Q: 如果丢失了 internal_token 怎么办？

A: 需要删除并重新创建龙虾：

```bash
# 1. 删除旧龙虾
curl -X DELETE /pinsonbots/api/lobsters/{id}

# 2. 创建新龙虾
curl -X POST /pinsonbots/api/lobsters

# 3. 立即保存新的 credentials
```

### Q: 可以在多个 Connector 实例间共享 token 吗？

A: **可以**，但仅限于同一个龙虾。例如：

```bash
# ✅ 正确：同一龙虾的多实例
Connector 1: lobsterId=A, token=token_A
Connector 2: lobsterId=A, token=token_A  # 相同，没问题

# ❌ 错误：不同龙虾使用相同 token
Connector 1: lobsterId=A, token=token_A
Connector 2: lobsterId=B, token=token_A  # 无效！
```

### Q: 如何验证当前连接的是哪个龙虾？

A: 查看平台日志或使用健康检查端点：

```bash
curl http://localhost:8000/pinsonbots/api/health
# 返回 connected_lobsters: ["aB3xK9mN2p", "xY7pL2qR5n"]
```

---

**文档版本**: 2.0.0  
**最后更新**: 2024-01-01  
**相关链接**: [pinsonbots-platform ARCHITECTURE.md](../backend/ARCHITECTURE.md)
