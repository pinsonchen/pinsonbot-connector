/**
 * OpenClaw 元数据收集和上报
 *
 * 收集 OpenClaw 实例的基础属性信息，与 PinsonBots 平台交互
 */
export interface OpenClawMetadata {
    os: string;
    os_version: string;
    arch: string;
    hostname: string;
    openclaw_version: string;
    gateway_version: string;
    plugin_version: string;
    default_model: string;
    current_model?: string;
    region?: string;
    timezone: string;
    uptime_seconds: number;
    start_time: string;
    capabilities: string[];
}
/**
 * 收集完整元数据
 */
export declare function collectMetadata(): OpenClawMetadata;
/**
 * 创建元数据消息
 */
export declare function createMetadataMessage(metadata: OpenClawMetadata): {
    type: string;
    data: OpenClawMetadata;
    timestamp: string;
};
/**
 * 创建心跳消息（包含动态更新的信息）
 */
export declare function createHeartbeatMessage(metadata: Partial<OpenClawMetadata>): {
    type: string;
    data: object;
    timestamp: string;
};
/**
 * 获取简化的元数据（用于附加到消息）
 */
export declare function getMinimalMetadata(): object;
//# sourceMappingURL=metadata.d.ts.map