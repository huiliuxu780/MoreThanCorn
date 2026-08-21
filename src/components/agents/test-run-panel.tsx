import { Code, Play } from "lucide-react"
import { useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { FormField } from "@/components/app/form-field"
import { StatusIcon } from "@/components/app/status-indicator"
import type { NodeRunStatus } from "@/components/agents/flow-node"
import type { AgentDetail, AgentNodeDef } from "@/domain/types"
import { cn } from "@/lib/utils"

interface RunEvent {
  nodeId: string
  nodeName: string
  status: NodeRunStatus
  detail?: string
  at: number
}

/**
 * Test Run（Master §28.11 / Design Spec §24）：
 * - 输入来自 Agent Input Schema 自动生成表单；JSON 仅 Advanced。
 * - Pure / READ 直接执行；Sink / Effect Node 强制 Approval Gate。
 * - 不绑定 Data Asset / Task / Data Window。
 */
export function TestRunPanel({
  agent,
  open,
  onOpenChange,
  onNodeStatus,
  onTestComplete,
}: {
  agent: AgentDetail | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onNodeStatus: (nodeId: string, status: NodeRunStatus) => void
  onTestComplete: (success: boolean) => void
}) {
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [jsonMode, setJsonMode] = useState(false)
  const [jsonText, setJsonText] = useState("")
  const [events, setEvents] = useState<RunEvent[]>([])
  const [running, setRunning] = useState(false)
  const [approval, setApproval] = useState<{ node: AgentNodeDef; resolve: (ok: boolean) => void } | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const cancelRef = useRef(false)

  const pushEvent = (node: AgentNodeDef, status: NodeRunStatus, detail?: string) => {
    setEvents((e) => [...e, { nodeId: node.id, nodeName: node.name, status, detail, at: Date.now() }])
    onNodeStatus(node.id, status)
  }

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  const startRun = async () => {
    if (!agent) return
    cancelRef.current = false
    setEvents([])
    setResult(null)
    setRunning(true)
    let success = true

    for (const node of agent.graph.nodes) {
      if (cancelRef.current) {
        success = false
        break
      }
      pushEvent(node, "running")
      await wait(450)
      const needsApproval = node.kind === "create-record" || node.kind === "notification"
      if (needsApproval) {
        pushEvent(node, "waiting-approval", "Sink / Effect Node：Test Run 强制 Approval")
        const ok = await new Promise<boolean>((resolve) => setApproval({ node, resolve }))
        if (!ok) {
          pushEvent(node, "error", "Rejected")
          onNodeStatus(node.id, "error")
          success = false
          break
        }
      }
      pushEvent(node, "success")
    }

    if (success) {
      setResult(
        JSON.stringify(
          {
            quality_result: [
              { section: "诉求识别", criterion: "消费者诉求识别", result: "PASS", confidence: 0.96 },
              { section: "合规", criterion: "违规承诺", result: "PASS", confidence: 0.95 },
            ],
            interaction_labels: { service_type: "维修服务", request_type: "维修申请" },
          },
          null,
          2,
        ),
      )
    }
    setRunning(false)
    onTestComplete(success)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-[460px] flex-col overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Test Run</SheetTitle>
          <SheetDescription>测试对象是当前 Agent Draft 的执行契约本身，不绑定生产 Data Asset / Task</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Test Input</div>
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setJsonMode((m) => !m)}>
              <Code className="size-3.5" /> {jsonMode ? "Schema Form" : "JSON"}
            </Button>
          </div>

          {jsonMode ? (
            <Textarea
              className="min-h-40 font-mono text-xs"
              value={jsonText}
              placeholder='{"interaction_id": "I-TEST-001", ...}'
              onChange={(e) => setJsonText(e.target.value)}
            />
          ) : (
            <div className="space-y-3">
              {(agent?.inputSchema ?? []).map((field) => (
                <FormField key={field.key} label={`${field.key} · ${field.type}`} required={field.required} description={field.description}>
                  <Input
                    className="h-8 text-xs"
                    value={inputs[field.key] ?? ""}
                    placeholder={field.type === "DateTime" ? "2026-08-18 15:30" : field.key === "transcript" ? "消费者反馈..." : ""}
                    onChange={(e) => setInputs((v) => ({ ...v, [field.key]: e.target.value }))}
                  />
                </FormField>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={startRun} disabled={running}>
              <Play className="size-4" /> {running ? "Running..." : "Start Run"}
            </Button>
            {running ? (
              <Button variant="outline" onClick={() => { cancelRef.current = true }}>Stop</Button>
            ) : null}
          </div>

          {events.length > 0 ? (
            <div className="space-y-1.5">
              <div className="text-sm font-medium">Runner</div>
              <div className="space-y-1">
                {events.map((event, idx) => (
                  <div key={idx} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs">
                    <StatusIcon
                      tone={
                        event.status === "success"
                          ? "success"
                          : event.status === "error"
                            ? "danger"
                            : event.status === "waiting-approval"
                              ? "warning"
                              : "info"
                      }
                      spinning={event.status === "running"}
                    />
                    <span className="font-medium">{event.nodeName}</span>
                    <span className="ml-auto text-muted-foreground">
                      {event.status === "running" ? "Running" : event.status === "success" ? "Success" : event.status === "error" ? "Error" : "Waiting Approval"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {result ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-medium">
                Structured Outputs <Badge variant="success">Test Passed</Badge>
              </div>
              <pre className="overflow-x-auto rounded-md bg-muted/60 p-3 text-[11px] leading-5">{result}</pre>
            </div>
          ) : null}
        </div>

        {/* Approval Gate */}
        {approval ? (
          <div className={cn("mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10")}>
            <div className="text-sm font-semibold">Action requires approval</div>
            <div className="mt-2 space-y-1 text-xs">
              <div className="flex justify-between"><span className="text-muted-foreground">Node</span><span>{approval.node.name}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Capability</span><span>Sink / Effect</span></div>
              <div className="mt-1 rounded bg-white/70 p-2 font-mono text-[10px] dark:bg-black/20">
                {'{ "interaction_id": "{{interaction_id}}", "structured_output": "quality_result" }'}
              </div>
              <p className="mt-1 text-muted-foreground">此操作可能修改外部系统或创建业务记录。</p>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { approval.resolve(false); setApproval(null) }}>Reject</Button>
              <Button size="sm" onClick={() => { approval.resolve(true); setApproval(null) }}>Approve & Continue</Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
