import { SlidersHorizontal } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { FormField } from "@/components/app/form-field"
import { BRANDS, DEPARTMENTS, ISSUES, PRODUCT_CATEGORIES, REQUEST_TYPES, SERVICE_TYPES, TEAMS } from "@/mocks/catalog"
import type { FilterMap } from "@/lib/list-filters"

export interface GlobalFilterValue {
  time?: string
  department?: string
  team?: string
  serviceType?: string
  agent?: string
  brand?: string
  productCategory?: string
  issue?: string
  requestType?: string
}

/**
 * 整页共用一套筛选（Design Spec §9.4）：
 * 默认直接显示 时间 / Department / Team / Service Type，其余进入更多筛选 Sheet。
 */
export function GlobalFilters({
  value,
  onChange,
}: {
  value: FilterMap
  onChange: (next: FilterMap) => void
}) {
  const [moreOpen, setMoreOpen] = useState(false)
  const [draft, setDraft] = useState<GlobalFilterValue>({})

  const openMore = () => {
    setDraft({
      agent: value.agent,
      brand: value.brand,
      productCategory: value.productCategory,
      issue: value.issue,
      requestType: value.requestType,
    })
    setMoreOpen(true)
  }

  const set = (key: string, v: string) => {
    const next = { ...value }
    if (!v || v === "__all__") delete next[key]
    else next[key] = v
    onChange(next)
  }

  const moreCount = ["agent", "brand", "productCategory", "issue", "requestType"].filter(
    (k) => value[k],
  ).length

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2.5">
      <Select value={value.time ?? "近7日"} onValueChange={(v) => set("time", v === "近7日" ? "__all__" : v)}>
        <SelectTrigger className="h-8 w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="近7日">近 7 日</SelectItem>
          <SelectItem value="近30日">近 30 日</SelectItem>
          <SelectItem value="今日">今日</SelectItem>
        </SelectContent>
      </Select>
      <Select value={value.department ?? "__all__"} onValueChange={(v) => set("department", v)}>
        <SelectTrigger className="h-8 w-32">
          <SelectValue placeholder="全部部门" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">全部部门</SelectItem>
          {DEPARTMENTS.map((d) => (
            <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={value.team ?? "__all__"} onValueChange={(v) => set("team", v)}>
        <SelectTrigger className="h-8 w-36">
          <SelectValue placeholder="全部班组" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">全部班组</SelectItem>
          {TEAMS.map((t) => (
            <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={value.serviceType ?? "__all__"} onValueChange={(v) => set("serviceType", v)}>
        <SelectTrigger className="h-8 w-32">
          <SelectValue placeholder="全部服务类型" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">全部服务类型</SelectItem>
          {SERVICE_TYPES.map((s) => (
            <SelectItem key={s} value={s}>{s}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" className="h-8" onClick={openMore}>
        <SlidersHorizontal className="size-3.5" />
        更多筛选
        {moreCount > 0 ? <span className="ml-1 rounded-full bg-muted px-1.5 text-xs">{moreCount}</span> : null}
      </Button>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent className="w-[380px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>更多筛选</SheetTitle>
            <SheetDescription>整页共用一套筛选条件</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            <FormField label="坐席">
              <Select value={draft.agent ?? "__all__"} onValueChange={(v) => setDraft((d) => ({ ...d, agent: v === "__all__" ? undefined : v }))}>
                <SelectTrigger className="w-full"><SelectValue placeholder="全部坐席" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部坐席</SelectItem>
                  {["张三", "李四", "王五", "赵敏", "孙倩", "周凯", "吴婷", "郑浩", "陈静", "刘洋"].map((n) => (
                    <SelectItem key={n} value={n}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Brand">
              <Select value={draft.brand ?? "__all__"} onValueChange={(v) => setDraft((d) => ({ ...d, brand: v === "__all__" ? undefined : v }))}>
                <SelectTrigger className="w-full"><SelectValue placeholder="全部品牌" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部品牌</SelectItem>
                  {BRANDS.map((b) => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Product Category">
              <Select value={draft.productCategory ?? "__all__"} onValueChange={(v) => setDraft((d) => ({ ...d, productCategory: v === "__all__" ? undefined : v }))}>
                <SelectTrigger className="w-full"><SelectValue placeholder="全部品类" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部品类</SelectItem>
                  {PRODUCT_CATEGORIES.map((b) => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Issue / Topic">
              <Select value={draft.issue ?? "__all__"} onValueChange={(v) => setDraft((d) => ({ ...d, issue: v === "__all__" ? undefined : v }))}>
                <SelectTrigger className="w-full"><SelectValue placeholder="全部问题" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部问题</SelectItem>
                  {ISSUES.map((b) => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Request Type">
              <Select value={draft.requestType ?? "__all__"} onValueChange={(v) => setDraft((d) => ({ ...d, requestType: v === "__all__" ? undefined : v }))}>
                <SelectTrigger className="w-full"><SelectValue placeholder="全部诉求类型" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部诉求类型</SelectItem>
                  {REQUEST_TYPES.map((b) => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <SheetFooter className="mt-6">
            <Button
              variant="outline"
              onClick={() => {
                setDraft({})
                const next = { ...value }
                for (const k of ["agent", "brand", "productCategory", "issue", "requestType"]) delete next[k]
                onChange(next)
              }}
            >
              重置
            </Button>
            <Button
              onClick={() => {
                const next = { ...value }
                for (const k of ["agent", "brand", "productCategory", "issue", "requestType"] as const) {
                  if (draft[k]) next[k] = draft[k]!
                  else delete next[k]
                }
                onChange(next)
                setMoreOpen(false)
              }}
            >
              应用
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
