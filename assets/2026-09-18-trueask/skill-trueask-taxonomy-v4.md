---
name: trueask-taxonomy-v4
description: TrueAsk 家电服务对话分析语义体系 v4（schema 2.0）——状态/场景/实体/回答质量的唯一稳定 ID 发布件，随 AgentVersion 冻结
category: analysis
---

# TrueAsk 分析定义（trueask-taxonomy-v4）

本 Skill 是本版本唯一有效的状态、场景、实体和回答质量定义。analysis_status、scenario_id、
type_id、subtype_id 和 quality_id 只能使用下方发布的稳定 ID；不能可靠判定的候选项不写入结果。
阈值：title ≤ 200 字；summary ≤ 2000 字。

```json
{
  "schema_version": "2.0",
  "taxonomy_version": "trueask-taxonomy-v4",
  "name": "TrueAsk 家电服务对话分析语义体系",
  "description": "面向家电售前、使用与售后服务对话的范围判断、场景切分、层级实体抽取和客服回答质量判断规则。该 taxonomy 随 Analyzer 的 AgentVersion 冻结，是 TrueAsk 分析业务语义的唯一权威。",
  "thresholds": {
    "title_max_chars": 200,
    "summary_max_chars": 2000
  },
  "analysis_statuses": [
    {
      "id": "in-scope",
      "name": "业务范围内",
      "description": "对话中的实质用户诉求全部属于已发布的 TrueAsk 家电业务场景。"
    },
    {
      "id": "partially-in-scope",
      "name": "部分在业务范围内",
      "description": "对话同时包含可形成业务片段的诉求和明确的非业务内容。"
    },
    {
      "id": "out-of-scope",
      "name": "业务范围外",
      "description": "对话只有明确但不属于已发布家电业务场景的诉求。"
    },
    {
      "id": "insufficient-content",
      "name": "内容不足",
      "description": "对话只有空消息、寒暄、语气词或其他不足以形成业务意图的内容。"
    }
  ],
  "scenarios": [
    {
      "id": "fault-consultation",
      "name": "故障咨询",
      "description": "咨询异常现象、错误码、故障原因或用户可执行的排查方法；明确要求创建报修或预约服务时不归入此类。"
    },
    {
      "id": "repair-and-appointment",
      "name": "报修与预约",
      "description": "请求报修、上门、安装预约、改期、取消或提交具体服务申请。"
    },
    {
      "id": "human-handoff",
      "name": "转人工",
      "description": "明确要求人工客服、客服电话、投诉渠道或人工处理。"
    },
    {
      "id": "service-progress-and-logistics",
      "name": "服务进度与物流",
      "description": "查询已有工单、服务进度、配件到货、寄送、物流或处理状态。"
    },
    {
      "id": "installation-consultation",
      "name": "安装咨询",
      "description": "咨询安装条件、现场要求、接口、开孔、安装方法或安装过程中遇到的问题；实际预约安装服务不归入此类。"
    },
    {
      "id": "policy-and-invoice-consultation",
      "name": "政策发票等咨询",
      "description": "咨询保修、三包、延保、退换、发票、电子凭证、当前渠道支持的家电或维修服务范围及相关政策。"
    },
    {
      "id": "product-consultation",
      "name": "产品咨询",
      "description": "咨询单个产品的概况、参数、功能、技术原理、卖点，或进行品牌与竞品层面的宽泛咨询。"
    },
    {
      "id": "price-and-store-consultation",
      "name": "价格/门店咨询",
      "description": "咨询价格、补贴、促销、赠品、门店地址、联系方式或样机。"
    },
    {
      "id": "purchase-recommendation",
      "name": "选购推荐",
      "description": "根据预算、空间、人数、用途或偏好，请求推荐合适产品。"
    },
    {
      "id": "model-comparison",
      "name": "型号对比",
      "description": "对两个及以上具体型号、SKU 或明确产品选项进行比较和取舍。"
    },
    {
      "id": "usage-guidance",
      "name": "使用指导",
      "description": "咨询正常使用方法、首次设置、程序切换、调节方法、效果优化和使用技巧。"
    },
    {
      "id": "accessory-and-consumable",
      "name": "配件/耗材咨询",
      "description": "咨询部件、配件或耗材的选择、购买、更换和适配。"
    },
    {
      "id": "routine-maintenance",
      "name": "日常维护保养",
      "description": "咨询清洁、除垢、保养周期、滤网清理和日常维护方法。"
    }
  ],
  "entity_types": [
    {
      "id": "product-identity",
      "name": "产品身份",
      "description": "产品的家电品类、系列、套系、型号或 SKU。",
      "subtypes": [
        {
          "id": "appliance-category",
          "name": "家电品类",
          "description": "用户明确咨询或服务的家电对象，值必须使用发布的标准品类。",
          "allowed_values": ["冰箱", "洗衣机", "干衣机", "洗干一体机", "洗碗机", "蒸箱", "烤箱", "蒸烤箱", "烟机", "灶具", "嵌饮机", "消毒柜", "咖啡机", "料理机", "暖碟抽屉", "生活电器", "多功能烹饪机", "微波炉", "其他"]
        },
        {
          "id": "series",
          "name": "产品系列/套系",
          "description": "产品所属系列、套系或平台名称，例如 iQ500、2系。"
        },
        {
          "id": "model",
          "name": "型号/SKU",
          "description": "能够指向具体产品的机器型号、E-Nr、产品编码或 SKU。"
        }
      ]
    },
    {
      "id": "brand-and-competition",
      "name": "品牌与竞品",
      "description": "对话中明确出现的本品牌、普通品牌或竞品品牌。",
      "subtypes": [
        {
          "id": "brand",
          "name": "品牌",
          "description": "品牌正式名称、简称或别名；无法可靠判断竞品身份时使用此类型。"
        },
        {
          "id": "competitor-brand",
          "name": "竞品品牌",
          "description": "原文明确称为竞品、竞争品牌或对比对象的品牌；不得仅根据外部品牌名单推断。"
        }
      ]
    },
    {
      "id": "product-attribute",
      "name": "参数、功能与卖点",
      "description": "产品颜色、容量、尺寸、能耗、功能、程序、模式、参数或卖点。",
      "subtypes": [
        {
          "id": "color",
          "name": "颜色",
          "description": "产品机身配色、表面材质色或颜色偏好。"
        },
        {
          "id": "capacity",
          "name": "容量",
          "description": "洗涤、烘干、容积等容量规格，保留数值和单位。"
        },
        {
          "id": "dimensions",
          "name": "尺寸",
          "description": "产品外形尺寸或产品自身尺寸参数，保留数值和单位。"
        },
        {
          "id": "energy-consumption",
          "name": "能耗/能效",
          "description": "能效等级、耗电量、耗水量或其他能源消耗参数。"
        },
        {
          "id": "feature-or-mode",
          "name": "功能/程序/模式",
          "description": "烘干、除菌、速冻等功能、程序、模式或技术点。"
        },
        {
          "id": "selling-point",
          "name": "产品卖点",
          "description": "静音、节能、高效等明确表达的产品优势或效果卖点。"
        },
        {
          "id": "other-parameter",
          "name": "其他参数",
          "description": "不属于颜色、容量、尺寸或能耗的其他明确产品参数。"
        }
      ]
    },
    {
      "id": "part-accessory-consumable",
      "name": "部件、配件与耗材",
      "description": "设备组成部件、可更换配件和使用中消耗或定期更换的耗材。",
      "subtypes": [
        {
          "id": "component",
          "name": "部件",
          "description": "排水泵、密封条等设备组成部件。"
        },
        {
          "id": "accessory",
          "name": "配件",
          "description": "进水管、置物架等可选或可更换配件。"
        },
        {
          "id": "consumable",
          "name": "耗材",
          "description": "洗碗盐、光亮剂、滤芯等使用中消耗或定期购买更换的物品。"
        }
      ]
    },
    {
      "id": "fault-signal",
      "name": "故障症状与错误码",
      "description": "设备异常表现、故障症状、自检码、报警码或错误代码。",
      "subtypes": [
        {
          "id": "symptom",
          "name": "故障症状/异常现象",
          "description": "漏水、不制冷、异响等用户明确描述的异常表现。"
        },
        {
          "id": "fault-code",
          "name": "错误码/报警码",
          "description": "设备显示的自检码、报警码或错误代码。"
        }
      ]
    },
    {
      "id": "service-and-support",
      "name": "服务与支持",
      "description": "安装环境、参考资料、报修维修、安装服务、物流和工单状态。预约动作及其日期时段不作为实体。",
      "subtypes": [
        {
          "id": "installation-condition",
          "name": "安装条件",
          "description": "橱柜空间、安装位置、开孔、接口等现场条件。"
        },
        {
          "id": "environment-parameter",
          "name": "环境参数",
          "description": "水压、水硬度、电压等带数值或等级的环境参数。"
        },
        {
          "id": "reference-material",
          "name": "参考资料",
          "description": "说明书、安装指南、图示、视频或其他明确提及的资料。"
        },
        {
          "id": "repair",
          "name": "报修/维修事项",
          "description": "原文明确出现的报修、维修或修理事项。"
        },
        {
          "id": "installation-service",
          "name": "安装服务",
          "description": "原文明确出现的上门安装或安装服务。"
        },
        {
          "id": "logistics",
          "name": "服务或配件物流",
          "description": "配件到货、寄送、配送或其他服务物流事项。"
        },
        {
          "id": "work-order-status",
          "name": "工单状态",
          "description": "已受理、处理中、已完结等明确的工单处理状态。"
        }
      ]
    },
    {
      "id": "marketing-factor",
      "name": "营销要素",
      "description": "价格、补贴、促销、发票和以旧换新等营销或交易要素。",
      "subtypes": [
        {
          "id": "price",
          "name": "价格",
          "description": "商品价格、到手价或其他明确价格表达。"
        },
        {
          "id": "subsidy",
          "name": "补贴",
          "description": "国补、政府补贴或其他明确补贴。"
        },
        {
          "id": "promotion",
          "name": "促销",
          "description": "优惠券、活动名称、满减条件、赠品或促销规则。"
        },
        {
          "id": "invoice",
          "name": "发票",
          "description": "电子发票、补开发票、抬头或其他发票事项。"
        },
        {
          "id": "trade-in",
          "name": "以旧换新",
          "description": "以旧换新、旧机回收或相关置换要素。"
        }
      ]
    }
  ],
  "response_quality_values": [
    {
      "id": "useful-basic",
      "name": "有用_基础回应",
      "category": "useful",
      "useful": true,
      "description": "回答正确、相关并提供了足以解决或推进当前需求的基础信息。"
    },
    {
      "id": "useful-high-quality",
      "name": "有用_高质量回应",
      "category": "useful",
      "useful": true,
      "description": "在正确回应基础上提供完整步骤、关键边界、风险提示或恰当的图文/资料支持。"
    },
    {
      "id": "useless-off-topic",
      "name": "无用_答非所问",
      "category": "useless",
      "useful": false,
      "description": "回应偏离用户当前问题，未提供相关答案或有效推进。"
    },
    {
      "id": "useless-wrong-or-harmful",
      "name": "无用_错误/有害",
      "category": "useless",
      "useful": false,
      "description": "回应包含事实错误、不安全操作、误导性承诺或其他可能造成伤害的内容。"
    },
    {
      "id": "useless-system-error",
      "name": "无用_系统异常",
      "category": "useless",
      "useful": false,
      "description": "因系统错误、空响应、异常中断或工具故障而未形成有效回应。"
    },
    {
      "id": "useless-unresolved",
      "name": "无用_无法解决",
      "category": "useless",
      "useful": false,
      "description": "仅表示无法处理或没有答案，且未提供合理的后续路径。"
    },
    {
      "id": "guidance-channel-handoff",
      "name": "引导_其他渠道转接",
      "category": "guidance",
      "useful": true,
      "description": "当前问题需要人工、售后或其他渠道处理，并给出了明确、合理的转接路径。"
    },
    {
      "id": "guidance-clarification",
      "name": "引导_需求澄清",
      "category": "guidance",
      "useful": true,
      "description": "现有信息不足以可靠回答，回应提出了必要且具体的澄清问题。"
    }
  ]
}
```
