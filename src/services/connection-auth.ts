/** Connection 鉴权/环境共享常量——wf-connections 与 connection-picker 单一事实源（R4）。
 * kind 与后端 auth_signers.KINDS 对齐；旧人类可读串由后端归一化，前端一律提交规范值。 */

export const KINDS = [
  { value: "none", label: "无鉴权" },
  { value: "api_key", label: "API Key" },
  { value: "bearer", label: "Bearer Token" },
  { value: "basic", label: "Basic Auth" },
  { value: "aksk", label: "AkSk 签名" },
  { value: "script", label: "自定义脚本" },
] as const

const KIND_LABEL: Record<string, string> = Object.fromEntries(KINDS.map((k) => [k.value, k.label]))
export const kindLabel = (k: string) => KIND_LABEL[k] ?? k

export const PROTOCOLS = [
  { value: "http-api", label: "HTTP API" },
  { value: "llm", label: "LLM" },
  { value: "mcp-http", label: "MCP" },
  { value: "mysql", label: "MySQL" },
  { value: "postgresql", label: "PostgreSQL" },
  { value: "oss", label: "OSS" },
] as const

export const protocolLabel = (p: string) => PROTOCOLS.find((x) => x.value === p)?.label ?? p
export const isDb = (p: string) => p === "mysql" || p === "postgresql"
export const isOss = (p: string) => p === "oss"

/** 环境槽预设（可自定义扩展，与后端 connection_runtime.ENV_PRESETS 对齐） */
export const ENV_PRESETS = [
  { code: "dev", label: "日常" },
  { code: "test", label: "测试" },
  { code: "pre", label: "预发" },
  { code: "prod", label: "生产" },
]

/** AkSk 模板脚本（2026-08-30 验收版本，Apifox 兼容 shim 下原样可跑） */
export const AKSK_TEMPLATE = `// AkSk 鉴权模板：env 变量 accesskey/secretKey 来自本连接的密钥配置
const accesskey = pm.environment.get("accesskey");
const secretKey = pm.environment.get("secretKey");
if (!accesskey || !secretKey) {
    pm.alert("请先配置 accesskey 与 secretKey！");
    return;
}
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
function hmacSha1Sign(key, data) {
    return CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA1(data, key));
}
const timeStamp = new Date().getTime();
const nonce = uuidv4();
const stringToSign = accesskey + ":" + timeStamp + ":" + nonce + ":";
const signature = hmacSha1Sign(secretKey, stringToSign);
const authValue = btoa(signature + ":" + stringToSign);
pm.request.headers.add({ key: "Authorization", value: "BasicAKSK " + authValue });
`
