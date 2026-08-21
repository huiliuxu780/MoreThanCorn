/**
 * 企业级部署配置。
 * Implementation Spec §5：时间统一按企业时区展示，不在页面组件内硬编码。
 */
export const ENTERPRISE_CONFIG = {
  timezone: "Asia/Shanghai",
  locale: "zh-CN",
} as const
