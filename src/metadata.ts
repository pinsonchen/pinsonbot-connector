/**
 * OpenClaw 元数据收集和上报
 * 
 * 收集 OpenClaw 实例的基础属性信息，与 PinsonBots 平台交互
 */

import { execSync } from "child_process";
import os from "os";

export interface OpenClawMetadata {
  // 系统信息
  os: string;
  os_version: string;
  arch: string;
  hostname: string;
  
  // OpenClaw 信息
  openclaw_version: string;
  gateway_version: string;
  plugin_version: string;
  
  // 模型信息
  default_model: string;
  current_model?: string;
  
  // 位置信息
  region?: string;
  timezone: string;
  
  // 运行时信息
  uptime_seconds: number;
  start_time: string;
  
  // 能力信息
  capabilities: string[];
}

// 启动时间
const startTime = Date.now();

/**
 * 收集系统信息
 */
function collectSystemInfo(): Partial<OpenClawMetadata> {
  try {
    return {
      os: os.platform(),
      os_version: os.release(),
      arch: os.arch(),
      hostname: os.hostname(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  } catch (e) {
    return {
      os: "unknown",
      os_version: "unknown",
      arch: "unknown",
      hostname: "unknown",
      timezone: "UTC",
    };
  }
}

/**
 * 收集 OpenClaw 版本信息
 */
function collectOpenClawInfo(): Partial<OpenClawMetadata> {
  return {
    openclaw_version: process.env.OPENCLAW_VERSION || "unknown",
    gateway_version: process.env.OPENCLAW_GATEWAY_VERSION || "unknown",
    plugin_version: "2.6.0-beta.2",
  };
}

/**
 * 收集模型信息
 * 从环境变量或配置中读取
 */
function collectModelInfo(): Partial<OpenClawMetadata> {
  return {
    default_model: process.env.OPENCLAW_DEFAULT_MODEL || "claude-3-opus",
    current_model: process.env.OPENCLAW_CURRENT_MODEL || process.env.OPENCLAW_DEFAULT_MODEL || "claude-3-opus",
  };
}

/**
 * 收集位置信息
 * 从环境变量或配置中读取
 */
function collectLocationInfo(): Partial<OpenClawMetadata> {
  return {
    region: process.env.OPENCLAW_REGION || "unknown",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}

/**
 * 收集运行时信息
 */
function collectRuntimeInfo(): Partial<OpenClawMetadata> {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  
  return {
    uptime_seconds: uptimeSeconds,
    start_time: new Date(startTime).toISOString(),
  };
}

/**
 * 收集能力信息
 */
function collectCapabilities(): string[] {
  const capabilities: string[] = [];
  
  // 基础能力
  capabilities.push("text_generation");
  capabilities.push("streaming");
  
  // 工具能力
  if (process.env.OPENCLAW_TOOLS_ENABLED === "true") {
    capabilities.push("tools");
  }
  
  // 文件操作能力
  if (process.env.OPENCLAW_FILE_ACCESS === "true") {
    capabilities.push("file_access");
  }
  
  // 网络能力
  if (process.env.OPENCLAW_NETWORK_ACCESS === "true") {
    capabilities.push("network_access");
  }
  
  // 代码执行能力
  if (process.env.OPENCLAW_CODE_EXECUTION === "true") {
    capabilities.push("code_execution");
  }
  
  return capabilities;
}

/**
 * 收集完整元数据
 */
export function collectMetadata(): OpenClawMetadata {
  return {
    ...collectSystemInfo(),
    ...collectOpenClawInfo(),
    ...collectModelInfo(),
    ...collectLocationInfo(),
    ...collectRuntimeInfo(),
    capabilities: collectCapabilities(),
  } as OpenClawMetadata;
}

/**
 * 创建元数据消息
 */
export function createMetadataMessage(metadata: OpenClawMetadata): { type: string; data: OpenClawMetadata; timestamp: string } {
  return {
    type: "metadata",
    data: metadata,
    timestamp: new Date().toISOString(),
  };
}

/**
 * 创建心跳消息（包含动态更新的信息）
 */
export function createHeartbeatMessage(metadata: Partial<OpenClawMetadata>): { type: string; data: object; timestamp: string } {
  return {
    type: "heartbeat",
    data: {
      uptime_seconds: metadata.uptime_seconds,
      current_model: metadata.current_model,
      timestamp: new Date().toISOString(),
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * 获取简化的元数据（用于附加到消息）
 */
export function getMinimalMetadata(): object {
  return {
    openclaw_version: process.env.OPENCLAW_VERSION || "unknown",
    plugin_version: "2.6.0-beta.2",
    default_model: process.env.OPENCLAW_DEFAULT_MODEL || "claude-3-opus",
    region: process.env.OPENCLAW_REGION || "unknown",
  };
}