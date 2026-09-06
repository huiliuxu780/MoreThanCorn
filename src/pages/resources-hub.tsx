import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import {
  Boxes, Cpu, Database, GitBranch, Plug, Scale,
} from "lucide-react"
import { PageContainer, PageHeader } from "@/components/app/page"
import { bizApi, formsApi, pagedApi, wfApi } from "@/services/wf-api"
import { resApi } from "@/services/resource-api"

/** MTC-006：能力与资源 Hub = 真实分类入口 + 真实计数 + 消费规模。 */
interface Counts {
  models: number | null
  providers: number | null
  tools: number | null
  datasources: number | null
  definitions: number | null
  connections: number | null
  rules: number | null
  forms: number | null
  agents: number | null
  tasks: number | null
  workflows: number | null
}

const EMPTY: Counts = {
  models: null, providers: null, tools: null, datasources: null, definitions: null,
  connections: null, rules: null, forms: null, agents: null, tasks: null, workflows: null,
}

const n = (v: number | null) => (v == null ? "—" : String(v))

export default function ResourcesHubPage() {
  const [c, setC] = useState<Counts>(EMPTY)
  useEffect(() => {
    const safe = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null)
    void Promise.all([
      safe(pagedApi.models({ page: 1, pageSize: 1 })),
      safe(pagedApi.providers({ page: 1, pageSize: 1 })),
      safe(pagedApi.tools({ page: 1, pageSize: 1 })),
      safe(resApi.list("datasource", { page: 1, pageSize: 1 })),
      safe(resApi.list("definition", { page: 1, pageSize: 1 })),
      safe(pagedApi.connections({ page: 1, pageSize: 1 })),
      safe(bizApi.rules()),
      safe(formsApi.list()),
      safe(pagedApi.agents({ page: 1, pageSize: 1 })),
      safe(bizApi.tasks()),
      safe(wfApi.list({ page: 1, pageSize: 1 })),
    ]).then(([m, p, t, ds, df, cn, rules, forms, agents, tasks, wfs]) => {
      setC({
        models: m?.total ?? null,
        providers: p?.total ?? null,
        tools: t?.total ?? null,
        datasources: ds?.total ?? null,
        definitions: df?.total ?? null,
        connections: cn?.total ?? null,
        rules: rules?.length ?? null,
        forms: forms?.items?.length ?? null,
        agents: agents?.total ?? null,
        tasks: tasks?.length ?? null,
        workflows: wfs?.total ?? null,
      })
    })
  }, [])

  const tiles = [
    {
      to: "/resources/ai", icon: Cpu, title: "AI 资源",
      desc: "模型 / Provider / Tool",
      count: `模型 ${n(c.models)} · Provider ${n(c.providers)} · Tool ${n(c.tools)}`,
      refs: `消费规模：${n(c.agents)} 个 Agent`,
    },
    {
      to: "/resources/data", icon: Database, title: "数据资源",
      desc: "Data Resource / Data Asset / Data Definition",
      count: `Datasource ${n(c.datasources)} · Definition ${n(c.definitions)}`,
      refs: `消费规模：${n(c.tasks)} 个自主任务`,
    },
    {
      to: "/resources/connections", icon: Plug, title: "连接",
      desc: "外部系统连接与凭据（Secret 永不展示）",
      count: `Connection ${n(c.connections)}`,
      refs: "被 Tool / 数据源引用",
    },
    {
      to: "/resources/rules", icon: Scale, title: "结果规则",
      desc: "质量结果判定规则集与版本",
      count: `RuleSet ${n(c.rules)}`,
      refs: `消费规模：${n(c.tasks)} 个自主任务`,
    },
    {
      to: "/resources/forms", icon: Boxes, title: "Workflow 输入表单",
      desc: "Workflow 输入契约表单",
      count: `Form ${n(c.forms)}`,
      refs: `消费规模：${n(c.workflows)} 个 Workflow`,
    },
    {
      to: "/workflows", icon: GitBranch, title: "Workflow",
      desc: "可视化、可配置、可观测的执行流程",
      count: `Workflow ${n(c.workflows)}`,
      refs: `被 ${n(c.tasks)} 个自主任务引用`,
    },
  ]

  return (
    <PageContainer wide className="space-y-4">
      <PageHeader
        title="能力与资源"
        description="Agent / Workflow / 自主任务可复用的基础设施"
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {tiles.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="space-y-2 rounded-lg border bg-surface p-4 shadow-sm transition-colors hover:border-brand/50 hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <div className="flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-md border bg-surface-muted text-muted-foreground">
                <t.icon className="size-4" />
              </span>
              <span className="text-sm font-semibold">{t.title}</span>
            </div>
            <div className="text-xs text-muted-foreground">{t.desc}</div>
            <div className="text-xs tabular-nums">{t.count}</div>
            <div className="text-[11px] text-muted-foreground">{t.refs}</div>
          </Link>
        ))}
      </div>
    </PageContainer>
  )
}
