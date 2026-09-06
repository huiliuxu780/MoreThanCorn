/** 节点元信息：类型 → lucide 图标映射 + 抽屉头部一句话描述（06-master-spec §2.5，全量 21+ 节点）。
 *  palette / 节点卡 / Inspector 头部 / 顶栏检查清单共用，杜绝多份映射。 */
import {
  Bell,
  BookOpen,
  Bot,
  Brain,
  Braces,
  Code,
  Database,
  FilePlus2,
  Flag,
  GitBranch,
  Hourglass,
  MessageSquare,
  Network,
  PenLine,
  Play,
  Repeat,
  Route,
  Server,
  Wrench,
} from "lucide-react"

export const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  input: Play, llm: Bot, tool: Wrench, condition: GitBranch, transform: Braces,
  end: Flag, "create-record": FilePlus2, notification: Bell, "workflow-exec": Network,
  "knowledge-retrieval": BookOpen, "mcp-call": Server,
  "workflow-select": Route, "workflow-fixed": Route, reply: MessageSquare,
  "memory-variable": Brain, "code-write": Code, "query-rewrite": PenLine,
  "decision-class": GitBranch, agent: Bot, "agent-select": Route, "agent-exec": Play,
  loop: Repeat, "wait-review": Hourglass, "data-read": Database,
}

export function TypeIcon({ type, className }: { type: string; className?: string }) {
  const I = TYPE_ICON[type] ?? Braces
  return <I className={className} />
}

/** 06-master-spec §2.5：抽屉头部一句节点描述（评审 08-25 定稿文案）。 */
export const NODE_DESC: Record<string, string> = {
  input: "工作流的开始节点，定义公共输入变量，全节点可引用",
  llm: "大模型节点可调用大语言模型，根据输入参数与提示词生成指定格式的回复",
  tool: "绑定一个插件工具版本，按工具声明的参数发起外部调用",
  condition: "条件判断节点可定义多个判断条件，对应多个流程分支。实现不同业务规则的分流",
  "decision-class": "决策分类节点用大模型把输入归入预设分类，每个分类对应一条分支",
  transform: "变量处理节点用声明式模板聚合/拼接上游变量，不执行任意代码",
  "query-rewrite": "Query 改写节点在检索前改写查询，输出 queryList 数组",
  "code-write": "代码编写节点在 Python 沙箱中执行 main(args)，10 秒超时",
  end: "工作流的结束节点，在工作流完成运行后将相关信息通过Agent回答或通过API输入到其余工作流或外部系统中",
  "create-record": "创建质检记录节点把结构化输出幂等写入质检业务层",
  notification: "通知节点把消息写入运行日志（V1 渠道=日志）",
  "workflow-exec": "工作流执行节点按编码同步调用另一个工作流",
  "workflow-select": "工作流选择节点用大模型从候选工作流中路由出一个",
  "workflow-fixed": "工作流节点绑定一个固定工作流并执行",
  "knowledge-retrieval": "知识检索节点在指定知识源中按 query 召回切片",
  "mcp-call": "MCP 工具节点调用 MCP Server 握手发现的具体工具",
  reply: "对话回复节点把内容写入对话流",
  "memory-variable": "记忆变量节点读写 run 内共享状态（跨会话 Future）",
  agent: "Agent 节点调用一个固定的成员 Agent，输入按映射表解析",
  "agent-select": "Agent 选择节点根据问题与 Agent 描述路由出一个成员，未命中走兜底",
  "agent-exec": "Agent 执行节点按 agentCode 执行对应成员，支持输入绑定动态执行",
  loop: "循环迭代节点对 Array 变量逐条执行循环体子图，输出聚合",
  "wait-review": "暂停 Run 等待人工或定时，落盘可恢复",
  "data-read": "从 DataAsset 按窗口/抽样取数，与创建质检记录对称",
}
