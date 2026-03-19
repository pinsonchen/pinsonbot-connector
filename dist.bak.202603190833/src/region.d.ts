/**
 * 智能区域检测模块
 *
 * 支持多种云平台，返回标准化的 ISO 3166 国家代码 + 城市格式
 * 例如: "CN/Hangzhou", "US/San Francisco", "SG/Singapore"
 */
/**
 * 获取标准化区域信息
 * 格式: "国家代码/城市" (ISO 3166)
 *
 * 优先级:
 * 1. 阿里云 ECS 元数据
 * 2. AWS EC2 元数据
 * 3. GCP 元数据
 * 4. Azure 元数据
 * 5. IP 定位
 * 6. 主机名推断
 * 7. 时区推断
 * 8. 环境变量
 * 9. 默认值
 */
export declare function getStandardizedRegion(): string;
/**
 * 清除区域缓存
 * 用于测试或配置变更后
 */
export declare function clearRegionCache(): void;
/**
 * 获取区域信息对象
 * 包含国家、城市、原始区域代码
 */
export declare function getRegionInfo(): {
    country: string;
    city: string;
    raw: string;
};
//# sourceMappingURL=region.d.ts.map