/**
 * OpenClaw 元数据收集和上报
 * 
 * 收集 OpenClaw 实例的基础属性信息，与 PinsonBots 平台交互
 */

import os from "os";
import fs from "fs";
import path from "path";
import { getStandardizedRegion } from "./region.js";

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
 * 获取 OpenClaw 版本
 */
function getOpenClawVersion(): string {
  try {
    // 尝试从 package.json 读取
    const packagePath = "/usr/lib/node_modules/openclaw/package.json";
    if (fs.existsSync(packagePath)) {
      const pkg = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
      return pkg.version || "unknown";
    }
  } catch (e) {
    // 忽略错误
  }
  
  // 已知版本
  return "2026.3.13";
}

/**
 * 获取 PinsonBot 插件版本
 */
function getPluginVersion(): string {
  try {
    // 从插件自身的 package.json 读取
    const packagePath = "/root/.openclaw/extensions/pinsonbot/package.json";
    if (fs.existsSync(packagePath)) {
      const pkg = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
      return pkg.version || "unknown";
    }
  } catch (e) {
    // 忽略错误
  }
  
  // 回退到已知版本
  return "2.15.0";
}

/**
 * 获取 Gateway 版本（与 OpenClaw 相同）
 */
function getGatewayVersion(): string {
  return getOpenClawVersion();
}

/**
 * 获取默认模型
 */
function getDefaultModel(): string {
  try {
    // 从 OpenClaw 配置文件读取
    const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      // 尝试多种路径获取默认模型
      const model = config.agents?.defaults?.model?.primary ||
                   config.models?.defaults?.primary ||
                   config.defaultModel;
      if (model) return model;
    }
  } catch (e) {
    // 忽略错误
  }
  
  // 已知默认值
  return "bailian/glm-5";
}

/**
 * 获取当前模型（从环境变量或配置）
 */
function getCurrentModel(): string {
  return process.env.OPENCLAW_CURRENT_MODEL || getDefaultModel();
}

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
    openclaw_version: getOpenClawVersion(),
    gateway_version: getGatewayVersion(),
    plugin_version: getPluginVersion(),
  };
}

/**
 * 收集模型信息
 */
function collectModelInfo(): Partial<OpenClawMetadata> {
  return {
    default_model: getDefaultModel(),
    current_model: getCurrentModel(),
  };
}

/**
 * 收集位置信息
 */
function collectLocationInfo(): Partial<OpenClawMetadata> {
  return {
    region: getStandardizedRegion(),
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
  return [
    "text_generation",
    "streaming",
    "tools",
    "file_access",
    "network_access",
    "code_execution",
  ];
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
    openclaw_version: getOpenClawVersion(),
    plugin_version: getPluginVersion(),
    default_model: getDefaultModel(),
    region: process.env.OPENCLAW_REGION || "Hangzhou",
  };
}