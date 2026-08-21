import { ArrowLeft, FlaskConical, History, Plus, Upload } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
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
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { DefinitionRow, FormField } from "@/components/app/form-field"
import { PageContainer, PageHeader, SectionHeader } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status-badge"
import { StatusIcon } from "@/components/app/status-indicator"
import { useAsyncData } from "@/hooks/use-async-data"
import { formatDateTime } from "@/lib/time"
import { getTool } from "@/services/mock-service"
import { connections } from "@/mocks/data"
import type { ToolContractField } from "@/domain/types"
import { rbac } from "@/services/rbac"

export default function ToolEditorPage() {
  const { toolId } = useParams()
  const isCreate = !toolId || toolId === "new"
  const navigate = useNavigate()
  const { data: tool } = useAsyncData(() => (isCreate ? Promise.resolve(null) : getTool(toolId!)), [toolId])

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [capability, setCapability] = useState<"READ" | "WRITE" | "ACTION">("READ")
  const [connectionId, setConnectionId] = useState("")
  const [method, setMethod] = useState<"GET" | "POST" | "PUT" | "DELETE">("GET")
  const [path, setPath] = useState("")
  const [body, setBody] = useState("")
  const [requiresApproval, setRequiresApproval] = useState(false)
  const [inputContract, setInputContract] = useState<ToolContractField[]>([])
  const [outputContract, setOutputContract] = useState<{ name: string; type: string; description?: string }[]>([])
  const [testOpen, setTestOpen] = useState(false)
  const [testStatus, setTestStatus] = useState<"idle" | "running" | "success" | "failed">("idle")
  const [testResponse, setTestResponse] = useState("")
  const [publishOpen, setPublishOpen] = useState(false)
  const [versionNote, setVersionNote] = useState("")
  const [historyOpen, setHistoryOpen] = useState(false)
  const [loadedFor, setLoadedFor] = useState("")

  useEffect(() => {
    if (!tool || loadedFor === tool.id) return
    setLoadedFor(tool.id)
    setName(tool.name)
    setDescription(tool.description)
    setCapability(tool.capability)
    setConnectionId(tool.connectionId ?? "")
    setMethod(tool.http.method)
    setPath(tool.http.path)
    setBody(tool.http.body ?? "")
    setRequiresApproval(tool.requiresApproval)
    setInputContract(tool.inputContract)
    setOutputContract(tool.outputContract)
  }, [tool, loadedFor])

  const readOnly = !isCreate && tool?.source === "Built-in"
  const canManage = rbac.can("tool.manage")

  const runTest = () => {
    setTestStatus("running")
    setTimeout(() => {
      const ok = path.trim().length > 0 && connectionId !== ""
      setTestStatus(ok ? "success" : "failed")
      setTestResponse(
        ok
          ? JSON.stringify([{ request_id: "SR20260818-1032", status: "待派单", created_at: "2026-08-18 10:44", overdue: false }], null, 2)
          : "Connection 未选择或 Path 为空：Authentication failed",
      )
    }, 900)
  }

  const publishChecks = [
    { label: "配置完整（名称 / Connection / Method / Path）", ok: name.trim() !== "" && connectionId !== "" && path.trim() !== "" },
    { label: "Connection 可用", ok: connections.find((c) => c.id === connectionId)?.status === "Connected" },
    { label: "Test 成功", ok: testStatus === "success" || (tool?.lastTestPassed ?? false) },
    { label: "Input Schema 有效", ok: inputContract.length > 0 },
    { label: "Output Schema 有效", ok: outputContract.length > 0 },
  ]
  const publishOk = publishChecks.every((c) => c.ok)

  return (
    <PageContainer className="max-w-4xl space-y-5">
      <div>
        <Button variant="ghost" size="sm" className="gap-1 px-2" onClick={() => navigate("/config/tools")}>
          <ArrowLeft className="size-4" /> Tools
        </Button>
        <PageHeader
          className="mt-2"
          title={isCreate ? "创建 API Tool" : name || tool?.name || ""}
          status={
            !isCreate && tool ? (
              <>
                <StatusBadge status={tool.governance} />
                <Badge variant="outline">{tool.currentVersion} · {tool.versionStatus}</Badge>
              </>
            ) : null
          }
          description="单页编辑器：基本信息 / 请求 / Contract / 治理 / Test"
          actions={
            <>
              {!isCreate ? (
                <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
                  <History className="size-3.5" /> Version History
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => { setTestStatus("idle"); setTestOpen(true) }}>
                <FlaskConical className="size-3.5" /> Test
              </Button>
              {canManage && !readOnly ? (
                <Button size="sm" onClick={() => setPublishOpen(true)}>
                  <Upload className="size-3.5" /> Publish
                </Button>
              ) : null}
            </>
          }
        />
      </div>

      <fieldset disabled={readOnly || !canManage} className="space-y-5">
        <section className="space-y-3 rounded-lg border bg-card p-4">
          <SectionHeader title="基本信息" />
          <div className="grid grid-cols-2 gap-4">
            <FormField label="名称" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：查询服务请求" />
            </FormField>
            <FormField label="Capability">
              <Select value={capability} onValueChange={(v) => setCapability(v as typeof capability)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="READ">READ</SelectItem>
                  <SelectItem value="WRITE">WRITE</SelectItem>
                  <SelectItem value="ACTION">ACTION</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <FormField label="描述">
            <Textarea value={description} className="min-h-16" onChange={(e) => setDescription(e.target.value)} />
          </FormField>
        </section>

        <section className="space-y-3 rounded-lg border bg-card p-4">
          <SectionHeader title="请求" description="Tool 只引用已有 Connection，不重复维护 Credential / Secret" />
          <div className="grid grid-cols-3 gap-4">
            <FormField label="Connection" required>
              <Select value={connectionId || undefined} onValueChange={setConnectionId}>
                <SelectTrigger><SelectValue placeholder="选择 Connection" /></SelectTrigger>
                <SelectContent>
                  {connections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="HTTP Method">
              <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="GET">GET</SelectItem>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="PUT">PUT</SelectItem>
                  <SelectItem value="DELETE">DELETE</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Path" required>
              <Input className="font-mono text-xs" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/api/v1/..." />
            </FormField>
          </div>
          {method !== "GET" ? (
            <FormField label="Body">
              <Textarea className="min-h-20 font-mono text-xs" value={body} onChange={(e) => setBody(e.target.value)} />
            </FormField>
          ) : null}
        </section>

        <section className="space-y-3 rounded-lg border bg-card p-4">
          <SectionHeader
            title="Input Contract / Request Mapping"
            description="Agent-facing Input Contract → Request Mapping，不维护双份定义"
            actions={
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setInputContract((c) => [
                    ...c,
                    { name: `field_${c.length + 1}`, type: "String", required: false, location: "Query", requestKey: `field_${c.length + 1}` },
                  ])
                }
              >
                <Plus className="size-3.5" /> 添加字段
              </Button>
            }
          />
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Request Key</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inputContract.map((field, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-mono text-xs">{field.name}</TableCell>
                    <TableCell className="text-xs">{field.type}</TableCell>
                    <TableCell>
                      <Switch
                        checked={field.required}
                        onCheckedChange={(v) => setInputContract((c) => c.map((f, i) => (i === idx ? { ...f, required: v } : f)))}
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={field.location}
                        onValueChange={(v) => setInputContract((c) => c.map((f, i) => (i === idx ? { ...f, location: v as ToolContractField["location"] } : f)))}
                      >
                        <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Path">Path</SelectItem>
                          <SelectItem value="Query">Query</SelectItem>
                          <SelectItem value="Header">Header</SelectItem>
                          <SelectItem value="Body">Body</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{field.requestKey}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <SectionHeader
            title="Output Contract"
            actions={
              <Button
                variant="outline"
                size="sm"
                disabled={testStatus !== "success" && testResponse === ""}
                onClick={() => {
                  setOutputContract([
                    { name: "request_id", type: "String", description: "服务请求 ID" },
                    { name: "status", type: "String", description: "服务单状态" },
                    { name: "created_at", type: "DateTime", description: "创建时间" },
                    { name: "overdue", type: "Boolean", description: "是否超期" },
                  ])
                  toast.success("已从测试响应生成 Output Schema")
                }}
              >
                从测试响应生成 Output Schema
              </Button>
            }
          />
          {outputContract.length > 0 ? (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outputContract.map((field) => (
                    <TableRow key={field.name}>
                      <TableCell className="font-mono text-xs">{field.name}</TableCell>
                      <TableCell className="text-xs">{field.type}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{field.description}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">先运行 Test，再从真实 Response 生成。</p>
          )}
        </section>

        <section className="space-y-3 rounded-lg border bg-card p-4">
          <SectionHeader title="治理" />
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div className="text-sm">
              <div className="font-medium">Requires Approval</div>
              <div className="text-xs text-muted-foreground">Tool 最低治理要求；Agent 只能保持或提高，不能放松</div>
            </div>
            <Switch checked={requiresApproval} onCheckedChange={setRequiresApproval} />
          </div>
          <DefinitionRow label="Permission">{tool?.permission ?? "Agent Editor 可引用 · Tool Admin 可管理"}</DefinitionRow>
        </section>
      </fieldset>

      {isCreate ? (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate("/config/tools")}>取消</Button>
          <Button disabled={!name.trim()} onClick={() => { toast.success("Draft 已保存"); navigate("/config/tools/TL-01") }}>
            保存 Draft
          </Button>
        </div>
      ) : null}

      {/* Test Sheet */}
      <Sheet open={testOpen} onOpenChange={setTestOpen}>
        <SheetContent className="w-[440px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>测试 Tool</SheetTitle>
            <SheetDescription>Input → Run → Status / Duration / Response · 没有一次成功 Test 的 Draft 不允许 Publish</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            <FormField label="Input（JSON）">
              <Textarea className="min-h-28 font-mono text-xs" defaultValue={'{ "phone_number": "138****2211", "days": 30 }'} />
            </FormField>
            <Button onClick={runTest} disabled={testStatus === "running"}>
              {testStatus === "running" ? "Running..." : "Run"}
            </Button>
            {testStatus !== "idle" ? (
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <StatusIcon tone={testStatus === "success" ? "success" : testStatus === "failed" ? "danger" : "info"} spinning={testStatus === "running"} />
                  {testStatus === "running" ? "Running" : testStatus === "success" ? "Success · 212ms" : "Failed"}
                </div>
                {testResponse ? <pre className="overflow-x-auto rounded-md bg-muted/60 p-3 text-[11px] leading-5">{testResponse}</pre> : null}
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      {/* Publish Dialog */}
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>发布 Tool Version</DialogTitle>
            <DialogDescription>Published Version 永远不可原地修改</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {publishChecks.map((check) => (
              <div key={check.label} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <StatusIcon tone={check.ok ? "success" : "danger"} />
                {check.label}
              </div>
            ))}
            <Textarea placeholder="Version Note（必填）" className="min-h-16 text-xs" value={versionNote} onChange={(e) => setVersionNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishOpen(false)}>取消</Button>
            <Button
              disabled={!publishOk || !versionNote.trim()}
              onClick={() => { setPublishOpen(false); toast.success("Tool 已发布新版本") }}
            >
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version History Sheet */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent className="w-[380px]">
          <SheetHeader>
            <SheetTitle>Version History</SheetTitle>
            <SheetDescription>Published 只读；编辑 Published 将创建下一 Draft Version</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {(tool?.versions ?? []).map((v) => (
              <div key={v.version} className="rounded-md border px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{v.version}</span>
                  <StatusBadge status={v.status} />
                </div>
                {v.versionNote ? <div className="mt-1 text-xs text-muted-foreground">{v.versionNote}</div> : null}
                {v.publishedAt ? <div className="mt-0.5 text-[11px] text-muted-foreground">{formatDateTime(v.publishedAt)}</div> : null}
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </PageContainer>
  )
}
