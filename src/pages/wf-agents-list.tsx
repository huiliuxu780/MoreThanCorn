/** Agents 列表 — quickservice 复刻版（16 §8）。真 API（server/:8100）。
 *  R-Archive（SDD 10）：旧三类 Agent 已只读封存——创建/复制/归档/删除入口移除，
 *  仅保留历史查看；列表徽标文案改为「已封存」。 */
import { useCallback, useEffect, useState } from "react"
import { useListQuery } from "@/hooks/use-list-query"
import { Pagination } from "@/components/app/pagination"
import { pagedApi } from "@/services/wf-api"
import { useNavigate } from "react-router-dom"
import { MoreHorizontal, Search } from "lucide-react"

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export const AVATARS = Array.from({ length: 20 }, (_, i) => `/avatars/avatar-${i}.png`)

/** 头像回落：按 id 哈希稳定取图，保证列表/详情一致。 */
export function avatarFor(id: string, avatar?: string | null) {
  return avatar ?? AVATARS[id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % AVATARS.length]
}

const INK2 = "#5A6472"
const INK3 = "#B9C2CF"
const ORANGE = "#F97E2B"

interface AgentRow {
  id: string; name: string; type: string; typeLabel: string; status: string; updatedAt: string; description?: string; avatar?: string | null;
  archived?: boolean;
  latestVersion?: number | null; sandboxVersion?: number | null; prodVersion?: number | null
}

export default function WfAgentsListPage() {
  const navigate = useNavigate()
  const { params, update } = useListQuery(12)
  const search = params.search ?? ""
  const [rows, setRows] = useState<AgentRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  // 筛选接真：排序 + 类型过滤 + 封存过滤（历史查看入口）
  const [sort, setSort] = useState<"updated" | "name">("updated")
  const [typeFilter, setTypeFilter] = useState("all")
  const [archivedFilter, setArchivedFilter] = useState<"" | "true">("")

  const load = useCallback(() => {
    setLoading(true)
    pagedApi.agents({ page: params.page, pageSize: params.pageSize, search, archived: archivedFilter || undefined }).then((r) => {
      setRows(r.items as AgentRow[]); setTotal(r.total); setLoading(false)
    }).catch(() => setLoading(false))
  }, [params.page, params.pageSize, search, archivedFilter])
  useEffect(() => { load() }, [load])

  const filtered = rows
    .filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase()))
    .filter((r) => typeFilter === "all" || r.type === typeFilter)
    .sort((a, b) => (sort === "name"
      ? a.name.localeCompare(b.name, "zh-CN")
      : (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")))

  return (
    <div className="space-y-5 p-6" style={{ background: "#F5F6FA", minHeight: "100%" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-4">
          <h1 className="text-lg font-semibold" style={{ color: "#1F2329" }}>我的Agent</h1>
          <span className="text-sm" style={{ color: INK2 }}>旧版 Agent 已封存，仅支持历史查询</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-2 size-4" style={{ color: INK3 }} />
            <Input className="h-8 w-40 rounded-md bg-white pl-7" placeholder="搜索" value={search} onChange={(e) => update({ search: e.target.value || undefined }, true)} />
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as "updated" | "name")}>
            <SelectTrigger className="h-8 w-32 bg-white text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="updated">按更新时间</SelectItem>
              <SelectItem value="name">按名称</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-8 w-32 bg-white text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              <SelectItem value="autonomous">自主规划</SelectItem>
              <SelectItem value="dialogue">对话编排</SelectItem>
              <SelectItem value="expert-group">专家组</SelectItem>
            </SelectContent>
          </Select>
          <Select value={archivedFilter || "active"} onValueChange={(v) => setArchivedFilter(v === "archived" ? "true" : "")}>
            <SelectTrigger className="h-8 w-32 bg-white text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">使用中</SelectItem>
              <SelectItem value="archived">已封存</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>


      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((w) => (
          <div
            key={w.id}
            role="button"
            tabIndex={0}
            className="group flex flex-col rounded-xl border bg-white p-5 text-left shadow-sm transition-shadow hover:shadow-md"
            style={{ borderColor: "#EDF0F4" }}
            onClick={() => navigate(`/config/agents/${w.id}`)}
          >
            <div className="flex items-start gap-3">
              <img src={avatarFor(w.id, w.avatar)} alt={w.name} className="size-14 shrink-0 rounded-lg object-cover" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <div className="truncate text-[15px] font-semibold" style={{ color: "#1F2329" }}>{w.name}</div>
                  <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600">已封存</span>
                </div>
                <span className="mt-1 inline-block rounded bg-neutral-100 px-1.5 py-0.5 text-[11px]" style={{ color: INK2 }}>{w.typeLabel}</span>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="rounded p-1 opacity-0 transition-opacity hover:bg-neutral-100 group-hover:opacity-100"
                    onClick={(e) => e.stopPropagation()}
                  ><MoreHorizontal className="size-3.5 text-neutral-400" /></button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem onClick={() => navigate(`/config/agents/${w.id}`)}>查看详情</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <p className="line-clamp-2 pt-3 text-xs leading-5" style={{ color: INK2 }}>{w.description || "\u00A0"}</p>
            <div className="mt-auto flex items-center justify-between pt-4 text-[11px]">
              <span style={{ color: INK3 }}>更新时间： {new Date(w.updatedAt).toLocaleDateString("zh-CN")}</span>
              <span className="flex items-center gap-1">
                {/* 版本显示（SDD B）：最新版本 + 各环境生效版本 */}
                <span className="rounded border px-1.5 py-0.5" style={{ borderColor: "#EDF0F4", color: INK2 }}>
                  {w.latestVersion ? `最新 V${w.latestVersion}` : "无版本"}
                </span>
                {w.sandboxVersion != null && (
                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-600">沙箱 V{w.sandboxVersion}</span>
                )}
                {w.prodVersion != null && (
                  <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-600">线上 V{w.prodVersion}</span>
                )}
                <span className="rounded px-1.5 py-0.5" style={w.status === "published" ? { background: "#F5F6FA", color: INK3 } : { background: "#FFF4EA", color: ORANGE }}>
                  {w.status === "published" ? "已发布" : "未发布"}
                </span>
              </span>
            </div>
          </div>
        ))}
      </div>
      {!loading && filtered.length === 0 && (
        <div className="py-20 text-center text-sm" style={{ color: INK3 }}>暂无历史 Agent；旧三类 Agent 已封存，仅支持历史查询</div>
      )}
      <Pagination page={params.page ?? 1} pageSize={params.pageSize ?? 12} total={total}
        pageSizeOptions={[12, 24, 48]} onPageChange={(pg) => update({ page: pg })} onPageSizeChange={(n) => update({ pageSize: n }, true)} />
    </div>
  )
}
