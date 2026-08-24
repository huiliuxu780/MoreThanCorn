"""Runner — DAG 状态机 + executors + 事件（09-runner-scheduler-worker-design.md，P1）。

设计取舍：
- Queue=PG job_queue（SKIP LOCKED），Worker=后台线程（V1 同进程）。
- 事件落 run_event（sequence 单调）；SSE 以 DB 轮询重放（Last-Event-ID）。
- LLM 默认 mock（model id 任意），真实 provider 经 Model/Provider 表配置后走 OpenAI 兼容协议（P2）。
"""
from __future__ import annotations

import json
import re
import threading
import time
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .db import SessionLocal
from .models import (Connection, JobQueue, Model, ModelProvider, NodeRun, Run, RunEvent,
                     Schedule, ToolVersion, Workflow, WorkflowVersion)
from .schemas import WorkflowDefinition
from .validator import validate

REF = re.compile(r"\{\{\s*([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_.-]+)\s*\}\}")

TERMINAL = {"end", "create-record"}


class RunError(Exception):
    pass


# ---------- events ----------

# SDD C-5：平台系统变量（调研 11 §6 实测 14 项）
SYSTEM_VARIABLES = [
    {"name": "tenantId", "label": "租户 ID"}, {"name": "userId", "label": "用户 ID"},
    {"name": "userName", "label": "用户账号名称"}, {"name": "sysTime", "label": "系统时间"},
    {"name": "language", "label": "多语言标识"}, {"name": "memberId", "label": "进线会员账号 ID"},
    {"name": "formId", "label": "网页渠道 ID"}, {"name": "robotCode", "label": "机器人 code"},
    {"name": "nick", "label": "昵称"}, {"name": "serviceId", "label": "服务 ID"},
    {"name": "serviceName", "label": "服务名称"}, {"name": "phoneNum", "label": "电话"},
    {"name": "onlineChannelSource", "label": "在线渠道来源"}, {"name": "initContext", "label": "初始化上下文"},
]

# CONTENT 通道事件（用户可见内容流；其余为 CONTROL 控制面）——SDD C-1
CONTENT_EVENTS = {"llm_delta", "reply_sent"}


def emit(db: Session, run_id: str, type_: str, node_id: str | None = None,
         node_run_id: str | None = None, payload: dict | None = None,
         channel: str | None = None, span_id: str | None = None,
         parent_span_id: str | None = None, duration_ms: int | None = None,
         tokens: dict | None = None) -> RunEvent:
    seq = (db.execute(text("SELECT coalesce(max(sequence),0)+1 FROM run_event WHERE run_id=:r"),
                      {"r": run_id}).scalar())
    ev = RunEvent(run_id=run_id, sequence=int(seq), type=type_, node_id=node_id,
                  node_run_id=node_run_id, payload=payload or {},
                  channel=channel or ("CONTENT" if type_ in CONTENT_EVENTS else "CONTROL"),
                  trace_id=run_id, span_id=span_id or node_run_id,
                  parent_span_id=parent_span_id or run_id, duration_ms=duration_ms, tokens=tokens)
    db.add(ev)
    db.commit()
    return ev


# ---------- variable resolution ----------


def _dig(d: Any, path: str) -> Any:
    cur = d
    for part in path.split("."):
        if isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
    return cur


def resolve_source(src: dict, outputs: dict[str, dict], run_input: dict) -> Any:
    kind = src.get("kind")
    if kind == "fixed":
        return src.get("value")
    if kind == "upstream":
        return _dig(outputs.get(src.get("nodeId", ""), {}), src.get("path", "").replace("outputs.", "", 1))
    if kind == "input":
        return run_input.get(src.get("path", ""))
    if kind == "system":
        path = src.get("path", "")
        if path == "now":
            return datetime.now(timezone.utc).isoformat()
        if path == "run_id":
            return ""
        # SDD C-5：14 项系统变量从运行上下文取，缺失返回空串
        return str((run_input.get("__system") or {}).get(path, ""))
    return None


def resolve_bindings(node_inputs: list[dict], outputs: dict[str, dict], run_input: dict) -> dict:
    out: dict[str, Any] = {}
    for b in node_inputs or []:
        out[b["name"]] = resolve_source(b.get("source", {}), outputs, run_input)
    return out


def render_refs(template: str, outputs: dict[str, dict], run_input: dict) -> str:
    def sub(m: re.Match) -> str:
        nid, path = m.group(1), m.group(2)
        if nid == "system":  # SDD C-5：{{system.xxx}}
            if path == "now":
                return datetime.now(timezone.utc).isoformat()
            return str((run_input.get("__system") or {}).get(path, ""))
        if nid in ("n_start", "start"):
            v = _dig(run_input, path)
            if v is None and path.startswith("outputs."):
                v = run_input.get(path.split(".", 1)[1])
        else:
            v = _dig(outputs.get(nid, {}), path)
        return "" if v is None else str(v)
    return REF.sub(sub, template or "")


# ---------- executors ----------


def exec_input(node, ctx) -> dict:
    return {**ctx.run_input}


def exec_llm(node, ctx) -> dict:
    cfg = node.get("config", {})
    prompt = render_refs(cfg.get("prompt", ""), ctx.outputs, ctx.run_input)
    model = (cfg.get("modelRef") or {}).get("modelId", "mock")
    inputs = resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)
    t0 = time.time()
    answer, tokens = _call_model(ctx.db, model, prompt)
    latency = int((time.time() - t0) * 1000)
    ctx.call("model", model, {"prompt": prompt, "inputs": inputs},
             {"output": answer}, latency, tokens)
    return {"output": answer, "thought": "", "answer": answer}


def _call_model(db: Session, model_id: str, prompt: str) -> tuple[str, dict]:
    """真实 LLM 联调：OpenAI 兼容协议。
    优先级：env WF_LLM_BASE_URL/WF_LLM_API_KEY > Model/Provider 表配置；无 http base 时 mock 回落。"""
    import os
    base = os.environ.get("WF_LLM_BASE_URL", "")
    secret = os.environ.get("WF_LLM_API_KEY", "")
    if not base:
        for m in db.execute(select(Model).where(Model.model_key == model_id)).scalars().all():
            prov = db.get(ModelProvider, m.provider_id)
            if prov and prov.base_url.startswith(("http://", "https://")):
                base = prov.base_url
                if not secret and prov.auth_connection_id:
                    conn = db.get(Connection, prov.auth_connection_id)
                    if conn:
                        secret = _decrypt(conn.secret_ref)
                break
    if not base or not base.startswith(("http://", "https://")):
        return f"[mock:{model_id}] 已处理：{prompt[:120]}", {
            "promptTokens": len(prompt) // 2, "completionTokens": 60}
    with httpx.Client(timeout=60) as client:
        r = client.post(f"{base.rstrip('/')}/chat/completions",
                        headers={"Authorization": f"Bearer {secret}"} if secret else {},
                        json={"model": model_id,
                              "messages": [{"role": "user", "content": prompt}]})
        r.raise_for_status()
        j = r.json()
    usage = j.get("usage", {}) or {}
    return (j["choices"][0]["message"]["content"],
            {"promptTokens": usage.get("prompt_tokens", 0),
             "completionTokens": usage.get("completion_tokens", 0)})


def _decrypt(ref: str) -> str:
    import os
    try:
        from cryptography.fernet import Fernet
        key = os.environ.get("WF_SECRET_KEY")
        if key:
            return Fernet(key.encode()).decrypt(ref.encode()).decode()
    except Exception:  # noqa: BLE001
        pass
    return ref  # dev：明文


# ---------- schedule（P2） ----------

def compute_next(cron_expr: str, tz: str) -> datetime:
    from croniter import croniter
    from zoneinfo import ZoneInfo
    try:
        zone = ZoneInfo(tz)
    except Exception:  # noqa: BLE001
        zone = ZoneInfo("Asia/Shanghai")
    now = datetime.now(zone)
    return croniter(cron_expr, now).get_next(datetime).astimezone(timezone.utc)


def schedule_tick() -> int:
    db = SessionLocal()
    fired = 0
    try:
        now = datetime.now(timezone.utc)
        due = db.execute(select(Schedule).where(Schedule.enabled == True)).scalars().all()  # noqa: E712
        for sch in due:
            if sch.next_run_at is None:
                sch.next_run_at = compute_next(sch.cron_expr, sch.timezone)
                db.commit()
                continue
            if sch.next_run_at > now:
                continue
            if sch.valid_to and now > sch.valid_to.replace(tzinfo=timezone.utc):
                sch.enabled = False
                db.commit()
                continue
            try:
                if sch.task_id:
                    from .routers.business import batch_run_task
                    from .models import AnalysisTask
                    task = db.get(AnalysisTask, sch.task_id)
                    if task:
                        fired += len(batch_run_task(db, task))
                else:
                    create_run(db, sch.workflow_id, "schedule",
                               {"window": {"start": (now - __import__("datetime").timedelta(minutes=5)).isoformat(),
                                          "end": now.isoformat()}},
                               pinned_version_id=sch.pinned_version_id)
                    fired += 1
                sch.last_ran_at = now
                sch.failed_count = 0
            except RunError:
                sch.failed_count = (sch.failed_count or 0) + 1
                if sch.failed_count >= 5:
                    sch.enabled = False
            sch.next_run_at = compute_next(sch.cron_expr, sch.timezone)
            db.commit()
    finally:
        db.close()
    return fired


def scheduler_loop(stop: threading.Event) -> None:
    while not stop.is_set():
        try:
            schedule_tick()
        except Exception:  # noqa: BLE001
            pass
        stop.wait(10)


def exec_condition(node, ctx) -> dict:
    inputs = resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)
    branches = (node.get("config") or {}).get("branches", []) or []
    selected = "else"
    for b in branches:
        var = b.get("variable") or ""
        m = REF.match(var.strip()) if var else None
        val = None
        if m:
            val = _dig(ctx.outputs.get(m.group(1), {}), m.group(2))
        elif var:
            val = inputs.get(var) or ctx.run_input.get(var)
        if _branch_ok(b.get("operator"), val, b.get("value")):
            selected = b.get("handle") or "yes"
            break
    return {"selected": selected}


def _branch_ok(op: str | None, val: Any, expect_raw: Any) -> bool:
    """条件运算符（SDD A-06）：String 六项 + gt/lt 数值比较；无运算符时按真值。"""
    expect = str(expect_raw or "")
    if op in (None, ""):
        return bool(val)
    if op == "empty":
        return val is None or val in ("", [], {})
    if op == "not_empty":
        return not (val is None or val in ("", [], {}))
    sv = str(val or "")
    if op == "eq":
        return sv == expect
    if op == "neq":
        return sv != expect
    if op == "contains":
        return expect in sv
    if op == "not_contains":
        return expect not in sv
    if op in ("gt", "lt"):
        try:
            lv, rv = float(val), float(expect_raw)
        except (TypeError, ValueError):
            return False
        return lv > rv if op == "gt" else lv < rv
    return False


def exec_transform(node, ctx) -> dict:
    cfg = node.get("config", {})
    rendered = render_refs(cfg.get("template", "") or "{{n_start.outputs.userQuery}}", ctx.outputs, ctx.run_input)
    return {"output": rendered}


def exec_tool(node, ctx) -> dict:
    cfg = node.get("config", {})
    tv_id = cfg.get("toolVersionId")
    if not tv_id:
        raise RunError("toolVersionId missing")
    tv = ctx.db.get(ToolVersion, tv_id)
    if not tv:
        raise RunError(f"tool version {tv_id} not found")
    inputs = resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)
    spec = tv.spec or {}
    t0 = time.time()
    if spec.get("kind") == "echo" or not spec.get("request"):
        out = {"result": json.dumps(inputs, ensure_ascii=False)[:500]}
    else:
        req = spec["request"]
        url = render_refs(req.get("url", ""), ctx.outputs, ctx.run_input)
        if not url.startswith(("http://", "https://")) or re.search(r"//(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|localhost)", url):
            raise RunError("SSRF blocked")
        with httpx.Client(timeout=10) as client:
            r = client.request(req.get("method", "GET"), url, json=inputs if req.get("method", "GET") != "GET" else None)
        out = {"status": r.status_code, "body": r.text[:2000]}
    ctx.call("tool", tv.tool_id, {"toolVersionId": tv_id, "inputs": inputs}, out, int((time.time() - t0) * 1000), {})
    return out


def exec_end(node, ctx) -> dict:
    return resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)


def exec_create_record(node, ctx) -> dict:
    from .models import Evidence, QualityResult
    inputs = resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)
    out = inputs or dict(ctx.outputs)
    qr = QualityResult(run_id=ctx.run.id, interaction_ref=str(ctx.run_input.get("interactionId", "")),
                       structured_output=out if isinstance(out, dict) else {"value": out},
                       transcript=out.get("transcript") if isinstance(out, dict) and isinstance(out.get("transcript"), list) else [],
                       score=out.get("score") if isinstance(out, dict) else None,
                       risk=out.get("risk") if isinstance(out, dict) else None,
                       critical=bool(out.get("critical")) if isinstance(out, dict) else False,
                       issue_count=int(out.get("issueCount") or 0) if isinstance(out, dict) else 0,
                       issue_summary=out.get("issueSummary") if isinstance(out, dict) else None)
    ctx.db.add(qr)
    ctx.db.commit()
    from .routers.business import apply_rules_to_result
    apply_rules_to_result(ctx.db, qr)
    evs = out.get("evidence", []) if isinstance(out, dict) else []
    for e in evs if isinstance(evs, list) else []:
        if isinstance(e, dict):
            ctx.db.add(Evidence(result_id=qr.id, kind=str(e.get("kind", "field")),
                                locator=e.get("locator") if isinstance(e.get("locator"), dict) else {},
                                text=str(e.get("text", "")), source_ref=str(e.get("sourceRef", ""))))
    ctx.db.commit()
    return {"qualityResultId": qr.id, "evidenceCount": len(evs) if isinstance(evs, list) else 0}


def exec_workflow_exec(node, ctx) -> dict:
    code = (node.get("config") or {}).get("workflowCode")
    if not code:
        raise RunError("workflowCode missing")
    sub = create_run(ctx.db, code, "manual", ctx.run_input, enqueue=False)
    execute_run(sub.id, call_chain=list(ctx.call_chain))
    from .db import SessionLocal as _SL
    fresh = _SL()
    try:
        r = fresh.get(Run, sub.id)
        status = r.status
        err = r.error
    finally:
        fresh.close()
    class _R:  # 轻量包装
        pass
    r = _R(); r.status = status; r.error = err; r.output = None
    if status == "succeeded":
        fresh = _SL()
        try:
            r.output = fresh.get(Run, sub.id).output
        finally:
            fresh.close()
    if r.status != "succeeded":
        raise RunError(f"sub workflow failed: {(r.error or {}).get('message', r.status)}")
    return r.output or {}


def exec_knowledge_retrieval(node, ctx) -> dict:
    from .resource_tests import search_knowledge
    cfg = node.get("config", {})
    query = render_refs(cfg.get("query", ""), ctx.outputs, ctx.run_input)
    top_k = int(cfg.get("topK", 5) or 5)
    t0 = time.time()
    slices = search_knowledge(ctx.db, cfg.get("knowledgeSourceId"), query, top_k)
    latency = int((time.time() - t0) * 1000)
    ctx.call("knowledge", cfg.get("knowledgeSourceId"), {"query": query, "topK": top_k},
             {"slices": len(slices)}, latency, {})
    return {"slices": json.dumps(slices, ensure_ascii=False),
            "sources": json.dumps([s.get("text", "")[:80] for s in slices], ensure_ascii=False)}


def exec_mcp_call(node, ctx) -> dict:
    from .resource_tests import mcp_call_tool
    cfg = node.get("config", {})
    inputs = resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)
    args = {**(cfg.get("args") or {}), **inputs}
    t0 = time.time()
    out = mcp_call_tool(ctx.db, cfg.get("mcpServerId"), cfg.get("toolName"), args)
    ctx.call("mcp", cfg.get("mcpServerId"), {"tool": cfg.get("toolName"), "args": args},
             out, int((time.time() - t0) * 1000), {})
    return {"result": json.dumps(out, ensure_ascii=False)[:2000]}


def exec_notification(node, ctx) -> dict:
    """通知/中途回复节点（SDD A-05）：发事件但不终止流程——区别于 end。"""
    cfg = node.get("config") or {}
    message = render_refs(cfg.get("message", ""), ctx.outputs, ctx.run_input)
    emit(ctx.db, ctx.run.id, "notification_sent", node_id=node.get("id"),
         payload={"message": (message or "")[:2000]})
    return {"sent": True}


# ---------- Phase C 新增节点（SDD 03 §C-4） ----------

def exec_reply(node, ctx) -> dict:
    """对话回复：CONTENT 通道发事件，不终止流程（调研 11 §3.17）。"""
    cfg = node.get("config") or {}
    content = render_refs(cfg.get("content", ""), ctx.outputs, ctx.run_input)
    emit(ctx.db, ctx.run.id, "reply_sent", node_id=node.get("id"),
         payload={"content": (content or "")[:2000]})
    return {"sent": True}


def exec_memory_variable(node, ctx) -> dict:
    """记忆变量节点：读写持久化记忆（键空间=agent 或 workflow；写入校验已声明键）。"""
    from .models import Agent, MemoryRecord
    cfg = node.get("config") or {}
    mode = cfg.get("mode", "read")
    scope = f"agent:{ctx.run.agent_id}" if ctx.run.agent_id else f"wf:{ctx.run.workflow_id}"
    declared = None
    if ctx.run.agent_id:
        a = ctx.db.get(Agent, ctx.run.agent_id)
        if a:
            declared = {m.get("name") for m in ((a.config or {}).get("memoriesSchema") or [])}
    if mode == "write":
        inputs = resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)
        for key, val in inputs.items():
            if declared is not None and key not in declared:
                raise RunError(f"记忆变量 {key} 未在记忆 Schema 中声明")
            rec = ctx.db.execute(select(MemoryRecord).where(
                MemoryRecord.scope == scope, MemoryRecord.key == key)).scalars().first()
            if rec:
                rec.value = "" if val is None else str(val)
            else:
                ctx.db.add(MemoryRecord(scope=scope, key=key, value="" if val is None else str(val)))
        ctx.db.commit()
        emit(ctx.db, ctx.run.id, "memory_write", node_id=node.get("id"),
             payload={"scope": scope, "keys": list(inputs.keys())})
        return {"isSuccess": True}
    keys = cfg.get("keys") or []
    out: dict[str, Any] = {}
    for key in keys:
        rec = ctx.db.execute(select(MemoryRecord).where(
            MemoryRecord.scope == scope, MemoryRecord.key == key)).scalars().first()
        out[key] = rec.value if rec else ""
    emit(ctx.db, ctx.run.id, "memory_read", node_id=node.get("id"),
         payload={"scope": scope, "keys": keys})
    return out


def _route_workflow(db: Session, flows: list, query: str):
    try:
        from .agent_runtime import _resolve_base_secret
        base, _s = _resolve_base_secret(db, "qwen-plus")
    except Exception:  # noqa: BLE001
        base = ""
    if not base or not base.startswith(("http://", "https://")):
        return flows[0]  # mock：取首个候选
    listing = "\n".join(f"{i + 1}. {w.name}：{(w.description or '').strip()[:100]}" for i, w in enumerate(flows))
    try:
        answer, _t = _call_model(db, "qwen-plus",
                                 f"从候选工作流中为问题选择最合适的一个，只输出序号，没有合适的输出 NONE。\n{listing}\n\n问题：{query[:500]}")
    except Exception:  # noqa: BLE001
        return flows[0]
    digits = "".join(ch for ch in (answer or "") if ch.isdigit())
    if digits and 1 <= int(digits) <= len(flows):
        return flows[int(digits) - 1]
    return None


def exec_workflow_select(node, ctx) -> dict:
    """工作流选择：候选中语义路由；未命中走 miss 分支（调研 11 §3.6）。"""
    cfg = node.get("config") or {}
    candidates = cfg.get("candidates") or []
    inputs = resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)
    query = str(inputs.get("query") or ctx.run_input.get("userQuery") or "")
    flows = [w for w in (ctx.db.get(Workflow, wid) for wid in candidates) if w]
    if not flows:
        raise RunError("工作流选择节点未配置有效候选工作流")
    chosen = _route_workflow(ctx.db, flows, query)
    if chosen is None:
        return {"selected": "miss", "workflowCode": "", "workflowName": "", "workflowDesc": ""}
    return {"selected": chosen.id, "workflowCode": chosen.id,
            "workflowName": chosen.name, "workflowDesc": chosen.description or ""}


def exec_workflow_fixed(node, ctx) -> dict:
    """固定工作流节点：绑定已选工作流，子运行执行（调研 11 §3.15）。"""
    wfid = (node.get("config") or {}).get("workflowId")
    if not wfid:
        raise RunError("workflowId missing")
    sub = create_run(ctx.db, wfid, "manual", ctx.run_input, enqueue=False)
    execute_run(sub.id, call_chain=list(ctx.call_chain))
    # 独立会话读取，避免当前会话的过期缓存（execute_run 在自己的会话中提交）
    from .db import SessionLocal as _SL
    fresh = _SL()
    try:
        r = fresh.get(Run, sub.id)
        status, err, output = r.status, r.error, r.output
    finally:
        fresh.close()
    if status != "succeeded":
        raise RunError(f"固定工作流执行失败：{(err or {}).get('message', status)}")
    return output or {}


def exec_code_write(node, ctx) -> dict:
    """代码编写：子进程沙箱执行 Python（超时 10s；args.params 传入；调研 11 §3.18）。"""
    import subprocess
    import tempfile
    cfg = node.get("config") or {}
    code = cfg.get("code") or "def main(args):\n    return {\"output\": args.params.get(\"input\", \"\")}\n"
    inputs = resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)
    program = ("import json, sys\n"
               "__in = json.loads(sys.stdin.read())\n"
               "class Args:\n    pass\n"
               "args = Args()\n"
               "args.params = __in.get('params', {})\n"
               + code + "\n"
               "__out = main(args)\n"
               "print(json.dumps(__out if isinstance(__out, dict) else {'result': __out}, ensure_ascii=False))\n")
    tmp = None
    t0 = time.time()
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
            f.write(program)
            tmp = f.name
        proc = subprocess.run(["python3", tmp], input=json.dumps({"params": inputs}, ensure_ascii=False),
                              capture_output=True, text=True, timeout=10)
    except subprocess.TimeoutExpired:
        raise RunError("代码执行超时（>10s）")
    finally:
        if tmp:
            try:
                import os as _os
                _os.unlink(tmp)
            except Exception:  # noqa: BLE001
                pass
    if proc.returncode != 0:
        raise RunError(f"代码执行失败：{(proc.stderr or '').strip()[:500]}")
    ctx.call("code", node.get("id"), {"inputs": inputs}, {"stdout": proc.stdout[:500]},
             int((time.time() - t0) * 1000), {})
    try:
        out = json.loads(proc.stdout.strip().splitlines()[-1]) if proc.stdout.strip() else {}
    except (json.JSONDecodeError, IndexError):
        out = {"output": proc.stdout.strip()[:2000]}
    return out if isinstance(out, dict) else {"result": out}


def _llm_base(db: Session) -> str:
    try:
        from .agent_runtime import _resolve_base_secret
        base, _s = _resolve_base_secret(db, "qwen-plus")
        return base or ""
    except Exception:  # noqa: BLE001
        return ""


def exec_decision_class(node, ctx) -> dict:
    """决策分类：LLM 分类 + 多分支（mock：第一类；调研 11 §3.10）。"""
    cfg = node.get("config") or {}
    branches = cfg.get("branches") or []
    if not branches:
        raise RunError("决策分类未配置分类项")
    inputs = resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)
    query = str(render_refs(cfg.get("query", ""), ctx.outputs, ctx.run_input)
                or inputs.get("query") or ctx.run_input.get("userQuery") or "")
    listing = "\n".join(f"{i + 1}. {b.get('title', '')}：{(b.get('description') or '')[:100]}"
                        for i, b in enumerate(branches))
    chosen_idx = None
    base = _llm_base(ctx.db)
    if base.startswith(("http://", "https://")):
        try:
            answer, _t = _call_model(ctx.db, "qwen-plus",
                                     f"把问题分到最合适的类别，只输出序号，都不合适输出 0。\n{listing}\n\n问题：{query[:500]}")
            digits = "".join(ch for ch in (answer or "") if ch.isdigit())
            if digits and 1 <= int(digits) <= len(branches):
                chosen_idx = int(digits) - 1
        except Exception:  # noqa: BLE001
            chosen_idx = None
    else:
        chosen_idx = 0  # mock：第一类
    if chosen_idx is None:
        return {"selected": "else", "classificationTitle": "其他", "classificationId": "other"}
    b = branches[chosen_idx]
    handle = b.get("handle") or f"c{chosen_idx}"
    return {"selected": handle, "classificationTitle": b.get("title", ""),
            "classificationId": str(chosen_idx)}


def exec_query_rewrite(node, ctx) -> dict:
    """Query 改写：LLM 改写为查询列表（默认策略/自定义；调研 11 §3.11）。"""
    cfg = node.get("config") or {}
    inputs = resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)
    query = str(render_refs(cfg.get("template", ""), ctx.outputs, ctx.run_input)
                or inputs.get("query") or ctx.run_input.get("userQuery") or "")
    chat_history = str(inputs.get("chatHistory") or ctx.run_input.get("chatHistory") or "")
    base = _llm_base(ctx.db)
    if base.startswith(("http://", "https://")) and cfg.get("strategy") == "custom":
        try:
            answer, _t = _call_model(ctx.db, "qwen-plus",
                                     f"把用户问题改写为最多3个检索查询，每行一个。\n历史：{chat_history[:300]}\n问题：{query[:500]}")
            lines = [ln.strip() for ln in (answer or "").splitlines() if ln.strip()]
            if lines:
                return {"queryList": lines[:3]}
        except Exception:  # noqa: BLE001
            pass
    return {"queryList": [query] if query else []}


EXECUTORS = {
    "input": exec_input, "llm": exec_llm, "condition": exec_condition,
    "transform": exec_transform, "tool": exec_tool, "end": exec_end,
    "create-record": exec_create_record, "notification": exec_notification,
    "workflow-exec": exec_workflow_exec,
    "knowledge-retrieval": exec_knowledge_retrieval, "mcp-call": exec_mcp_call,
    # Phase C（SDD 03 §C-4）
    "reply": exec_reply, "memory-variable": exec_memory_variable,
    "workflow-select": exec_workflow_select, "workflow-fixed": exec_workflow_fixed,
}


def _agent_family_executor(type_key: str):
    """画布节点族补充：Agent 系列 + Phase C 真执行器（决策分类/Query改写/代码）。"""
    from . import agent_runtime as ar
    return {
        "agent": ar.exec_agent_node,
        "agent-select": ar.exec_agent_select,
        "agent-exec": ar.exec_agent_exec,
        "decision-class": exec_decision_class,
        "query-rewrite": exec_query_rewrite,
        "code-write": exec_code_write,
    }.get(type_key)


class Ctx:
    call_chain: list[str] = []

    def __init__(self, db: Session, run: Run, outputs: dict[str, dict]):
        self.db = db
        self.run = run
        self.run_input = run.input or {}
        self.outputs = outputs
        self.current_node_run_id: str | None = None  # SDD A-07：调用记录关联节点运行

    def call(self, kind, target, req, resp, latency, tokens):
        from .models import CallRecord
        self.db.add(CallRecord(node_run_id=self.current_node_run_id, kind=kind, target_id=str(target),
                               request={"summary": str(req)[:1000]}, response={"summary": str(resp)[:1000]},
                               status="success", latency_ms=latency, token_usage=tokens or {}))
        self.db.commit()


# ---------- runner ----------


def execute_run(run_id: str, call_chain: list[str] | None = None) -> None:
    db = SessionLocal()
    try:
        run = db.get(Run, run_id)
        if not run:
            return
        chain = list(call_chain or [])
        if run.workflow_id in chain:
            run.status = "failed"
            run.error = {"message": f"检测到工作流递归调用：{' -> '.join(chain + [run.workflow_id])}"}
            db.commit()
            emit(db, run_id, "workflow_failed", payload={"error": "workflow recursion detected"})
            return
        if len(chain) >= 5:
            run.status = "failed"
            run.error = {"message": "子工作流嵌套深度超过 5 层"}
            db.commit()
            emit(db, run_id, "workflow_failed", payload={"error": "workflow depth limit exceeded"})
            return
        chain.append(run.workflow_id)
        # SDD A-01/B-03：运行认版本——优先级 Agent 版本快照 > 工作流版本快照 > 草稿
        frozen_agent_versions: dict[str, str] = {}
        if run.agent_version_id:
            from .models import AgentVersion
            av = db.get(AgentVersion, run.agent_version_id)
            if not av:
                raise RunError(f"run references missing agent version {run.agent_version_id}")
            defn = WorkflowDefinition.model_validate((av.definition or {}).get("graph"))
            for item in ((av.dependency_snapshot or {}).get("items") or []):
                if item.get("type") == "AGENT" and item.get("version"):
                    frozen_agent_versions[item["ref"]] = item["version"]
        elif run.workflow_version_id:
            ver = db.get(WorkflowVersion, run.workflow_version_id)
            if not ver:
                raise RunError(f"run references missing workflow version {run.workflow_version_id}")
            defn = WorkflowDefinition.model_validate(ver.definition)
        else:
            wf = db.get(Workflow, run.workflow_id)
            defn = WorkflowDefinition.model_validate(wf.draft_definition)
        nodes = [n.model_dump() for n in defn.graph.nodes]
        edges = [e.model_dump() for e in defn.graph.edges]
        by_id = {n["id"]: n for n in nodes}
        run.status = "running"
        run.started_at = datetime.now(timezone.utc)
        db.commit()
        emit(db, run_id, "workflow_started")

        outputs: dict[str, dict] = {}
        ctx = Ctx(db, run, outputs)
        ctx.call_chain = chain
        ctx.frozen_agent_versions = frozen_agent_versions  # SDD B：成员 Agent 冻结版本（可空）
        succ: dict[str, list[tuple[str, str | None]]] = {}
        indeg: dict[str, int] = {n["id"]: 0 for n in nodes}
        for e in edges:
            succ.setdefault(e["source"], []).append((e["target"], e.get("sourceHandle")))
            indeg[e["target"]] = indeg.get(e["target"], 0) + 1

        ready = [n["id"] for n in nodes if indeg.get(n["id"], 0) == 0]
        done: set[str] = set()
        skipped: set[str] = set()
        failed_ids: set[str] = set()
        first_error = ""
        active_handle: dict[str, str | None] = {}  # source -> selected handle (condition)
        failed = False

        while ready and not failed:
            nid = ready.pop(0)
            node = by_id[nid]
            nr = NodeRun(run_id=run_id, node_id=nid, node_type=node["type"], status="running",
                         started_at=datetime.now(timezone.utc), input=outputs.get(nid, {}))
            db.add(nr)
            db.commit()
            emit(db, run_id, "node_started", nid, nr.id, {"nodeType": node["type"], "name": node["name"]})
            ctx.current_node_run_id = nr.id  # SDD A-07：节点内调用记录关联到本节点运行
            try:
                fn = EXECUTORS.get(node["type"]) or _agent_family_executor(node["type"])
                if not fn:
                    raise RunError(f"no executor for {node['type']}")
                out = fn(node, ctx)
                outputs[nid] = out
                nr.status = "success"
                nr.output = out
                nr.ended_at = datetime.now(timezone.utc)
                nr.duration_ms = int((nr.ended_at - nr.started_at).total_seconds() * 1000) if nr.started_at else None
                db.commit()
                emit(db, run_id, "node_completed", nid, nr.id,
                     {"output": out, "nodeType": node["type"], "name": node["name"]},
                     duration_ms=nr.duration_ms)
                done.add(nid)
                # successors（condition/decision-class/workflow-select 走分支语义）
                for tgt, handle in succ.get(nid, []):
                    if node["type"] in ("condition", "decision-class", "workflow-select"):
                        sel = out.get("selected")
                        want = handle or "yes"
                        if sel == "else":
                            want_ok = want not in [b.get("handle") for b in (node["config"] or {}).get("branches", [])]
                            if not want_ok and want != "else":
                                _skip_downstream(tgt, succ, skipped, db, run_id, by_id)
                                continue
                        elif want != sel:
                            _skip_downstream(tgt, succ, skipped, db, run_id, by_id)
                            continue
                    indeg[tgt] -= 1
                    if indeg[tgt] <= 0 and tgt not in done and tgt not in skipped:
                        ready.append(tgt)
            except Exception as exc:  # noqa: BLE001
                nr.status = "failed"
                nr.error = {"message": str(exc)}
                nr.ended_at = datetime.now(timezone.utc)
                db.commit()
                emit(db, run_id, "node_failed", nid, nr.id, {"error": str(exc), "name": node["name"]})
                failed_ids.add(nid)
                if not first_error:
                    first_error = str(exc)
                failed = True

        for nid in [n["id"] for n in nodes if nid_not_done(n["id"], done, skipped, ready) and nid not in failed_ids]:
            nr = NodeRun(run_id=run_id, node_id=nid, node_type=by_id[nid]["type"], status="skipped")
            db.add(nr)
            db.commit()
            emit(db, run_id, "node_skipped", nid, nr.id, {})

        end_nodes = [n for n in nodes if n["type"] in TERMINAL and n["id"] in done]
        if failed:
            run.status = "failed"
            run.error = {"message": first_error or "node failed"}
            emit(db, run_id, "workflow_failed", payload={"error": "node failed"})
        elif end_nodes:
            run.status = "succeeded"
            run.output = outputs.get(end_nodes[0]["id"], {})
            emit(db, run_id, "workflow_completed", payload={"output": run.output})
        else:
            run.status = "failed"
            run.error = {"message": "no terminal node executed"}
            emit(db, run_id, "workflow_failed", payload={"error": "no terminal executed"})
        run.ended_at = datetime.now(timezone.utc)
        if run.started_at:
            run.duration_ms = int((run.ended_at - run.started_at).total_seconds() * 1000)
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        run = db.get(Run, run_id)
        if run:
            run.status = "failed"
            run.error = {"message": str(exc)}
            db.commit()
            emit(db, run_id, "workflow_failed", payload={"error": str(exc)})
    finally:
        db.close()


def nid_not_done(nid, done, skipped, ready):
    return nid not in done and nid not in skipped and nid not in ready


def _skip_downstream(nid, succ, skipped, db, run_id, by_id):
    if nid in skipped:
        return
    skipped.add(nid)
    nr = NodeRun(run_id=run_id, node_id=nid, node_type=by_id[nid]["type"], status="skipped")
    db.add(nr)
    db.commit()
    emit(db, run_id, "node_skipped", nid, nr.id, {})
    for tgt, _h in succ.get(nid, []):
        _skip_downstream(tgt, succ, skipped, db, run_id, by_id)


# ---------- worker ----------


def claim_and_run(db: Session) -> bool:
    row = db.execute(text(
        "UPDATE job_queue SET status='processing', locked_at=now(), locked_by='w1' "
        "WHERE id=(SELECT id FROM job_queue WHERE status='pending' ORDER BY run_at LIMIT 1 FOR UPDATE SKIP LOCKED) "
        "RETURNING id, type, payload")).fetchone()
    db.commit()
    if not row:
        return False
    payload = row.payload if isinstance(row.payload, dict) else json.loads(row.payload)
    try:
        if row.type == "agent-execution":  # SDD A-03：Agent 顶层运行
            from .agent_runtime import execute_agent_job
            execute_agent_job(payload["run_id"])
        else:
            execute_run(payload["run_id"])
        st = "done"
    except Exception as exc:  # noqa: BLE001
        st = "failed"
        payload["error"] = str(exc)
    db.execute(text("UPDATE job_queue SET status=:s WHERE id=:i"), {"s": st, "i": row.id})
    db.commit()
    return True


def worker_loop(stop: threading.Event) -> None:
    while not stop.is_set():
        db = SessionLocal()
        try:
            busy = claim_and_run(db)
        finally:
            db.close()
        if not busy:
            stop.wait(0.5)


def start_worker() -> threading.Event:
    stop = threading.Event()
    t = threading.Thread(target=worker_loop, args=(stop,), daemon=True, name="wf-worker")
    t.start()
    s = threading.Thread(target=scheduler_loop, args=(stop,), daemon=True, name="wf-scheduler")
    s.start()
    return stop


def create_run(db: Session, workflow_id: str, trigger: str, run_input: dict,
               idempotency_key: str | None = None, enqueue: bool = True,
               version_id: str | None = None, pinned_version_id: str | None = None) -> Run:
    """创建运行（SDD A-01 运行认版本）。

    解析顺序：
    - 显式 version_id → 执行该不可变版本；
    - trigger=schedule → pinned_version_id → 工作流 current_version_id → 两者皆无则
      RunError("NO_PUBLISHED_VERSION")（定时任务不允许跑未发布草稿）;
    - 其余（manual/test/agent…）→ 草稿。
    """
    wf = db.get(Workflow, workflow_id)
    if not wf:
        raise RunError("workflow not found")
    chosen: WorkflowVersion | None = None
    if version_id:
        chosen = db.get(WorkflowVersion, version_id)
        if not chosen or chosen.workflow_id != workflow_id:
            raise RunError(f"version {version_id} not found for workflow {workflow_id}")
    elif trigger == "schedule":
        vid = pinned_version_id or wf.current_version_id
        if not vid:
            raise RunError("NO_PUBLISHED_VERSION：定时任务没有可运行的已发布版本，请先发布")
        chosen = db.get(WorkflowVersion, vid)
        if not chosen:
            raise RunError(f"NO_PUBLISHED_VERSION：版本 {vid} 不存在")
    raw = chosen.definition if chosen else wf.draft_definition
    defn = WorkflowDefinition.model_validate(raw)
    rep = validate(defn)
    if not rep.ok:
        raise RunError("validation failed: " + "; ".join(i.message for i in rep.issues[:3]))
    run = Run(workflow_id=workflow_id, trigger=trigger, status="queued", input=run_input or {},
              idempotency_key=idempotency_key,
              workflow_version_id=chosen.id if chosen else None,
              definition_source="version" if chosen else "draft")
    db.add(run)
    db.commit()
    if enqueue:
        db.add(JobQueue(type="workflow-execution", payload={"run_id": run.id}))
        db.commit()
    return run
