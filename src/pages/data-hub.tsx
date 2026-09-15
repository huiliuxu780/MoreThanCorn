/** 09-15 合并案（IA 原则 ia-evidence-principle.md）：能力与资源→「数据」页。
 *
 * 三 tab = 同一批数据对象的三个镜头：
 * ① 接入健康（默认，P2 跨源事件管线聚合：概览带+源表+向导入口）
 * ② 数据资产（库存：挂载表/对象+被消费计数）
 * ③ 事件流水（P2 跨源投递/重试/死信证据）
 * 老 /data-sources* 全重定向到此；顶部导航无独立「数据接入」条目（IA 唯一归属）。
 */
import { useSearchParams } from "react-router-dom"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EventsSection, IngressSection } from "@/pages/data-sources"
import { AssetsSection } from "@/pages/res-category-pages"

const TABS = [
  { key: "ingress", label: "接入健康" },
  { key: "assets", label: "数据资产" },
  { key: "events", label: "事件流水" },
] as const

export default function DataHubPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get("tab") ?? "ingress"
  const tab = (TABS.some((t) => t.key === raw) ? raw : "ingress") as typeof TABS[number]["key"]
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <header>
        <h1 className="text-xl font-semibold">数据</h1>
        <p className="text-sm text-muted-foreground">
          同一批数据对象的三个镜头：接入健康（流动）/ 数据资产（库存）/ 事件流水（证据）；
          凭据根在 设置→连接，本页不存凭据。
        </p>
      </header>
      <Tabs value={tab} onValueChange={(v) => setSearchParams((p) => {
        const n = new URLSearchParams(p)
        if (v === "ingress") n.delete("tab"); else n.set("tab", v)
        return n
      }, { replace: true })}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="ingress" className="flex flex-col gap-4">
          <IngressSection />
        </TabsContent>
        <TabsContent value="assets" className="flex flex-col gap-4">
          <AssetsSection />
        </TabsContent>
        <TabsContent value="events" className="flex flex-col gap-4">
          <EventsSection />
        </TabsContent>
      </Tabs>
    </div>
  )
}
