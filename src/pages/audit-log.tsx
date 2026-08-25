/** 审计日志页（SDD D-4）：发布/回滚/删除/解锁等高危操作留痕（真数据 /api/audit）。 */
import { useEffect, useState } from "react"

import { PageContainer, PageHeader } from "@/components/app/page"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { auditList } from "@/services/wf-api"

interface AuditEntry {
  id: string; actor: string; action: string; targetType: string; targetId: string;
  detail: Record<string, unknown> | null; createdAt: string
}

export default function AuditLogPage() {
  const [items, setItems] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    auditList(200).then((r) => { setItems((r.items ?? []) as unknown as AuditEntry[]); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])
  return (
    <PageContainer className="space-y-4">
      <PageHeader title="审计日志" description="发布、部署、回滚、删除、解锁等高危操作留痕（仅 Admin 可见）" />
      {loading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无审计记录</p>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>操作人</TableHead>
                <TableHead>动作</TableHead>
                <TableHead>对象</TableHead>
                <TableHead>详情</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="whitespace-nowrap text-xs">{a.createdAt.replace("T", " ").slice(0, 19)}</TableCell>
                  <TableCell className="text-xs">{a.actor}</TableCell>
                  <TableCell className="font-mono text-xs">{a.action}</TableCell>
                  <TableCell className="text-xs">{a.targetType}:{a.targetId.slice(0, 8)}</TableCell>
                  <TableCell className="max-w-md truncate font-mono text-xs">{JSON.stringify(a.detail ?? {})}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </PageContainer>
  )
}
