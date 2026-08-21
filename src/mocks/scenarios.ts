import type { BusinessFact, CriterionResult, TranscriptSegment } from "@/domain/types"

export interface ScenarioTemplate {
  id: string
  serviceType: string
  productCategory: string
  issueTopic: string
  requestType: string
  requestSummary: string
  issueSummary?: string
  baseScore: number
  risk?: "Critical" | "High" | "Medium" | "Low"
  critical: boolean
  hasAudio: boolean
  durationSeconds: number
  segments: TranscriptSegment[]
  sections: { section: string; criteria: Omit<CriterionResult, "section">[] }[]
  businessFacts: BusinessFact[]
}

/**
 * 场景一：维修服务 · 洗碗机排水异常 · 未执行必要催促。
 * 证据链：对话片段 ↔ 评价项 ↔ 业务事实（服务单 + 催促记录）。
 */
const SCENARIO_REPAIR_REMINDER: ScenarioTemplate = {
  id: "sc-repair-reminder",
  serviceType: "维修服务",
  productCategory: "洗碗机",
  issueTopic: "排水异常",
  requestType: "维修申请",
  requestSummary:
    "消费者反馈洗碗机无法排水，希望尽快安排工程师上门，并表示之前已报修一次但一直无人联系。",
  issueSummary: "未确认历史服务单状态；未执行必要催促",
  baseScore: 78,
  risk: "High",
  critical: false,
  hasAudio: true,
  durationSeconds: 768,
  segments: [
    { id: "s1", speaker: "system", speakerLabel: "系统", startSeconds: 0, text: "来电进入热线队列，等待 42 秒后接入坐席。" },
    { id: "s2", speaker: "agent", speakerLabel: "坐席", startSeconds: 45, text: "您好，星辉家电服务热线，请问有什么可以帮您？" },
    { id: "s3", speaker: "consumer", speakerLabel: "消费者", startSeconds: 52, text: "我家的洗碗机不排水了，里面全是水，你们什么时候能派人来看看？", criterionRefs: ["c-request"] },
    { id: "s4", speaker: "agent", speakerLabel: "坐席", startSeconds: 68, text: "好的，理解您的着急。请问机器型号方便看一下吗？我这边先帮您记录。" },
    { id: "s5", speaker: "consumer", speakerLabel: "消费者", startSeconds: 80, text: "型号是 XW-6012。对了，我上周就打过一次电话，说会安排人，到现在都没人来。", criterionRefs: ["c-confirm", "c-urge"] },
    { id: "s6", speaker: "agent", speakerLabel: "坐席", startSeconds: 96, text: "抱歉让您久等了。我这边帮您登记一个新的维修申请，安排工程师尽快上门。", criterionRefs: ["c-create"] },
    { id: "s7", speaker: "consumer", speakerLabel: "消费者", startSeconds: 112, text: "那上次那个单子呢？会不会又没人管？你们能不能催一下？", criterionRefs: ["c-urge"] },
    { id: "s8", speaker: "agent", speakerLabel: "坐席", startSeconds: 128, text: "这个您放心，我登记之后工程师会联系您的，一般三到五个工作日。", criterionRefs: ["c-urge"] },
    { id: "s9", speaker: "consumer", speakerLabel: "消费者", startSeconds: 146, text: "行吧，那尽快啊，家里没法用洗碗机真的很不方便。" },
    { id: "s10", speaker: "agent", speakerLabel: "坐席", startSeconds: 158, text: "好的，已经帮您登记。请问还有其他可以帮您的吗？", criterionRefs: ["c-norm"] },
    { id: "s11", speaker: "consumer", speakerLabel: "消费者", startSeconds: 170, text: "没有了，谢谢。" },
    { id: "s12", speaker: "agent", speakerLabel: "坐席", startSeconds: 176, text: "感谢您的来电，祝您生活愉快，再见。", criterionRefs: ["c-norm"] },
  ],
  sections: [
    {
      section: "诉求识别",
      criteria: [
        {
          id: "c-request",
          criterion: "消费者诉求识别",
          result: "PASS",
          reason: "坐席正确识别消费者核心诉求为洗碗机排水异常的上门维修需求。",
          evidenceSegmentIds: ["s3"],
          confidence: 0.96,
        },
        {
          id: "c-confirm",
          criterion: "确认消费者真实诉求",
          result: "FAIL",
          severity: "High",
          reason:
            "消费者明确提及上周已报修且无人跟进，坐席未查询历史服务单、未确认本次诉求是催办而非新报修，直接按新维修申请处理。",
          evidenceSegmentIds: ["s5", "s7"],
          businessEvidenceIds: ["f-sr"],
          confidence: 0.91,
        },
      ],
    },
    {
      section: "服务流程",
      criteria: [
        {
          id: "c-create",
          criterion: "服务请求创建正确性",
          result: "PASS",
          reason: "新维修申请创建成功，型号、地址、联系方式记录完整。",
          businessEvidenceIds: ["f-sr2"],
          confidence: 0.93,
        },
        {
          id: "c-urge",
          criterion: "必要催促执行",
          result: "FAIL",
          severity: "Medium",
          reason:
            "存在超期未处理的历史服务单，坐席未执行催促动作，也未向消费者说明历史单据处理安排。",
          evidenceSegmentIds: ["s7", "s8"],
          businessEvidenceIds: ["f-urge"],
          confidence: 0.89,
        },
      ],
    },
    {
      section: "合规",
      criteria: [
        {
          id: "c-safe",
          criterion: "信息安全合规",
          result: "PASS",
          reason: "未索取与本次服务无关的敏感信息。",
          confidence: 0.98,
        },
        {
          id: "c-promise",
          criterion: "违规承诺",
          result: "PASS",
          reason: "使用标准时效口径（三到五个工作日），未做出超范围承诺。",
          evidenceSegmentIds: ["s8"],
          confidence: 0.95,
        },
      ],
    },
    {
      section: "沟通规范",
      criteria: [
        {
          id: "c-norm",
          criterion: "开场与结束规范",
          result: "PASS",
          reason: "开场问候、结束语完整规范。",
          evidenceSegmentIds: ["s2", "s12"],
          confidence: 0.97,
        },
      ],
    },
  ],
  businessFacts: [
    {
      id: "f-sr",
      kind: "service-request",
      title: "历史服务请求 #SR20260811-2214",
      fields: [
        { label: "类型", value: "维修申请" },
        { label: "状态", value: "待派单（超期 3 天）" },
        { label: "创建时间", value: "2026-08-11 14:22" },
        { label: "当前节点", value: "派单池" },
      ],
      usedByCriterionIds: ["c-confirm"],
    },
    {
      id: "f-sr2",
      kind: "service-request",
      title: "本次服务请求 #SR20260818-1032",
      fields: [
        { label: "类型", value: "维修申请" },
        { label: "状态", value: "已创建" },
        { label: "创建时间", value: "2026-08-18 10:44" },
        { label: "当前节点", value: "待派单" },
      ],
      usedByCriterionIds: ["c-create"],
    },
    {
      id: "f-urge",
      kind: "reminder",
      title: "催促记录",
      fields: [{ label: "历史单据催促", value: "无（应执行未执行）" }],
      usedByCriterionIds: ["c-urge"],
    },
    {
      id: "f-timeline",
      kind: "timeline",
      title: "业务时间线",
      fields: [
        { label: "08-11 14:22", value: "消费者首次报修，创建 #SR20260811-2214" },
        { label: "08-14 09:00", value: "服务单超过派单 SLA" },
        { label: "08-18 10:32", value: "消费者二次来电" },
        { label: "08-18 10:44", value: "坐席创建新服务单" },
      ],
    },
  ],
}

/** 场景二：安装服务 · 全流程规范，高质量样本。 */
const SCENARIO_INSTALL_GOOD: ScenarioTemplate = {
  id: "sc-install-good",
  serviceType: "安装服务",
  productCategory: "空调",
  issueTopic: "安装预约",
  requestType: "安装预约",
  requestSummary: "消费者新购空调，希望预约本周六上午上门安装，并确认是否需要额外材料费。",
  baseScore: 96,
  risk: "Low",
  critical: false,
  hasAudio: true,
  durationSeconds: 421,
  segments: [
    { id: "s1", speaker: "agent", speakerLabel: "坐席", startSeconds: 8, text: "您好，星辉家电服务热线，请问有什么可以帮您？" },
    { id: "s2", speaker: "consumer", speakerLabel: "消费者", startSeconds: 15, text: "我前天买的空调到了，想约这周六上午安装，可以吗？", criterionRefs: ["c-request"] },
    { id: "s3", speaker: "agent", speakerLabel: "坐席", startSeconds: 28, text: "好的，帮您查询了一下，周六上午还有安装档期，我帮您预约 9 点到 12 点这个时段。", criterionRefs: ["c-confirm"] },
    { id: "s4", speaker: "consumer", speakerLabel: "消费者", startSeconds: 44, text: "行。对了，安装会不会另外收材料费？" },
    { id: "s5", speaker: "agent", speakerLabel: "坐席", startSeconds: 56, text: "标准安装是免费的。如果需要加长铜管或特殊支架，工程师会按公示价格先和您确认后再施工。", criterionRefs: ["c-promise"] },
    { id: "s6", speaker: "consumer", speakerLabel: "消费者", startSeconds: 76, text: "明白，那到时候我家里有人。" },
    { id: "s7", speaker: "agent", speakerLabel: "坐席", startSeconds: 86, text: "好的，已为您预约周六上午。安装前工程师会提前一小时联系您。还有其他可以帮您的吗？", criterionRefs: ["c-create"] },
    { id: "s8", speaker: "consumer", speakerLabel: "消费者", startSeconds: 100, text: "没有了，谢谢。" },
    { id: "s9", speaker: "agent", speakerLabel: "坐席", startSeconds: 106, text: "感谢您的来电，祝您生活愉快，再见。", criterionRefs: ["c-norm"] },
  ],
  sections: [
    {
      section: "诉求识别",
      criteria: [
        { id: "c-request", criterion: "消费者诉求识别", result: "PASS", reason: "准确识别安装预约诉求与时段偏好。", evidenceSegmentIds: ["s2"], confidence: 0.98 },
        { id: "c-confirm", criterion: "确认消费者真实诉求", result: "PASS", reason: "确认时段、地址与材料费疑问后完成预约。", evidenceSegmentIds: ["s3", "s4"], confidence: 0.97 },
      ],
    },
    {
      section: "服务流程",
      criteria: [
        { id: "c-create", criterion: "服务请求创建正确性", result: "PASS", reason: "安装工单创建成功，时段与联系方式正确。", evidenceSegmentIds: ["s7"], confidence: 0.97 },
      ],
    },
    {
      section: "合规",
      criteria: [
        { id: "c-promise", criterion: "违规承诺", result: "PASS", reason: "材料费口径符合公示政策，无超范围承诺。", evidenceSegmentIds: ["s5"], confidence: 0.96 },
        { id: "c-safe", criterion: "信息安全合规", result: "PASS", reason: "未涉及敏感信息。", confidence: 0.99 },
      ],
    },
    {
      section: "沟通规范",
      criteria: [
        { id: "c-norm", criterion: "开场与结束规范", result: "PASS", reason: "开场、结束语规范。", evidenceSegmentIds: ["s1", "s9"], confidence: 0.98 },
      ],
    },
  ],
  businessFacts: [
    {
      id: "f-sr",
      kind: "service-request",
      title: "安装工单 #WO20260818-0912",
      fields: [
        { label: "类型", value: "安装预约" },
        { label: "状态", value: "已预约" },
        { label: "预约时段", value: "2026-08-22 09:00–12:00" },
        { label: "创建时间", value: "2026-08-18 09:12" },
      ],
      usedByCriterionIds: ["c-create"],
    },
  ],
}

/** 场景三：技术咨询 · 违规承诺（Critical）。 */
const SCENARIO_PROMISE_CRITICAL: ScenarioTemplate = {
  id: "sc-promise-critical",
  serviceType: "技术咨询",
  productCategory: "热水器",
  issueTopic: "错误代码咨询",
  requestType: "投诉升级",
  requestSummary: "消费者咨询热水器 E3 错误代码，情绪激动要求当天解决，坐席做出无法兑现的上门与赔偿承诺。",
  issueSummary: "违规承诺：承诺 2 小时内上门并全额赔偿",
  baseScore: 42,
  risk: "Critical",
  critical: true,
  hasAudio: true,
  durationSeconds: 655,
  segments: [
    { id: "s1", speaker: "agent", speakerLabel: "坐席", startSeconds: 6, text: "您好，星辉家电服务热线，请问有什么可以帮您？" },
    { id: "s2", speaker: "consumer", speakerLabel: "消费者", startSeconds: 14, text: "你们热水器显示 E3 又不出热水了，大冬天的，这都第三次了！今天必须给我解决！", criterionRefs: ["c-request"] },
    { id: "s3", speaker: "agent", speakerLabel: "坐席", startSeconds: 32, text: "非常抱歉给您带来不便。E3 一般是排烟或传感器问题，我马上安排师傅今天上门。", criterionRefs: ["c-promise"] },
    { id: "s4", speaker: "consumer", speakerLabel: "消费者", startSeconds: 50, text: "今天什么时候？我下午要出门。" },
    { id: "s5", speaker: "agent", speakerLabel: "坐席", startSeconds: 60, text: "两小时内肯定到，您放心。这次所有费用我们全赔，机器有问题直接给您换新的。", criterionRefs: ["c-promise"] },
    { id: "s6", speaker: "consumer", speakerLabel: "消费者", startSeconds: 78, text: "你说的啊，那我等你电话。" },
    { id: "s7", speaker: "agent", speakerLabel: "坐席", startSeconds: 88, text: "没问题，包在我身上。", criterionRefs: ["c-promise"] },
    { id: "s8", speaker: "agent", speakerLabel: "坐席", startSeconds: 96, text: "那先这样，再见。" },
  ],
  sections: [
    {
      section: "诉求识别",
      criteria: [
        { id: "c-request", criterion: "消费者诉求识别", result: "PASS", reason: "识别为重复故障的紧急维修诉求。", evidenceSegmentIds: ["s2"], confidence: 0.94 },
        { id: "c-confirm", criterion: "确认消费者真实诉求", result: "PASS", reason: "确认了故障现象与时间约束。", evidenceSegmentIds: ["s2", "s4"], confidence: 0.9 },
      ],
    },
    {
      section: "合规",
      criteria: [
        {
          id: "c-promise",
          criterion: "违规承诺",
          result: "FAIL",
          severity: "Critical",
          reason:
            "坐席承诺“两小时内肯定到”“所有费用全赔”“直接换新”，均超出授权口径，且未查询工程师排班与保修状态。",
          evidenceSegmentIds: ["s5", "s7"],
          confidence: 0.97,
        },
        { id: "c-safe", criterion: "信息安全合规", result: "PASS", reason: "未涉及敏感信息。", confidence: 0.98 },
      ],
    },
    {
      section: "服务流程",
      criteria: [
        {
          id: "c-create",
          criterion: "服务请求创建正确性",
          result: "FAIL",
          severity: "High",
          reason: "通话中口头承诺上门，但系统未创建对应加急服务单。",
          businessEvidenceIds: ["f-sr"],
          confidence: 0.92,
        },
      ],
    },
    {
      section: "沟通规范",
      criteria: [
        { id: "c-norm", criterion: "开场与结束规范", result: "FAIL", severity: "Medium", reason: "结束语缺失，未做诉求复述与工单号告知。", evidenceSegmentIds: ["s8"], confidence: 0.9 },
      ],
    },
  ],
  businessFacts: [
    {
      id: "f-sr",
      kind: "service-request",
      title: "服务请求查询",
      fields: [
        { label: "加急服务单", value: "未创建" },
        { label: "历史维修记录", value: "2 次（07-30 / 08-09）" },
        { label: "保修状态", value: "保修期内" },
      ],
      usedByCriterionIds: ["c-create"],
    },
  ],
}

/** 场景四：退换货 · 服务请求创建错误。 */
const SCENARIO_RETURN_WRONG: ScenarioTemplate = {
  id: "sc-return-wrong",
  serviceType: "退换货服务",
  productCategory: "洗衣机",
  issueTopic: "物流破损",
  requestType: "投诉升级",
  requestSummary: "消费者反馈新购洗衣机开箱破损要求换货，坐席将换货申请误创建为维修申请。",
  issueSummary: "服务请求类型创建错误",
  baseScore: 68,
  risk: "High",
  critical: false,
  hasAudio: false,
  durationSeconds: 512,
  segments: [
    { id: "s1", speaker: "agent", speakerLabel: "坐席", startSeconds: 5, text: "您好，星辉家电，请问有什么可以帮您？" },
    { id: "s2", speaker: "consumer", speakerLabel: "消费者", startSeconds: 12, text: "洗衣机今天刚送到，开箱发现外壳凹了一大块，我要换货。", criterionRefs: ["c-request"] },
    { id: "s3", speaker: "agent", speakerLabel: "坐席", startSeconds: 26, text: "好的，我帮您登记一下，安排师傅上门处理。", criterionRefs: ["c-create"] },
    { id: "s4", speaker: "consumer", speakerLabel: "消费者", startSeconds: 40, text: "是换一台新的，不是修。你们开箱破损不是直接换吗？", criterionRefs: ["c-confirm"] },
    { id: "s5", speaker: "agent", speakerLabel: "坐席", startSeconds: 55, text: "对，师傅上门看一下就会给您处理的。", criterionRefs: ["c-confirm", "c-create"] },
    { id: "s6", speaker: "consumer", speakerLabel: "消费者", startSeconds: 70, text: "……行吧，那尽快。" },
    { id: "s7", speaker: "agent", speakerLabel: "坐席", startSeconds: 80, text: "好的，还有其他问题吗？" },
    { id: "s8", speaker: "consumer", speakerLabel: "消费者", startSeconds: 88, text: "没了。" },
    { id: "s9", speaker: "agent", speakerLabel: "坐席", startSeconds: 93, text: "好的，再见。", criterionRefs: ["c-norm"] },
  ],
  sections: [
    {
      section: "诉求识别",
      criteria: [
        { id: "c-request", criterion: "消费者诉求识别", result: "PASS", reason: "识别为物流破损换货诉求。", evidenceSegmentIds: ["s2"], confidence: 0.95 },
        {
          id: "c-confirm",
          criterion: "确认消费者真实诉求",
          result: "FAIL",
          severity: "High",
          reason: "消费者二次强调“换货”后，坐席仍未纠正处理方式，诉求确认失败。",
          evidenceSegmentIds: ["s4", "s5"],
          confidence: 0.9,
        },
      ],
    },
    {
      section: "服务流程",
      criteria: [
        {
          id: "c-create",
          criterion: "服务请求创建正确性",
          result: "FAIL",
          severity: "High",
          reason: "换货申请被创建为“维修申请”，类型错误，将导致后续流转错误。",
          businessEvidenceIds: ["f-sr"],
          confidence: 0.93,
        },
      ],
    },
    {
      section: "合规",
      criteria: [
        { id: "c-promise", criterion: "违规承诺", result: "PASS", reason: "未做出超范围承诺。", confidence: 0.94 },
        { id: "c-safe", criterion: "信息安全合规", result: "PASS", reason: "未涉及敏感信息。", confidence: 0.99 },
      ],
    },
    {
      section: "沟通规范",
      criteria: [
        { id: "c-norm", criterion: "开场与结束规范", result: "PASS", reason: "基本规范，但缺少工单号告知。", evidenceSegmentIds: ["s1", "s9"], confidence: 0.9 },
      ],
    },
  ],
  businessFacts: [
    {
      id: "f-sr",
      kind: "service-request",
      title: "服务请求 #SR20260817-1544",
      fields: [
        { label: "创建类型", value: "维修申请（应为退换货）" },
        { label: "状态", value: "待派单" },
        { label: "创建时间", value: "2026-08-17 15:44" },
      ],
      usedByCriterionIds: ["c-create"],
    },
    {
      id: "f-logistics",
      kind: "tool-fact",
      title: "物流签收记录（Tool 查询）",
      fields: [
        { label: "签收时间", value: "2026-08-17 11:20" },
        { label: "破损报备", value: "消费者已上传开箱照片 3 张" },
      ],
    },
  ],
}

export const SCENARIOS: ScenarioTemplate[] = [
  SCENARIO_REPAIR_REMINDER,
  SCENARIO_INSTALL_GOOD,
  SCENARIO_PROMISE_CRITICAL,
  SCENARIO_RETURN_WRONG,
]
