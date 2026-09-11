/** 权限策略目录（14 号稿 P1）：工具三态行 + 六类守卫 22 规则种子 + Shell 逃逸固定层描述。
 *  与后端 server/app/permission_seed.py 的 pattern 目录对齐（子串级；pattern=null 者
 *  为解析器层规则，P2 扩展前 UI 标「规划」不假装生效）。 */

export type ToolBehavior = "allow" | "ask" | "deny"

export interface ToolRow {
  names: string[]
  family: string
  desc: string
  def: ToolBehavior
}

/** 静态 17 件（运行时默认装配面）；manifest 动态件只读展示不在此表。 */
export const TOOL_ROWS: ToolRow[] = [
  { names: ["Bash"], family: "Shell", desc: "shell 命令执行；询问态按守卫规则命中暂停", def: "allow" },
  { names: ["Write", "Edit"], family: "文件", desc: "写/编辑文件（工作目录内）", def: "allow" },
  { names: ["Read", "Grep", "Glob"], family: "文件", desc: "只读检索；敏感路径 glob 命中仍走询问", def: "allow" },
  { names: ["TaskCreate", "TaskList", "TaskGet", "TaskUpdate"], family: "计划", desc: "运行内计划项管理", def: "allow" },
  { names: ["ToolStop"], family: "后台", desc: "停止后台任务", def: "allow" },
  { names: ["ScheduleCreate"], family: "调度", desc: "创建定时任务＝持久副作用", def: "allow" },
  { names: ["ScheduleView", "ScheduleList"], family: "调度", desc: "只读", def: "allow" },
  { names: ["ScheduleDelete"], family: "调度", desc: "删除调度＝不可逆", def: "allow" },
  { names: ["run_workflow", "run_agent_flow"], family: "平台", desc: "平台编排调用", def: "allow" },
]

export interface GuardRule {
  id: string
  desc: string
  risk: "crit" | "high"
  /** 子串模式；null=解析器层规则（P2 前不生效，UI 标规划） */
  pattern: string | null
  def: "ask" | "deny"
}

export interface GuardCategory {
  id: string
  name: string
  group: "A" | "B" | "C"
  rules: GuardRule[]
}

export const GUARD_CATEGORIES: GuardCategory[] = [
  {
    id: "cmd_injection", name: "命令注入", group: "A",
    rules: [
      { id: "TOOL_CMD_FS_DESTRUCTION", desc: "检测底层磁盘格式化或擦除命令", risk: "crit", pattern: "mkfs", def: "ask" },
      { id: "TOOL_CMD_DANGEROUS_RM", desc: "检测可能导致数据丢失的 rm 命令", risk: "high", pattern: "rm -rf", def: "ask" },
      { id: "TOOL_CMD_DANGEROUS_MV", desc: "检测可能意外移动或覆盖文件的 mv 命令", risk: "high", pattern: null, def: "ask" },
    ],
  },
  {
    id: "resource_abuse", name: "资源滥用", group: "A",
    rules: [
      { id: "TOOL_CMD_DOS_FORK_BOMB", desc: "检测经典 Bash fork 炸弹与大规模进程终止", risk: "crit", pattern: ":():", def: "deny" },
      { id: "TOOL_CMD_SYSTEM_REBOOT", desc: "检测会终止主机系统的重启或关机命令", risk: "crit", pattern: "reboot", def: "deny" },
      { id: "TOOL_CMD_SERVICE_RESTART", desc: "检测可能中断系统服务的服务管理命令", risk: "high", pattern: "systemctl", def: "ask" },
      { id: "TOOL_CMD_PROCESS_KILL", desc: "检测可能杀死关键进程的进程终止命令", risk: "high", pattern: "kill -9", def: "ask" },
    ],
  },
  {
    id: "code_exec", name: "代码执行", group: "B",
    rules: [
      { id: "TOOL_CMD_PIPE_TO_SHELL", desc: "检测下载远程脚本并直接执行的 curl | bash 模式", risk: "crit", pattern: "| bash", def: "deny" },
      { id: "TOOL_CMD_CONTROL_CHARS", desc: "命令包含不可打印的控制字符，可能绕过安全检查", risk: "crit", pattern: null, def: "deny" },
      { id: "TOOL_CMD_OBFUSCATED_EXEC", desc: "检测将 base64 解码结果直接管道到 shell 解释器执行", risk: "high", pattern: "base64", def: "ask" },
      { id: "TOOL_CMD_IFS_INJECTION", desc: "命令使用 $IFS 变量，可能绕过安全校验", risk: "high", pattern: "$IFS", def: "ask" },
      { id: "TOOL_CMD_UNICODE_WHITESPACE", desc: "命令包含 Unicode 空白字符，可能造成解析不一致", risk: "high", pattern: null, def: "ask" },
      { id: "TOOL_CMD_JQ_SYSTEM", desc: "jq 命令包含 system() 函数，可用于执行任意 shell 命令", risk: "high", pattern: null, def: "ask" },
      { id: "TOOL_CMD_JQ_FILE_FLAGS", desc: "jq 命令使用了可读取任意文件或加载外部代码的标志", risk: "high", pattern: null, def: "ask" },
      { id: "TOOL_CMD_ZSH_DANGEROUS", desc: "命令使用了可绕过安全检查的 Zsh 专用内建功能", risk: "high", pattern: "zsh -c", def: "ask" },
    ],
  },
  {
    id: "network_abuse", name: "网络滥用", group: "B",
    rules: [
      { id: "TOOL_CMD_REVERSE_SHELL", desc: "检测建立反弹 shell 或未授权网络通道的行为", risk: "crit", pattern: "/dev/tcp", def: "deny" },
      { id: "TOOL_WEBFETCH_LOCAL_LOOPBACK", desc: "检测对本地回环或云 metadata 地址的 WebFetch", risk: "high", pattern: null, def: "ask" },
    ],
  },
  {
    id: "sensitive_access", name: "敏感文件访问", group: "C",
    rules: [
      { id: "TOOL_CMD_SYSTEM_TAMPERING", desc: "检测访问 cron 任务、SSH 密钥或 sudo 权限文件（读与改）", risk: "high", pattern: ".ssh", def: "ask" },
      { id: "TOOL_CMD_PROC_ENVIRON", desc: "检测访问 /proc/*/environ，可能泄露进程环境变量凭据", risk: "high", pattern: "/proc/", def: "ask" },
      { id: "TOOL_WEBFETCH_FILE_SCHEME", desc: "检测 WebFetch 使用非 HTTP(S) scheme（本地文件/SSRF）", risk: "high", pattern: "file://", def: "ask" },
    ],
  },
  {
    id: "priv_esc", name: "权限提升", group: "A",
    rules: [
      { id: "TOOL_CMD_PRIVILEGE_ESCALATION", desc: "检测使用 sudo、su、doas、pkexec 或 runas 提权", risk: "crit", pattern: "sudo", def: "ask" },
      { id: "TOOL_CMD_UNSAFE_PERMISSIONS", desc: "检测全局权限放开（chmod 777）或设置不可变标志", risk: "high", pattern: "chmod 777", def: "ask" },
    ],
  },
]

export const ESCAPE_SUBRULES: { name: string; desc: string; native: boolean }[] = [
  { name: "命令替换", desc: "反引号、$()、<()、=()、$[]、Zsh =cmd（官方解析器 bypass-immune ASK）", native: true },
  { name: "混淆标志", desc: "$'…'、$\"…\"、''-、\"\"- 等特殊引用", native: false },
  { name: "反斜杠转义空白", desc: "引号外 \\ 空格/TAB 拆 token", native: false },
  { name: "反斜杠转义操作符", desc: "引号外 \\; \\| \\& 等（find -exec 豁免）", native: false },
  { name: "换行符", desc: "引号外 \\r/换行隐藏第二条命令（heredoc 豁免）", native: false },
  { name: "注释引号失同步", desc: "# 注释内出现单/双引号", native: false },
  { name: "引号内换行", desc: "引号内换行且下行以 # 起始", native: false },
]

export interface PermissionsV2 {
  version: 2
  master: boolean
  tools: Record<string, ToolBehavior>
  sensitive_enabled: boolean
  sensitive_paths: string[]
  guards: Record<string, { enabled: boolean; rules: Record<string, "ask" | "deny"> }>
  enterprise: boolean
}

/** 默认策略＝现状行为（master 关=bypass、全工具 allow），opt-in 收紧不改存量。 */
export function defaultPermissions(): PermissionsV2 {
  const tools: Record<string, ToolBehavior> = {}
  for (const row of TOOL_ROWS) for (const n of row.names) tools[n] = "allow"
  const guards: PermissionsV2["guards"] = {}
  for (const cat of GUARD_CATEGORIES) {
    guards[cat.id] = { enabled: true, rules: Object.fromEntries(cat.rules.map((r) => [r.id, r.def])) }
  }
  return {
    version: 2,
    master: false,
    tools,
    sensitive_enabled: false,
    sensitive_paths: [],
    guards,
    enterprise: false,
  }
}

export function mergePermissions(raw: unknown): PermissionsV2 {
  const base = defaultPermissions()
  if (!raw || typeof raw !== "object") return base
  const r = raw as Record<string, unknown>
  const out: PermissionsV2 = {
    ...base,
    master: r.master === true,
    sensitive_enabled: r.sensitive_enabled === true,
    sensitive_paths: Array.isArray(r.sensitive_paths) ? (r.sensitive_paths as string[]) : [],
    enterprise: r.enterprise === true,
    tools: { ...base.tools, ...((r.tools as Record<string, ToolBehavior>) ?? {}) },
    guards: { ...base.guards, ...((r.guards as PermissionsV2["guards"]) ?? {}) },
  }
  return out
}
