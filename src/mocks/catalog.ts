/**
 * 业务主数据与正式 Section / Criterion 目录。
 * 示例仅用于说明产品模型，不代表生产真实值（Master §0.1）。
 */

export const DEPARTMENTS = [
  { id: "D01", name: "消费者服务部" },
  { id: "D02", name: "技术支持部" },
] as const

export const TEAMS = [
  { id: "T01", name: "上海热线一组", departmentId: "D01" },
  { id: "T02", name: "上海热线二组", departmentId: "D01" },
  { id: "T03", name: "北京在线一组", departmentId: "D01" },
  { id: "T04", name: "广州技术支持组", departmentId: "D02" },
] as const

export const SERVICERS = [
  { id: "A001", name: "张三", teamId: "T01", skill: "高级" },
  { id: "A002", name: "李四", teamId: "T01", skill: "中级" },
  { id: "A003", name: "王五", teamId: "T01", skill: "初级" },
  { id: "A004", name: "赵敏", teamId: "T02", skill: "高级" },
  { id: "A005", name: "孙倩", teamId: "T02", skill: "中级" },
  { id: "A006", name: "周凯", teamId: "T02", skill: "初级" },
  { id: "A007", name: "吴婷", teamId: "T03", skill: "中级" },
  { id: "A008", name: "郑浩", teamId: "T03", skill: "初级" },
  { id: "A009", name: "陈静", teamId: "T04", skill: "高级" },
  { id: "A010", name: "刘洋", teamId: "T04", skill: "中级" },
] as const

export const BRANDS = ["星辉家电", "悦动电器", "康家生活"] as const
export const PRODUCT_CATEGORIES = ["洗碗机", "洗衣机", "空调", "热水器", "油烟机"] as const
export const SERVICE_TYPES = ["维修服务", "安装服务", "技术咨询", "退换货服务"] as const
export const ISSUES = [
  "排水异常",
  "无法启动",
  "噪音异响",
  "安装预约",
  "错误代码咨询",
  "物流破损",
] as const
export const REQUEST_TYPES = ["维修申请", "安装预约", "政策咨询", "投诉升级"] as const

/** 正式 Section / Criterion 目录：问题分类只能来自这里。 */
export const CRITERIA_CATALOG = [
  { section: "诉求识别", criterion: "消费者诉求识别" },
  { section: "诉求识别", criterion: "确认消费者真实诉求" },
  { section: "服务流程", criterion: "服务请求创建正确性" },
  { section: "服务流程", criterion: "必要催促执行" },
  { section: "合规", criterion: "违规承诺" },
  { section: "合规", criterion: "信息安全合规" },
  { section: "沟通规范", criterion: "开场与结束规范" },
] as const

export function criterionSeverity(criterion: string): "Critical" | "High" | "Medium" {
  if (criterion === "违规承诺" || criterion === "信息安全合规") return "Critical"
  if (criterion === "服务请求创建正确性" || criterion === "确认消费者真实诉求") return "High"
  return "Medium"
}
