/**
 * OpenClaw 元数据收集和上报
 * 
 * 收集 OpenClaw 实例的基础属性信息，与 PinsonBots 平台交互
 */

import os from "os";
import fs from "fs";
import path from "path";

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
    plugin_version: "2.7.0-beta.1",
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
 * 获取区域信息
 * 优先使用阿里云 ECS 元数据，其次使用 IP 定位
 */
function getRegion(): string {
  try {
    // 方法1: 尝试从阿里云 ECS 元数据获取（最准确）
    const { execSync } = require("child_process");
    try {
      const region = execSync(
        "curl -s --connect-timeout 2 http://100.100.100.200/latest/meta-data/region-id 2>/dev/null",
        { timeout: 3000 }
      ).toString().trim();
      if (region && region.length > 0) {
        return region; // e.g., "cn-hangzhou"
      }
    } catch (e) {
      // 不是阿里云 ECS 或元数据服务不可用
    }
    
    // 方法2: 尝试从 IP 信息获取
    try {
      const ipinfo = execSync(
        "curl -s --connect-timeout 3 https://ipinfo.io/json 2>/dev/null",
        { timeout: 5000 }
      ).toString().trim();
      const data = JSON.parse(ipinfo);
      if (data.city && data.country) {
        return `${data.city}, ${data.country}`; // e.g., "Hangzhou, CN"
      }
    } catch (e) {
      // IP 定位失败
    }
    
    // 方法3: 从主机名推断（阿里云主机名通常包含区域缩写）
    const hostname = os.hostname();
    if (hostname.includes("hz") || hostname.includes("hangzhou")) {
      return "cn-hangzhou";
    } else if (hostname.includes("sg") || hostname.includes("singapore")) {
      return "ap-southeast-1";
    } else if (hostname.includes("bj") || hostname.includes("beijing")) {
      return "cn-beijing";
    } else if (hostname.includes("sh") || hostname.includes("shanghai")) {
      return "cn-shanghai";
    }
  } catch (e) {
    // 忽略错误
  }
  
  // 方法4: 回退到环境变量或默认值
  return process.env.OPENCLAW_REGION || "unknown";
}

/**
 * 收集位置信息
 */
function collectLocationInfo(): Partial<OpenClawMetadata> {
  return {
    region: getRegion(),
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
    plugin_version: "2.7.0-beta.1",
    default_model: getDefaultModel(),
    region: process.env.OPENCLAW_REGION || "Hangzhou",
  };
}