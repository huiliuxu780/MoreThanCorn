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
                     Schedule, ToolVersion, Workflow)
from .schemas import WorkflowDefinition
from .validator import validate

REF = re.compile(r"\{\{\s*([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_.-]+)\s*\}\}")

TERMINAL = {"end", "create-record"}


class RunError(Exception):
    pass


# ---------- events ----------


def emit(db: Session, run_id: str, type_: str, node_id: str | None = None,
         node_run_id: str | None = None, payload: dict | None = None) -> RunEvent:
    seq = (db.execute(text("SELECT coalesce(max(sequence),0)+1 FROM run_event WHERE run_id=:r"),
                      {"r": run_id}).scalar())
    ev = RunEvent(run_id=run_id, sequence=int(seq), type=type_, node_id=node_id,
                  node_run_id=node_run_id, payload=payload or {})
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
        return {"now": datetime.now(timezone.utc).isoformat(), "run_id": ""}.get(src.get("path", ""))
    return None


def resolve_bindings(node_inputs: list[dict], outputs: dict[str, dict], run_input: dict) -> dict:
    out: dict[str, Any] = {}
    for b in node_inputs or []:
        out[b["name"]] = resolve_source(b.get("source", {}), outputs, run_input)
    return out


def render_refs(template: str, outputs: dict[str, dict], run_input: dict) -> str:
    def sub(m: re.Match) -> str:
        nid, path = m.group(1), m.group(2)
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
                create_run(db, sch.workflow_id, "schedule",
                           {"window": {"start": (now - __import__("datetime").timedelta(minutes=5)).isoformat(),
                                      "end": now.isoformat()}})
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
        op, expect = b.get("operator"), str(b.get("value") or "")
        sv = str(val or "")
        ok = (op == "eq" and sv == expect) or (op == "neq" and sv != expect) or \
             (op == "contains" and expect in sv) or (op in (None, "") and bool(val))
        if ok:
            selected = b.get("handle") or "yes"
            break
    return {"selected": selected}


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
    ctx.call("tool", tv_id, {"inputs": inputs}, out, int((time.time() - t0) * 1000), {})
    return out


def exec_end(node, ctx) -> dict:
    return resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)


def exec_create_record(node, ctx) -> dict:
    from .models import Evidence, QualityResult
    inputs = resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)
    out = inputs or dict(ctx.outputs)
    qr = QualityResult(run_id=ctx.run.id, interaction_ref=str(ctx.run_input.get("interactionId", "")),
                       structured_output=out if isinstance(out, dict) else {"value": out},
                       score=out.get("score") if isinstance(out, dict) else None,
                       risk=out.get("risk") if isinstance(out, dict) else None,
                       critical=bool(out.get("critical")) if isinstance(out, dict) else False,
                       issue_count=int(out.get("issueCount") or 0) if isinstance(out, dict) else 0,
                       issue_summary=out.get("issueSummary") if isinstance(out, dict) else None)
    ctx.db.add(qr)
    ctx.db.commit()
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


EXECUTORS = {
    "input": exec_input, "llm": exec_llm, "condition": exec_condition,
    "transform": exec_transform, "tool": exec_tool, "end": exec_end,
    "create-record": exec_create_record, "notification": exec_end, "workflow-exec": exec_workflow_exec,
}


class Ctx:
    call_chain: list[str] = []

    def __init__(self, db: Session, run: Run, outputs: dict[str, dict]):
        self.db = db
        self.run = run
        self.run_input = run.input or {}
        self.outputs = outputs

    def call(self, kind, target, req, resp, latency, tokens):
        from .models import CallRecord
        self.db.add(CallRecord(node_run_id=None, kind=kind, target_id=str(target),
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
            try:
                fn = EXECUTORS.get(node["type"])
                if not fn:
                    raise RunError(f"no executor for {node['type']}")
                out = fn(node, ctx)
                outputs[nid] = out
                nr.status = "success"
                nr.output = out
                nr.ended_at = datetime.now(timezone.utc)
                db.commit()
                emit(db, run_id, "node_completed", nid, nr.id,
                     {"output": out, "nodeType": node["type"], "name": node["name"]})
                done.add(nid)
                # successors
                for tgt, handle in succ.get(nid, []):
                    if node["type"] == "condition":
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
        "RETURNING id, payload")).fetchone()
    db.commit()
    if not row:
        return False
    payload = row.payload if isinstance(row.payload, dict) else json.loads(row.payload)
    try:
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
               idempotency_key: str | None = None, enqueue: bool = True) -> Run:
    wf = db.get(Workflow, workflow_id)
    if not wf:
        raise RunError("workflow not found")
    defn = WorkflowDefinition.model_validate(wf.draft_definition)
    rep = validate(defn)
    if not rep.ok:
        raise RunError("validation failed: " + "; ".join(i.message for i in rep.issues[:3]))
    run = Run(workflow_id=workflow_id, trigger=trigger, status="queued", input=run_input or {},
              idempotency_key=idempotency_key)
    db.add(run)
    db.commit()
    if enqueue:
        db.add(JobQueue(type="workflow-execution", payload={"run_id": run.id}))
        db.commit()
    return run
