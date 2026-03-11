# PinsonBot Connector 分析与 OpenClaw Plugin 改造方案

## 执行摘要

本文档分析了从 GitHub 同步的 [pinsonbot-connector](https://github.com/pinsonchen/pinsonbot-connector) 代码库，并对比 OpenClaw DingTalk Channel Plugin的实现机制，提供详细的改造方案使其成为符合 OpenClaw 规范的 Channel Plugin。

---

## 1. 现有代码分析

### 1.1 项目结构

```
pinsonbot-connector/
├── plugin.ts                # 插件主入口 (9.3 KB)
├── package.json              # npm 配置
├── openclaw.plugin.json      # 插件清单 (307 B)
├── tsconfig.json             # TypeScript 配置
├── README.md                 # 使用文档
└── install.sh                # 安装脚本
```

### 1.2 当前实现架构

**连接模式**: WebSocket 客户端连接到 PinsonBots 后端

```
OpenClaw Gateway (18789)
  └─ PinsonBot Plugin (plugin.ts)
      ├─ WebSocket 客户端 → PinsonBots (8002)
      ├─ 消息处理器
      └─ Session 管理 (内存)
```

**核心功能**:
- ✅ WebSocket 连接 PinsonBots 后端
- ✅ 用户消息接收和 AI 回复
- ✅ Session 持久化（内存，30 分钟超时）
- ✅ 手动新会话命令（`/new`, `新会话` 等）
- ✅ Typing 指示器支持
- ✅ 自动重连机制

**技术栈**:
- TypeScript (ES Module)
- `ws` - WebSocket 客户端
- `axios` - HTTP 客户端（调用 Gateway API）

### 1.3 代码特点

**优点**:
1. 简洁明了，单一文件实现所有功能
2. 实现了基本的会话管理
3. 支持跨服务器部署（WSS）
4. 有错误处理和自动重连

**缺点**:
1. **不符合 OpenClaw Plugin SDK 规范** - 没有使用标准接口
2. **缺少类型安全** - 没有完整的类型定义
3. **没有配置验证** - 使用简单的对象检查
4. **内存状态无持久化** - 重启后 session 丢失
5. **缺少日志上下文** - 日志格式不统一
6. **没有消息去重** - 可能重复处理消息
7. **不支持多账号** - 单一配置
8. **缺少安全控制** - 没有访问策略

---

## 2. OpenClaw DingTalk Plugin 参考架构

### 2.1 标准 Plugin 结构

```
openclaw-channel-dingtalk/
├── index.ts                   # 插件注册入口 (646 B)
├── src/
│   ├── channel.ts             # 核心逻辑 (31.7 KB)
│   ├── types.ts               # 类型定义 (14.9 KB)
│   ├── config-schema.ts       # 配置 Schema (4.2 KB)
│   ├── config.ts              # 配置工具 (3.2 KB)
│   ├── runtime.ts             # 运行时管理 (340 B)
│   ├── auth.ts                # 认证服务 (1.3 KB)
│   ├── send-service.ts        # 发送服务 (15.0 KB)
│   ├── inbound-handler.ts     # 入站处理 (31.6 KB)
│   ├── card-service.ts        # AI 卡片服务 (28.2 KB)
│   ├── connection-manager.ts  # 连接管理 (20.1 KB)
│   ├── dedup.ts               # 消息去重 (1.9 KB)
│   ├── media-utils.ts         # 媒体工具 (20.6 KB)
│   └── ... (其他辅助模块)
├── tests/                      # 测试套件
└── package.json
```

### 2.2 OpenClaw Plugin SDK 接口

**插件注册接口**:
```typescript
interface OpenClawPlugin {
  id: string;
  name: string;
  description?: string;
  configSchema?: unknown;
  register(api: OpenClawPluginApi): void | Promise<void>;
}
```

**Channel Plugin 接口**:
```typescript
interface ChannelPlugin<T = any> {
  id: string;
  meta: ChannelMeta;
  configSchema: z.ZodTypeAny;
  capabilities: ChannelCapabilities;
  reload: { configPrefixes: string[] };
  
  // 配置适配器
  config: {
    listAccountIds: (cfg: OpenClawConfig) => string[];
    resolveAccount: (cfg: OpenClawConfig, accountId?: string) => ResolvedAccount;
    defaultAccountId: () => string;
   isConfigured: (account: ResolvedAccount) => boolean;
    describeAccount: (account: ResolvedAccount) => AccountDescription;
  };
  
  // 安全适配器
  security: {
    resolveDmPolicy: (ctx: any) => DmPolicyConfig;
  };
  
  // 群组适配器
  groups: {
    resolveRequireMention: (ctx: any) => boolean;
    resolveGroupIntroHint: (ctx: any) => string | undefined;
  };
  
  // 消息适配器
  messaging: {
    normalizeTarget: (raw: string) => string | undefined;
    targetResolver: TargetResolver;
  };
  
  // 动作适配器
  actions: ChannelMessageActionAdapter;
  
  // 出站适配器
  outbound: {
    deliveryMode: "direct" | "queued" | "batch";
    resolveTarget: (params: any) => TargetResolutionResult;
   sendText: (params: any) => Promise<SendResult>;
   sendMedia?: (params: any) => Promise<SendResult>;
  };
  
  // 网关适配器（核心）
  gateway: {
   startAccount: (ctx: GatewayStartContext) => Promise<GatewayStopResult>;
  };
}
```

### 2.3 关键实现机制

#### 2.3.1 配置管理（使用 Zod）

```typescript
const DingTalkConfigSchema = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  dmPolicy: z.enum(["open", "pairing", "allowlist"]).default("open"),
  messageType: z.enum(["markdown", "card"]).default("markdown"),
  // ... 更多配置项
});
```

#### 2.3.2 连接管理（ConnectionManager）

```typescript
enum ConnectionState {
  DISCONNECTED = "DISCONNECTED",
  CONNECTING = "CONNECTING",
  CONNECTED = "CONNECTED",
  DISCONNECTING = "DISCONNECTING",
  FAILED = "FAILED",
}

class ConnectionManager {
  async connect(client: DWClient): Promise<void>;
  async disconnect(): Promise<void>;
  onStateChange(callback: (state: ConnectionState) => void): void;
}
```

#### 2.3.3 消息去重（内存 + 时间窗口）

```typescript
const processingDedupKeys = new Map<string, number>();

function isMessageProcessed(key: string): boolean;
function markMessageProcessed(key: string): void;
// TTL: 5 分钟
```

#### 2.3.4 AI 卡片流式响应

```typescript
interface AICardInstance {
  cardInstanceId: string;
  processQueryKey?: string;
  state: "1" | "2" | "3" | "5"; // PROCESSING | INPUTING | FINISHED | FAILED
  lastStreamedContent?: string;
}

async function createAICard(config, conversationId, log): Promise<AICardInstance>;
async function streamAICard(card, content, finished, log): Promise<void>;
async function finishAICard(card, content, log): Promise<void>;
```

---

## 3. 差异对比分析

| 特性 | PinsonBot (当前) | DingTalk (参考) | OpenClaw 规范要求 |
|------|-----------------|----------------|-----------------|
| **插件注册** | ❌ 无 | ✅ `index.ts` + `register()` | ✅ 必须 |
| **配置 Schema** | ❌ 简单对象 | ✅ Zod Schema | ✅ 必须 |
| **类型定义** | ⚠️ 基础接口 | ✅ 完整类型系统 | ✅ 推荐 |
| **Channel 接口** | ❌ 自定义 | ✅ 完整适配器 | ✅ 必须 |
| **多账号支持** | ❌ 单账号 | ✅ 多账号配置 | ✅ 支持 |
| **消息去重** | ❌ 无 | ✅ 内存去重 | ✅ 推荐 |
| **Session 持久化** | ❌ 内存 | ✅ 文件系统 | ✅ 推荐 |
| **AI 卡片** | ❌ 无 | ✅ 流式卡片 | ⚠️ 可选 |
| **媒体处理** | ❌ 无 | ✅ 完整支持 | ⚠️ 可选 |
| **连接管理** | ⚠️ 简单重连 | ✅ 状态机 + 退避 | ✅ 推荐 |
| **日志上下文** | ❌ console.log | ✅ Logger Context | ✅ 推荐 |
| **错误处理** | ⚠️ try-catch | ✅ 结构化错误负载 | ✅ 推荐 |
| **安全策略** | ❌ 无 | ✅ DM/Group 策略 | ✅ 必须 |

---

## 4. 改造方案

### 4.1 总体策略

采用**渐进式重构**，分三个阶段：

1. **阶段一**: 最小可行性改造（符合基本规范）
2. **阶段二**: 增强功能（多账号、持久化）
3. **阶段三**: 高级特性（AI 卡片、媒体处理）

### 4.2 阶段一：最小可行性改造

**目标**: 使插件能被 OpenClaw 正确加载和运行

#### 4.2.1 新增文件结构

```
plugin/
├── index.ts                 # NEW: 插件注册入口
├── src/
│   ├── channel.ts           # NEW: Channel 实现
│   ├── types.ts             # NEW: 类型定义
│   ├── config-schema.ts     # NEW: 配置 Schema
│   └── runtime.ts           # NEW: 运行时
├── package.json              # MODIFY: 更新依赖
└── openclaw.plugin.json      # MODIFY: 更新配置
```

#### 4.2.2 index.ts（插件入口）

```typescript
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { pinsonbotPlugin } from "./src/channel";
import { setPinsonBotRuntime } from "./src/runtime";
import type { PinsonBotPluginModule } from "./src/types";

const plugin: PinsonBotPluginModule= {
  id: "pinsonbot",
  name: "PinsonBot Channel",
  description: "PinsonBots messaging channel via WebSocket",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi): void {
   setPinsonBotRuntime(api.runtime);
    api.registerChannel({ plugin: pinsonbotPlugin });
  },
};

export default plugin;
```

#### 4.2.3 types.ts（核心类型）

```typescript
import type {
  OpenClawConfig,
  OpenClawPluginApi,
  ChannelLogSink,
  ChannelAccountSnapshot,
  ChannelGatewayContext,
  ChannelPlugin,
} from "openclaw/plugin-sdk";

export interface PinsonBotPluginModule {
  id: string;
  name: string;
  description?: string;
  configSchema?: unknown;
  register?: (api: OpenClawPluginApi) => void | Promise<void>;
}

export interface PinsonBotConfig extends OpenClawConfig {
  lobsterId: string;
  appkey: string;
  wsUrl?: string;
  sessionTimeout?: number;
  enabled?: boolean;
  name?: string;
}

export interface PinsonBotInboundMessage {
  type: 'user_message' | 'bot_response' | 'typing_start' | 'typing_end' | 'system';
  data: {
   content?: string;
   session_id?: string;
    [key: string]: any;
  };
  timestamp?: string;
}

export type PinsonBotChannelPlugin = ChannelPlugin<ResolvedAccount & { configured: boolean }>;

export interface ResolvedAccount {
  accountId: string;
  config: PinsonBotConfig;
  enabled: boolean;
  configured: boolean;
  name?: string | null;
}

// 工具函数
export function listPinsonBotAccountIds(cfg: OpenClawConfig): string[] {
  const pinsonbot = cfg.channels?.pinsonbot as any;
  if (!pinsonbot) return [];
  return (pinsonbot.lobsterId || pinsonbot.appkey) ? ["default"] : [];
}

export function resolvePinsonBotAccount(
  cfg: OpenClawConfig,
  accountId?: string | null,
): ResolvedAccount {
  const id = accountId || "default";
  const pinsonbot = cfg.channels?.pinsonbot as any;
  const config: PinsonBotConfig = {
    lobsterId: pinsonbot?.lobsterId || "",
    appkey: pinsonbot?.appkey || "",
    wsUrl: pinsonbot?.wsUrl || "wss://tools.pinsonbot.com",
   sessionTimeout: pinsonbot?.sessionTimeout || 1800000,
  };
  return {
    accountId: id,
   config,
    enabled: pinsonbot?.enabled !== false,
   configured: Boolean(config.lobsterId && config.appkey),
  };
}
```

#### 4.2.4 config-schema.ts（Zod 配置）

```typescript
import { z } from "zod";

const PinsonBotAccountConfigSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional().default(true),
  lobsterId: z.string().optional(),
  appkey: z.string().optional(),
  wsUrl: z.string().optional().default("wss://tools.pinsonbot.com"),
  sessionTimeout: z.number().int().min(60000).optional().default(1800000),
});

export const PinsonBotConfigSchema = PinsonBotAccountConfigSchema.extend({
  accounts: z.record(z.string(), PinsonBotAccountConfigSchema.optional()).optional(),
});

export type PinsonBotConfig = z.infer<typeof PinsonBotConfigSchema>;
```

#### 4.2.5 channel.ts（核心实现）

```typescript
import WebSocket from 'ws';
import axios from 'axios';
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import * as pluginSdk from"openclaw/plugin-sdk";
import { getConfig, isConfigured } from "./config";
import { PinsonBotConfigSchema } from "./config-schema.js";
import { getPinsonBotRuntime } from "./runtime";
import type {
  PinsonBotInboundMessage,
  GatewayStartContext,
  GatewayStopResult,
  PinsonBotChannelPlugin,
  ResolvedAccount,
} from "./types";
import { listPinsonBotAccountIds, resolvePinsonBotAccount } from "./types";

const CHANNEL_INFLIGHT_NAMESPACE_POLICY = "memory-only" as const;
const processingDedupKeys = new Map<string, number>();

function isMessageProcessed(key: string): boolean {
  return processingDedupKeys.has(key);
}

function markMessageProcessed(key: string): void {
  const now = Date.now();
  processingDedupKeys.set(key, now);
  // 清理 5 分钟前的记录
  for (const [k, t] of processingDedupKeys.entries()) {
   if (now - t > 5 * 60 * 1000) {
      processingDedupKeys.delete(k);
    }
  }
}

export const pinsonbotPlugin: PinsonBotChannelPlugin = {
  id: "pinsonbot",
  meta: {
   id: "pinsonbot",
   label: "PinsonBot",
   selectionLabel: "PinsonBot (钉钉机器人)",
    docsPath: "/channels/pinsonbot",
   blurb: "PinsonBots WebSocket 机器人通道",
   aliases: ["pb", "pinson"],
  },
  configSchema: pluginSdk.buildChannelConfigSchema(PinsonBotConfigSchema),
  capabilities: {
    chatTypes: ["direct", "group"] as Array<"direct" | "group">,
    reactions: false,
    threads: false,
   media: false,
   nativeCommands: false,
   blockStreaming: false,
  },
  reload: { configPrefixes: ["channels.pinsonbot"] },
  config: {
    listAccountIds: (cfg: OpenClawConfig): string[] => {
      return listPinsonBotAccountIds(cfg);
    },
    resolveAccount: (cfg: OpenClawConfig, accountId?: string | null) => {
      return resolvePinsonBotAccount(cfg, accountId);
    },
    defaultAccountId: (): string => "default",
   isConfigured: (account: ResolvedAccount): boolean =>
      Boolean(account.config?.lobsterId && account.config?.appkey),
    describeAccount: (account: ResolvedAccount) => ({
      accountId: account.accountId,
     name: account.config?.name || "PinsonBot",
      enabled: account.enabled,
     configured: Boolean(account.config?.lobsterId),
    }),
  },
  security: {
    resolveDmPolicy: ({ account }: any) => ({
      policy: "open" as const,
     allowFrom: [],
      policyPath: "channels.pinsonbot.dmPolicy",
     allowFromPath: "channels.pinsonbot.allowFrom",
      approveHint: "使用 /allow pinsonbot:<userId> 批准用户",
      normalizeEntry: (raw: string) => raw.replace(/^(pinsonbot|pb):/i, ""),
    }),
  },
  groups: {
    resolveRequireMention: ({ cfg }: any): boolean => false,
    resolveGroupIntroHint: ({ groupId }: any): string => {
      return `PinsonBot conversationId=${groupId}`;
    },
  },
  messaging: {
    normalizeTarget: (raw: string) => raw ? raw.replace(/^(pinsonbot|pb):/i, "") : undefined,
    targetResolver: {
      looksLikeId: (id: string): boolean => /^[\w+\-/=]+$/.test(id),
      hint: "<conversationId>",
    },
  },
  actions: {
    listActions: () => ["send"],
    supportsAction: ({ action }) => action === "send",
    extractToolSend: ({ args }) => pluginSdk.extractToolSend(args, "sendMessage"),
    handleAction: async ({ action, params, cfg, accountId, dryRun }) => {
     if (action !== "send") {
        throw new Error(`Action ${action} is not supported`);
      }
     const to = pluginSdk.readStringParam(params, "to", { required: true });
     const message = pluginSdk.readStringParam(params, "message", { required: true });
      
     if (dryRun) {
        return pluginSdk.jsonResult({ ok: true, dryRun: true, to });
      }
      
      // TODO: 实现发送逻辑
      throw new Error("send action not implemented yet");
    },
  },
  outbound: {
    deliveryMode: "direct" as const,
    resolveTarget: ({ to }: any) => {
     const trimmed = to?.trim();
     if (!trimmed) {
        return { ok: false as const, error: new Error("PinsonBot requires --to <conversationId>") };
      }
      return { ok: true as const, to: trimmed };
    },
   sendText: async ({ cfg, to, text, accountId, log }: any) => {
      // TODO: 实现发送逻辑
      throw new Error("sendText not implemented yet");
    },
  },
  gateway: {
   startAccount: async (ctx: GatewayStartContext): Promise<GatewayStopResult> => {
     const { account, cfg, abortSignal } = ctx;
     const config = account.config;
      
     if (!config.lobsterId || !config.appkey) {
        throw new Error("PinsonBot lobsterId and appkey are required");
      }
      
      ctx.log?.info?.(`[${account.accountId}] Connecting to PinsonBots WebSocket...`);
      
      // 复用原有 plugin.ts 的 WebSocket 连接逻辑
     const wsUrl = config.wsUrl || "wss://tools.pinsonbot.com";
     const fullUrl = `${wsUrl}/pinsonbots/ws/${config.lobsterId}?appkey=${config.appkey}`;
      
     const ws = new WebSocket(fullUrl);
      let isConnected = false;
      
      return new Promise((resolve, reject) => {
        ws.on('open', () => {
         isConnected = true;
          ctx.log?.info?.(`[${account.accountId}] ✅ Connected to PinsonBots`);
          
          resolve({
           stop: () => {
              ctx.log?.info?.(`[${account.accountId}] Disconnecting from PinsonBots`);
              ws.close();
            },
          });
        });
        
        ws.on('message', async (data: WebSocket.Data) => {
          try {
           const message: PinsonBotInboundMessage = JSON.parse(data.toString());
            await handleMessage(message, ctx, cfg, account);
          } catch (error: any) {
            ctx.log?.error?.(`[${account.accountId}] Message handling error: ${error.message}`);
          }
        });
        
        ws.on('error', (error: Error) => {
          ctx.log?.error?.(`[${account.accountId}] WebSocket error: ${error.message}`);
         if (!isConnected) reject(error);
        });
        
        ws.on('close', () => {
          ctx.log?.warn?.(`[${account.accountId}] 🔌 Connection closed`);
        });
        
        // 监听中止信号
       if (abortSignal) {
          abortSignal.addEventListener('abort', () => {
            ctx.log?.info?.(`[${account.accountId}] Aborted by gateway`);
            ws.close();
          });
        }
      });
    },
  },
};

// 消息处理（复用原有逻辑）
async function handleMessage(
  message: PinsonBotInboundMessage,
  ctx: GatewayStartContext,
  cfg: OpenClawConfig,
  account: ResolvedAccount,
): Promise<void> {
  const { type, data } = message;
  
  if (type === 'user_message') {
   const content = data.content || '';
   const sessionId = data.session_id || 'default';
    
    // 消息去重
   const dedupKey = `${account.accountId}:${sessionId}:${Date.now()}`;
   if (isMessageProcessed(dedupKey)) {
      ctx.log?.debug?.(`[${account.accountId}] Skipping duplicate message`);
      return;
    }
    markMessageProcessed(dedupKey);
    
    ctx.log?.info?.(`[${account.accountId}] 👤 User message: ${content.substring(0, 100)}`);
    
    // 调用 Gateway AI（通过 SDK）
    try {
     const response = await ctx.sendToGateway({
        peerId: sessionId,
        text: content,
        accountId: account.accountId,
      });
      
      ctx.log?.info?.(`[${account.accountId}] 🤖 AI response: ${response.text.substring(0, 100)}`);
      
      // 发送回复到 PinsonBots
     sendToPinsonBots(ctx, account, {
        type: 'bot_response',
        data: { content: response.text },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      ctx.log?.error?.(`[${account.accountId}] AI handling error: ${error.message}`);
    }
  }
}

function sendToPinsonBots(
  ctx: GatewayStartContext,
  account: ResolvedAccount,
  message: PinsonBotInboundMessage,
): void {
  // TODO: 需要维护 WebSocket 引用
  ctx.log?.debug?.(`[${account.accountId}] Sending message: ${message.type}`);
}
```

### 4.3 阶段二：增强功能

#### 4.3.1 多账号支持

在配置中添加 `accounts` 对象：

```json
{
  "channels": {
    "pinsonbot": {
      "accounts": {
        "bot1": {
          "lobsterId": "4",
          "appkey": "xxx",
          "wsUrl": "wss://tools.pinsonbot.com"
        },
        "bot2": {
          "lobsterId": "5",
          "appkey": "yyy",
          "wsUrl": "ws://192.168.1.100:8002"
        }
      }
    }
  }
}
```

#### 4.3.2 Session 持久化

创建 `persistence-store.ts`:

```typescript
import { promises as fs } from 'fs';
import path from 'path';

interface SessionData {
  sessionId: string;
  lastActivity: number;
  context?: any;
}

export class SessionStore {
  private storePath: string;
  private sessions = new Map<string, SessionData>();
  
  constructor(storePath: string) {
    this.storePath = storePath;
  }
  
  async load(): Promise<void> {
    try {
     const data = await fs.readFile(this.storePath, 'utf-8');
     const sessions = JSON.parse(data);
     for (const [key, value] of Object.entries(sessions)) {
        this.sessions.set(key, value as SessionData);
      }
    } catch (error) {
      // 文件不存在或解析失败，使用空 store
    }
  }
  
  async save(): Promise<void> {
   const data = Object.fromEntries(this.sessions);
    await fs.writeFile(this.storePath, JSON.stringify(data, null, 2));
  }
  
  get(key: string): SessionData | undefined {
    return this.sessions.get(key);
  }
  
  set(key: string, data: SessionData): void {
    this.sessions.set(key, data);
  }
  
  delete(key: string): void {
    this.sessions.delete(key);
  }
}
```

### 4.4 阶段三：高级特性

#### 4.4.1 AI 卡片支持

参考 DingTalk 的 `card-service.ts`，为 PinsonBots 添加流式卡片：

```typescript
async function createAICard(
  config: PinsonBotConfig,
  sessionId: string,
  log: any,
): Promise<AICardInstance> {
  // 发送卡片创建消息到 PinsonBots
  const response = await axios.post(`${config.wsUrl}/api/card/create`, {
    lobsterId: config.lobsterId,
   session_id: sessionId,
  });
  
  return {
    cardInstanceId: response.data.cardInstanceId,
   state: "1", // PROCESSING
   createdAt: Date.now(),
   lastUpdated: Date.now(),
  };
}
```

#### 4.4.2 媒体处理

如果 PinsonBots 支持图片/文件，添加 `media-utils.ts`:

```typescript
async function prepareMediaInput(
  mediaPath: string,
  log: any,
  allowlist?: string[],
): Promise<{ path: string; mimeType: string; cleanup?: () => Promise<void> }> {
  // 下载远程文件或验证本地文件
  // 返回临时文件路径和 MIME 类型
}
```

---

## 5. 实施步骤

### 5.1 准备工作

```bash
cd /Users/chongshan/project/qoder/pinsonbot-connector

# 安装 OpenClaw Plugin SDK
npm install openclaw zod

# 安装开发依赖
npm install -D @types/node typescript vitest
```

### 5.2 第一阶段实施（1-2 天）

1. **创建目录结构**
   ```bash
   mkdir -p src
   mv plugin.ts src/plugin-legacy.ts  # 保留参考
   ```

2. **实现基础文件**
   - [ ] `index.ts` - 插件入口
   - [ ] `src/types.ts` - 类型定义
   - [ ] `src/config-schema.ts` - Zod Schema
   - [ ] `src/config.ts` - 配置工具
   - [ ] `src/runtime.ts` - 运行时
   - [ ] `src/channel.ts` - 核心 Channel 实现

3. **更新配置文件**
   - [ ] `package.json` - 添加 SDK 依赖
   - [ ] `openclaw.plugin.json` - 更新 manifest

4. **测试加载**
   ```bash
   npm run build
   openclaw plugins install -l .
   openclaw plugins list  # 确认加载
   ```

### 5.3 第二阶段实施（2-3 天）

1. **多账号支持**
   - [ ] 扩展配置 Schema
   - [ ] 修改 `listAccountIds` 和 `resolveAccount`
   - [ ] 测试多账号并发

2. **Session 持久化**
   - [ ] 创建 `src/persistence-store.ts`
   - [ ] 集成到 `channel.ts`
   - [ ] 添加重启恢复测试

3. **消息去重增强**
   - [ ] 实现完整的去重逻辑
   - [ ] 添加单元测试

### 5.4 第三阶段实施（3-5 天）

1. **AI 卡片**（如 PinsonBots 支持）
   - [ ] 创建 `src/card-service.ts`
   - [ ] 实现流式响应
   - [ ] 添加卡片状态管理

2. **媒体处理**（如 PinsonBots 支持）
   - [ ] 创建 `src/media-utils.ts`
   - [ ] 实现 `sendMedia`
   - [ ] 添加媒体类型检测

3. **完整测试**
   - [ ] 单元测试覆盖率 >80%
   - [ ] 集成测试
   - [ ] 文档完善

---

## 6. 测试计划

### 6.1 单元测试

```typescript
// tests/unit/config.test.ts
import { describe, it, expect } from 'vitest';
import { resolvePinsonBotAccount } from '../../src/types';

describe('resolvePinsonBotAccount', () => {
  it('should resolve default account', () => {
   const cfg = {
      channels: {
        pinsonbot: {
          lobsterId: '4',
          appkey: 'test-key',
        },
      },
    };
   const account = resolvePinsonBotAccount(cfg as any);
    expect(account.accountId).toBe('default');
    expect(account.configured).toBe(true);
  });
});
```

### 6.2 集成测试

```typescript
// tests/integration/gateway-flow.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Gateway Message Flow', () => {
  it('should handle user message and return AI response', async () => {
    // 模拟 PinsonBots WebSocket 消息
    // 验证 Gateway AI 调用
    // 验证回复发送
  });
});
```

---

## 7. 风险评估

| 风险 | 影响程度 | 可能性 | 缓解措施 |
|------|---------|--------|----------|
| PinsonBots API 变更 | 高 | 中 | 抽象 API 层，添加版本检测 |
| OpenClaw SDK 升级 | 中 | 中 | 遵循语义化版本，定期更新依赖 |
| WebSocket 连接不稳定 | 中 | 高 | 实现智能重连和降级策略 |
| 性能问题（多账号） | 中 | 低 | 压力测试，优化资源使用 |

---

## 8. 结论

PinsonBot Connector 具备基本的 WebSocket 连接和消息处理能力，但不符合 OpenClaw Plugin SDK 规范。通过参考 DingTalk Channel Plugin的实现，可以采用渐进式重构策略：

1. **第一阶段**实现基本规范兼容（1-2 天）
2. **第二阶段**增强功能（多账号、持久化）（2-3 天）
3. **第三阶段**添加高级特性（AI 卡片、媒体）（3-5 天）

总预计工作量：**6-10 个工作日**

改造后的插件将：
- ✅ 符合 OpenClaw Plugin SDK 规范
- ✅ 支持多账号并发
- ✅ 具备会话持久化能力
- ✅ 拥有完整的类型安全
- ✅ 支持智能重连和错误恢复
- ✅ 可扩展 AI 卡片和媒体处理

---

## 附录

### A. 参考资源

- [OpenClaw Plugin SDK Documentation](https://docs.openclaw.ai/zh-CN/refactor/plugin-sdk)
- [DingTalk Channel Plugin Source](https://github.com/soimy/openclaw-channel-dingtalk)
- [PinsonBot Connector Source](https://github.com/pinsonchen/pinsonbot-connector)

### B. 关键 API 对照表

| 功能 | PinsonBot (旧) | OpenClaw SDK (新) |
|------|---------------|------------------|
| 配置获取 | `getConfig(cfg)` | `pluginSdk.buildChannelConfigSchema()` |
| 日志 | `console.log()` | `ctx.log?.info?.()` |
| Session | 内存 Map | `rt.channel.session.resolveStorePath()` |
| AI 调用 | `axios.post('/v1/chat/completions')` | `ctx.sendToGateway()` |
| 消息发送 | `ws.send()` | `ctx.sendToPeer()` |

### C. 术语表

- **Channel**: OpenClaw 中的通讯渠道插件（如 DingTalk, Telegram）
- **Gateway**: OpenClaw 的消息网关，负责 AI 能力调度
- **Adapter**: 适配器模式实现，分离不同平台的差异
- **Session Key**: 会话标识符，用于多轮对话上下文
