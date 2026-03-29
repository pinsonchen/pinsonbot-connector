# Changelog

All notable changes to PinsonBot Connector will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.17.0] - 2026-03-29

### 🎉 Added
- OpenClaw 2026.3.28 兼容性支持
- 最新的 `describeMessageTool` actions 适配器实现
- ACP (AgentClientProtocol) 媒体支持增强

### 🔧 Changed
- **SDK 导入优化**: 使用专用子路径导入，移除通配符导入
  - `readStringParam`, `jsonResult` 从 `openclaw/plugin-sdk/discord-core` 导入
  - `extractToolSend` 从 `openclaw/plugin-sdk/tool-send` 导入
  - 类型定义从 `openclaw/plugin-sdk/channel-runtime` 导入
- **actions 适配器**: 从 `listActions` 改用 `describeMessageTool` 方法
- **ChannelToolSend 类型**: 修正为 `{to, accountId, threadId}` 格式
- **依赖更新**: 添加 `@mariozechner/pi-agent-core@0.61.1` 用于类型定义

### 🐛 Fixed
- 修复 TypeScript 类型检查错误 (5 个错误全部修复)
- 修复 `ChannelLogSink` 导入路径
- 修复 `AgentToolResult` 类型导入
- 消除所有 OpenClaw SDK 弃用警告

### ✅ Tested
- 类型检查通过：`tsc --noEmit` (0 错误)
- 编译成功：`npm run build`
- Gateway 运行正常
- 无弃用警告

### 📋 Compatibility
- **OpenClaw**: 2026.3.23-2 ~ 2026.3.28+
- **Node.js**: >=18.0.0
- **TypeScript**: >=5.7.0

---

## [2.16.1] - 2026-03-19

### 🎉 Added
- PinsonBot 插件 v2.16.1 稳定版本发布

### 🔧 Changed
- 优化会话角色安全隔离机制
- 改进历史会话数据同步

---

## [2.12.0] - 2026-03-18

### 🎉 Added
- 添加多媒体文件支持 (ACP 标准)
- 支持图片、音频、视频附件

---

## [2.11.0] - 2026-03-17

### 🎉 Added
- API 调用次数准确获取
- 使用 `result.counts.final` 获取调用次数

---

## [2.10.0] - 2026-03-17

### 🎉 Added
- API 调用次数同步功能
- 支持发送 `api_call` 消息到平台

---

## [2.9.0] - 2026-03-17

### 🎉 Added
- Token Usage 同步功能
- 支持发送 token 使用数据到平台

---

## [2.8.0] - 2026-03-16

### 🎉 Added
- History 会话数据同步机制
- 支持实时和历史会话同步

---

## [2.5.0-beta.1] - 2026-03-15

### 🎉 Added
- 会话角色安全隔离（测试版）
- 管理员/用户权限区分

---

## [2.4.0] - 2026-03-14

### 🎉 Added
- 无限重连机制
- 平台恢复检测

---

## [2.2.0] - 2026-03-12

### 🎉 Added
- 自动更新框架
- 历史会话功能

---

## [2.0.0] - 2026-03-11

### 🎉 Added
- 初始版本发布
- WebSocket 连接到 PinsonBots Platform
- OpenClaw Gateway AI 集成
- 基础消息收发功能
