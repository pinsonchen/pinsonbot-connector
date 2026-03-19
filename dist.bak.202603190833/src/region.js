/**
 * 智能区域检测模块
 *
 * 支持多种云平台，返回标准化的 ISO 3166 国家代码 + 城市格式
 * 例如: "CN/Hangzhou", "US/San Francisco", "SG/Singapore"
 */
import os from "os";
import { execSync } from "child_process";
// 区域缓存（避免重复请求）
let cachedRegion = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存
// 阿里云区域代码映射到标准格式
const ALIYUN_REGION_MAP = {
    "cn-hangzhou": "CN/Hangzhou",
    "cn-shanghai": "CN/Shanghai",
    "cn-beijing": "CN/Beijing",
    "cn-shenzhen": "CN/Shenzhen",
    "cn-qingdao": "CN/Qingdao",
    "cn-zhangjiakou": "CN/Zhangjiakou",
    "cn-huhehaote": "CN/Hohhot",
    "cn-wulanchabu": "CN/Ulanqab",
    "cn-chengdu": "CN/Chengdu",
    "cn-guangzhou": "CN/Guangzhou",
    "cn-hongkong": "HK/Hong Kong",
    "ap-southeast-1": "SG/Singapore",
    "ap-southeast-2": "AU/Sydney",
    "ap-southeast-3": "MY/Kuala Lumpur",
    "ap-southeast-5": "ID/Jakarta",
    "ap-northeast-1": "JP/Tokyo",
    "us-west-1": "US/Silicon Valley",
    "us-east-1": "US/Virginia",
    "eu-central-1": "DE/Frankfurt",
    "eu-west-1": "GB/London",
    "me-east-1": "AE/Dubai",
};
// AWS 区域映射
const AWS_REGION_MAP = {
    "ap-southeast-1": "SG/Singapore",
    "ap-southeast-2": "AU/Sydney",
    "ap-northeast-1": "JP/Tokyo",
    "ap-south-1": "IN/Mumbai",
    "us-east-1": "US/Virginia",
    "us-east-2": "US/Ohio",
    "us-west-1": "US/California",
    "us-west-2": "US/Oregon",
    "eu-west-1": "IE/Dublin",
    "eu-west-2": "GB/London",
    "eu-central-1": "DE/Frankfurt",
    "ca-central-1": "CA/Montreal",
    "sa-east-1": "BR/Sao Paulo",
};
// 主机名区域推断映射
const HOSTNAME_PATTERNS = {
    "hz": "CN/Hangzhou",
    "hangzhou": "CN/Hangzhou",
    "sh": "CN/Shanghai",
    "shanghai": "CN/Shanghai",
    "bj": "CN/Beijing",
    "beijing": "CN/Beijing",
    "sz": "CN/Shenzhen",
    "shenzhen": "CN/Shenzhen",
    "sg": "SG/Singapore",
    "singapore": "SG/Singapore",
    "hk": "HK/Hong Kong",
    "hongkong": "HK/Hong Kong",
    "tokyo": "JP/Tokyo",
    "osaka": "JP/Osaka",
    "seoul": "KR/Seoul",
    "mumbai": "IN/Mumbai",
    "frankfurt": "DE/Frankfurt",
    "london": "GB/London",
    "sydney": "AU/Sydney",
    "virginia": "US/Virginia",
    "california": "US/California",
    "oregon": "US/Oregon",
};
/**
 * 从阿里云 ECS 获取区域
 */
function getAliyunRegion() {
    try {
        const region = execSync("curl -s --connect-timeout 2 http://100.100.100.200/latest/meta-data/region-id 2>/dev/null", { timeout: 3000, encoding: "utf-8" }).trim();
        if (region && ALIYUN_REGION_MAP[region]) {
            return ALIYUN_REGION_MAP[region];
        }
        return region || null;
    }
    catch (e) {
        return null;
    }
}
/**
 * 从 AWS EC2 获取区域
 */
function getAWSRegion() {
    try {
        const region = execSync("curl -s --connect-timeout 2 http://169.254.169.254/latest/meta-data/placement/region 2>/dev/null", { timeout: 3000, encoding: "utf-8" }).trim();
        if (region && AWS_REGION_MAP[region]) {
            return AWS_REGION_MAP[region];
        }
        return region || null;
    }
    catch (e) {
        return null;
    }
}
/**
 * 从 GCP 获取区域
 */
function getGCPRegion() {
    try {
        const zone = execSync("curl -s --connect-timeout 2 http://metadata.google.internal/computeMetadata/v1/instance/zone -H 'Metadata-Flavor: Google' 2>/dev/null", { timeout: 3000, encoding: "utf-8" }).trim();
        // zone 格式: projects/xxx/zones/us-central1-a
        const match = zone.match(/zones\/([a-z]+-[a-z]+\d+)/);
        if (match) {
            const region = match[1];
            // GCP 区域映射
            const gcpMap = {
                "asia-east1": "TW/Taiwan",
                "asia-east2": "HK/Hong Kong",
                "asia-northeast1": "JP/Tokyo",
                "asia-northeast2": "JP/Osaka",
                "asia-northeast3": "KR/Seoul",
                "asia-southeast1": "SG/Singapore",
                "asia-south1": "IN/Mumbai",
                "asia-south2": "IN/Delhi",
                "us-central1": "US/Iowa",
                "us-east1": "US/South Carolina",
                "us-east4": "US/Virginia",
                "us-west1": "US/Oregon",
                "us-west2": "US/Los Angeles",
                "europe-west1": "BE/Brussels",
                "europe-west2": "GB/London",
                "europe-west3": "DE/Frankfurt",
            };
            return gcpMap[region] || region;
        }
        return null;
    }
    catch (e) {
        return null;
    }
}
/**
 * 从 Azure 获取区域
 */
function getAzureRegion() {
    try {
        const location = execSync("curl -s --connect-timeout 2 http://169.254.169.254/metadata/instance/compute/location?api-version=2021-02-01 -H 'Metadata: true' 2>/dev/null", { timeout: 3000, encoding: "utf-8" }).trim().replace(/"/g, "");
        // Azure 位置映射
        const azureMap = {
            "eastasia": "HK/Hong Kong",
            "southeastasia": "SG/Singapore",
            "japaneast": "JP/Tokyo",
            "japanwest": "JP/Osaka",
            "koreacentral": "KR/Seoul",
            "chinanorth": "CN/Beijing",
            "chinaeast": "CN/Shanghai",
            "chinanorth2": "CN/Beijing",
            "chinaeast2": "CN/Shanghai",
            "eastus": "US/Virginia",
            "westus": "US/California",
            "westus2": "US/Washington",
            "northeurope": "IE/Dublin",
            "westeurope": "NL/Amsterdam",
            "uksouth": "GB/London",
            "germanywestcentral": "DE/Frankfurt",
        };
        return azureMap[location.toLowerCase()] || location || null;
    }
    catch (e) {
        return null;
    }
}
/**
 * 从 IP 信息获取区域
 */
function getIPRegion() {
    try {
        const ipinfo = execSync("curl -s --connect-timeout 3 https://ipinfo.io/json 2>/dev/null", { timeout: 5000, encoding: "utf-8" }).trim();
        const data = JSON.parse(ipinfo);
        if (data.country && data.city) {
            return `${data.country}/${data.city}`;
        }
        return null;
    }
    catch (e) {
        return null;
    }
}
/**
 * 从主机名推断区域
 */
function getHostnameRegion() {
    const hostname = os.hostname().toLowerCase();
    for (const [pattern, region] of Object.entries(HOSTNAME_PATTERNS)) {
        if (hostname.includes(pattern)) {
            return region;
        }
    }
    return null;
}
/**
 * 从时区推断区域（最后的回退）
 */
function getTimezoneRegion() {
    try {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const tzMap = {
            "Asia/Shanghai": "CN/Shanghai",
            "Asia/Hong_Kong": "HK/Hong Kong",
            "Asia/Singapore": "SG/Singapore",
            "Asia/Tokyo": "JP/Tokyo",
            "Asia/Seoul": "KR/Seoul",
            "Asia/Mumbai": "IN/Mumbai",
            "Asia/Dubai": "AE/Dubai",
            "America/New_York": "US/New York",
            "America/Los_Angeles": "US/Los Angeles",
            "America/Chicago": "US/Chicago",
            "America/Toronto": "CA/Toronto",
            "Europe/London": "GB/London",
            "Europe/Paris": "FR/Paris",
            "Europe/Frankfurt": "DE/Frankfurt",
            "Europe/Berlin": "DE/Berlin",
            "Australia/Sydney": "AU/Sydney",
            "Pacific/Auckland": "NZ/Auckland",
        };
        return tzMap[timezone] || null;
    }
    catch (e) {
        return null;
    }
}
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
export function getStandardizedRegion() {
    // 检查缓存
    if (cachedRegion && Date.now() - cacheTime < CACHE_TTL) {
        return cachedRegion;
    }
    // 按优先级尝试各种方法
    const methods = [
        getAliyunRegion,
        getAWSRegion,
        getGCPRegion,
        getAzureRegion,
        getIPRegion,
        getHostnameRegion,
        getTimezoneRegion,
    ];
    for (const method of methods) {
        const region = method();
        if (region) {
            cachedRegion = region;
            cacheTime = Date.now();
            return region;
        }
    }
    // 回退到环境变量或默认值
    const fallback = process.env.OPENCLAW_REGION || "Unknown/Unknown";
    cachedRegion = fallback;
    cacheTime = Date.now();
    return fallback;
}
/**
 * 清除区域缓存
 * 用于测试或配置变更后
 */
export function clearRegionCache() {
    cachedRegion = null;
    cacheTime = 0;
}
/**
 * 获取区域信息对象
 * 包含国家、城市、原始区域代码
 */
export function getRegionInfo() {
    const region = getStandardizedRegion();
    const parts = region.split("/");
    return {
        country: parts[0] || "Unknown",
        city: parts[1] || "Unknown",
        raw: region,
    };
}
//# sourceMappingURL=region.js.map