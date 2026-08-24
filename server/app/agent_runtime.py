"""Agent 运行层（uiux/05 设计）：autonomous ReAct 循环 + 专家组画布节点 executor + 统一运行入口。

- 三型统一入口 run_agent：autonomous → 本模块循环；dialogue/expert-group → 其 workflow（execute_run）。
- 事件复用 run_event；SSE 复用 /api/runs/{id}/events。
- 护栏：MAX_STEPS / MAX_SECONDS / agent_chain 递归防护。
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import SessionLocal
from .models import (Agent, Connection, KnowledgeSource, Model, ModelProvider, Run,
                     Tool, ToolVersion, Workflow)
from .runner import RunError, _decrypt, create_run, emit, execute_run, exec_tool

MAX_STEPS = 8
MAX_SECONDS = 60


class _Ctx:
    """exec_tool 所需的最小上下文。"""

    def __init__(self, db: Session, run: Run, run_input: dict, call_chain: list[str]):
        self.db = db
        self.run = run
        self.run_input = run_input
        self.outputs = {}
        self.call_chain = call_chain

    def call(self, kind, target, req, resp, latency, tokens):
        from .models import CallRecord
        self.db.add(CallRecord(node_run_id=None, kind=kind, target_type=kind,
                               target_id=str(target), request={"summary": str(req)[:1000]},
                               response={"summary": str(resp)[:1000]}, status="success",
                               latency_ms=latency, token_usage=tokens or {}))
        self.db.commit()


# ---------- LLM（OpenAI 兼容 + mock 回落，支持 tools） ----------

def _resolve_base_secret(db: Session, model_key: str) -> tuple[str, str]:
    import os
    base = os.environ.get("WF_LLM_BASE_URL", "")
    secret = os.environ.get("WF_LLM_API_KEY", "")
    if not base:
        for m in db.execute(select(Model).where(Model.model_key == model_key)).scalars().all():
            prov = db.get(ModelProvider, m.provider_id)
            if prov and prov.base_url.startswith(("http://", "https://")):
                base = prov.base_url
                if not secret and prov.auth_connection_id:
                    conn = db.get(Connection, prov.auth_connection_id)
                    if conn:
                        secret = _decrypt(conn.secret_ref)
            break
    return base, secret


def _chat_completion(db: Session, model_key: str, messages: list[dict], tools: list[dict]) -> dict:
    """返回 {"content": str|None, "tool_calls": [{"name","args"}]}。mock：首轮有 tools 时触发一次工具调用以演练循环。"""
    base, secret = _resolve_base_secret(db, model_key)
    if not base or not base.startswith(("http://", "https://")):
        last_user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
        has_tool_result = any(m["role"] == "tool" for m in messages)
        if tools and not has_tool_result:
            t = tools[0]
            return {"content": None, "tool_calls": [{"name": t["function"]["name"], "args": {"input": "ping"}}]}
        return {"content": f"[mock:{model_key}] 已处理：{last_user[:200]}", "tool_calls": []}
    body = {"model": model_key, "messages": messages}
    if tools:
        body["tools"] = tools
    with httpx.Client(timeout=60) as client:
        r = client.post(f"{base.rstrip('/')}/chat/completions",
                        headers={"Authorization": f"Bearer {secret}"} if secret else {}, json=body)
        r.raise_for_status()
        j = r.json()
    msg = j["choices"][0]["message"]
    calls = [{"name": c["function"]["name"], "args": json.loads(c["function"].get("arguments") or "{}")}
             for c in msg.get("tool_calls") or []]
    return {"content": msg.get("content"), "tool_calls": calls}


# ---------- 挂载 → tools schema ----------

def _build_tools(db: Session, cfg: dict) -> tuple[list[dict], dict, dict]:
    """返回 (tools, dispatch 元信息, 解析留痕)。

    留痕（SDD A-09）：每个挂载解析到的真实资源 id + 版本；查不到的记 missing。
    """
    tools: list[dict] = []
    meta: dict[str, tuple[str, str]] = {}
    resolved: dict[str, list[dict]] = {"tools": [], "workflows": [], "knowledges": [], "missing": []}
    for tname in cfg.get("tools", []):
        tool = db.execute(select(Tool).where(Tool.name == tname)).scalars().first()
        if not tool or tool.status not in ("ready", "enabled"):
            resolved["missing"].append({"kind": "tool", "name": tname})
            continue
        tv = db.execute(select(ToolVersion).where(ToolVersion.tool_id == tool.id)
                        .order_by(ToolVersion.version_no.desc())).scalars().first()
        tools.append({"type": "function", "function": {
            "name": f"tool_{tool.id}", "description": tool.description or tool.name,
            "parameters": (tv.input_schema if tv and tv.input_schema else {"type": "object", "properties": {}})}})
        meta[f"tool_{tool.id}"] = ("tool", tool.id)
        resolved["tools"].append({"name": tname, "id": tool.id,
                                  "toolVersionId": tv.id if tv else None})
    for wname in cfg.get("workflows", []):
        wf = db.execute(select(Workflow).where(Workflow.name == wname)).scalars().first()
        if not wf:
            resolved["missing"].append({"kind": "workflow", "name": wname})
            continue
        tools.append({"type": "function", "function": {
            "name": f"workflow_{wf.id}", "description": f"执行工作流：{wf.name}",
            "parameters": {"type": "object", "properties": {"input": {"type": "object"}}}}})
        meta[f"workflow_{wf.id}"] = ("workflow", wf.id)
        resolved["workflows"].append({"name": wname, "id": wf.id})
    for kname in cfg.get("knowledges", []):
        ks = db.execute(select(KnowledgeSource).where(KnowledgeSource.name == kname)).scalars().first()
        if not ks or ks.status != "enabled":
            resolved["missing"].append({"kind": "knowledge", "name": kname})
            continue
        tools.append({"type": "function", "function": {
            "name": f"knowledge_{ks.id}", "description": f"检索知识库：{ks.name}",
            "parameters": {"type": "object", "properties": {"query": {"type": "string"}}}}})
        meta[f"knowledge_{ks.id}"] = ("knowledge", ks.id)
        resolved["knowledges"].append({"name": kname, "id": ks.id})
    tools.append({"type": "function", "function": {
        "name": "memory_write", "description": "写入 run 级记忆变量",
        "parameters": {"type": "object", "properties": {"key": {"type": "string"}, "value": {"type": "string"}}}}})
    tools.append({"type": "function", "function": {
        "name": "memory_read", "description": "读取 run 级记忆变量",
        "parameters": {"type": "object", "properties": {"key": {"type": "string"}}}}})
    meta["memory_write"] = ("memory_write", "")
    meta["memory_read"] = ("memory_read", "")
    return tools, meta, resolved


# ---------- autonomous 循环 ----------

def _autonomous_loop(db: Session, agent: Agent, run: Run, run_input: dict, call_chain: list[str]) -> None:
    cfg = agent.config or {}
    ctx = _Ctx(db, run, run_input, call_chain)
    skills = cfg.get("skills", []) or []
    system = (cfg.get("rolePrompt") or "") + "\n## 挂载技能\n" + "\n".join(f"- {s}" for s in skills)
    messages = [{"role": "system", "content": system},
                {"role": "user", "content": json.dumps(run_input, ensure_ascii=False)}]
    tools, meta, resolved = _build_tools(db, cfg)
    # SDD A-09：挂载解析留痕（含失效项），运行可审计实际用到的资源与版本
    emit(db, run.id, "agent_mounts_resolved", payload=resolved)
    model = (cfg.get("modelRef") or {}).get("modelId") or "qwen-plus"
    memory: dict[str, str] = {}
    t0 = time.time()
    steps = 0
    while steps < MAX_STEPS and (time.time() - t0) < MAX_SECONDS:
        steps += 1
        resp = _chat_completion(db, model, messages, tools)
        if not resp["tool_calls"]:
            run.output = {"content": resp["content"] or ""}
            run.status = "succeeded"
            run.ended_at = datetime.now(timezone.utc)
            db.commit()
            emit(db, run.id, "agent_completed", payload={"content": (resp["content"] or "")[:2000]})
            return
        messages.append({"role": "assistant", "content": resp["content"] or "",
                         "tool_calls": [{"id": str(i), "type": "function",
                                         "function": {"name": c["name"], "arguments": json.dumps(c["args"], ensure_ascii=False)}}
                                        for i, c in enumerate(resp["tool_calls"])]})
        for i, tc in enumerate(resp["tool_calls"]):
            kind, rid = meta.get(tc["name"], ("unknown", ""))
            emit(db, run.id, "tool_call", payload={"name": tc["name"], "args": tc["args"]})
            result = _dispatch(db, ctx, kind, rid, tc["args"], run_input, call_chain, memory)
            emit(db, run.id, "tool_result", payload={"name": tc["name"], "result": str(result)[:500]})
            messages.append({"role": "tool", "tool_call_id": str(i),
                             "content": json.dumps(result, ensure_ascii=False)[:4000]})
    run.status = "failed"
    run.error = {"message": f"超过护栏（steps={MAX_STEPS} / {MAX_SECONDS}s）"}
    run.ended_at = datetime.now(timezone.utc)
    db.commit()
    emit(db, run.id, "agent_failed", payload={"error": run.error["message"]})


def _dispatch(db: Session, ctx: _Ctx, kind: str, rid: str, args: dict, run_input: dict,
              call_chain: list[str], memory: dict[str, str]) -> dict:
    if kind == "tool":
        node = {"config": {"toolVersionId": _latest_tv(db, rid)}, "inputs": [
            {"name": k, "type": "string", "source": {"kind": "fixed", "value": v}} for k, v in (args or {}).items()]}
        return exec_tool(node, ctx)
    if kind == "workflow":
        sub = create_run(db, rid, "agent", args.get("input") or run_input, enqueue=False)
        execute_run(sub.id, call_chain=list(call_chain))
        fresh = db.get(Run, sub.id)
        if fresh.status != "succeeded":
            raise RunError(f"子工作流失败：{(fresh.error or {}).get('message', fresh.status)}")
        return fresh.output or {}
    if kind == "knowledge":
        from .resource_tests import search_knowledge
        slices = search_knowledge(db, rid, str(args.get("query", "")), 3)
        return {"slices": slices}
    if kind == "memory_write":
        memory[str(args.get("key", ""))] = str(args.get("value", ""))
        return {"ok": True}
    if kind == "memory_read":
        return {"value": memory.get(str(args.get("key", "")))}
    return {"error": f"unknown dispatch {kind}"}


def _latest_tv(db: Session, tool_id: str) -> str:
    tv = db.execute(select(ToolVersion).where(ToolVersion.tool_id == tool_id)
                    .order_by(ToolVersion.version_no.desc())).scalars().first()
    if not tv:
        raise RunError(f"tool {tool_id} 无版本")
    return tv.id


# ---------- 专家组画布节点 executor ----------

def exec_agent_select(node, ctx) -> dict:
    """Agent选择＝语义路由器（SDD A-02，调研 11 §4.3）：
    query + 候选成员 → LLM 判定命中主要成员；未命中走兜底；均无则失败。
    mock（无真实 LLM）时取第一个主要成员并标记 routing=mock。"""
    cfg = node.get("config") or {}
    primary = cfg.get("primaryAgents") or []
    fallback = cfg.get("fallbackAgent")
    if not primary and not fallback:
        raise RunError("Agent选择节点未配置主要/兜底 Agent")
    from .runner import resolve_bindings
    inputs = resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)
    query = str(inputs.get("query") or ctx.run_input.get("userQuery") or "")

    candidates = []
    for cid in primary:
        a = ctx.db.get(Agent, cid)
        if a:
            candidates.append(a)
    chosen, routing = _route(ctx.db, candidates, query)
    if chosen is None:
        if not fallback:
            raise RunError("未命中任何主要 Agent 且未配置兜底 Agent")
        chosen = ctx.db.get(Agent, fallback)
        if not chosen:
            raise RunError(f"兜底 Agent {fallback} 不存在")
        routing = "fallback"
    emit(ctx.db, ctx.run.id, "agent_select", node_id=node.get("id"),
         payload={"query": query[:500], "chosen": chosen.id, "routing": routing,
                  "candidateCount": len(candidates)})
    return {"agentCode": chosen.id, "agentName": chosen.name, "agentDesc": chosen.description or ""}


def _route(db: Session, candidates: list, query: str):
    """返回 (Agent|None, routing 标记)。无候选 → (None, "none")。"""
    if not candidates:
        return None, "none"
    base, _secret = _resolve_base_secret(db, "qwen-plus")
    if not base or not base.startswith(("http://", "https://")):
        return candidates[0], "mock"  # mock：保持旧行为，标记可观测
    listing = "\n".join(f"{i + 1}. {a.name}：{(a.description or '').strip()[:120]}"
                        for i, a in enumerate(candidates))
    messages = [
        {"role": "system", "content": "你是路由器。根据用户问题从候选 Agent 中选择最合适的一个。"
                                      "只输出候选序号（如 1），没有合适的输出 NONE。"},
        {"role": "user", "content": f"候选 Agent：\n{listing}\n\n用户问题：{query[:800]}"},
    ]
    try:
        resp = _chat_completion(db, "qwen-plus", messages, tools=[])
    except Exception:  # noqa: BLE001 —— 路由失败降级到兜底，不中断运行
        return None, "route_error"
    content = (resp.get("content") or "").strip()
    digits = "".join(ch for ch in content if ch.isdigit())
    if not digits:
        return None, "none"
    idx = int(digits) - 1
    if 0 <= idx < len(candidates):
        return candidates[idx], "primary"
    return None, "none"


def _member_code(node, ctx) -> str:
    cfg = node.get("config") or {}
    code = cfg.get("agentCode")
    if not code:
        from .runner import resolve_bindings
        bound = resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)
        code = bound.get("agentCode")
    if not code:
        raise RunError("Agent执行节点缺少 agentCode")
    return code


def exec_agent_exec(node, ctx) -> dict:
    return _run_member(ctx, _member_code(node, ctx))


def exec_agent_node(node, ctx) -> dict:
    cfg = node.get("config") or {}
    code = cfg.get("agentCode") or _member_code(node, ctx)
    return _run_member(ctx, code)


def _run_member(ctx: _Ctx, code: str) -> dict:
    member = ctx.db.get(Agent, code)
    if not member:
        raise RunError(f"Agent {code} 不存在")
    # call_chain 中 "agent:" 前缀项 = Agent 递归链，其余 = workflow 链
    agent_chain = [x[len("agent:"): ] for x in ctx.call_chain if x.startswith("agent:")]
    wf_chain = [x for x in ctx.call_chain if not x.startswith("agent:")]
    sub_run = run_agent(ctx.db, member, ctx.run_input, trigger="agent",
                        agent_chain=agent_chain, call_chain_wf=wf_chain, enqueue=False)
    fresh = ctx.db.get(Run, sub_run)
    if fresh.status != "succeeded":
        raise RunError(f"成员 Agent「{member.name}」执行失败：{(fresh.error or {}).get('message', fresh.status)}")
    return {"content": (fresh.output or {}).get("content", json.dumps(fresh.output or {}, ensure_ascii=False))}


# ---------- 统一入口（SDD A-03：顶层异步入队，嵌套保持同步） ----------

def run_agent(db: Session, agent: Agent, run_input: dict, trigger: str = "agent",
              agent_chain: list[str] | None = None, call_chain_wf: list[str] | None = None,
              enqueue: bool = True) -> str:
    """返回 run_id。enqueue=True 时创建 Run 后立即返回，由 worker 执行；
    嵌套调用（成员 Agent/子工作流）必须 enqueue=False 保持顺序。"""
    from .models import JobQueue
    chain = list(agent_chain or [])
    if agent.id in chain:
        raise RunError(f"检测到 Agent 递归调用：{agent.id}")
    run = Run(agent_id=agent.id, workflow_id=agent.workflow_id, trigger=trigger, input=run_input or {})
    db.add(run)
    db.commit()
    emit(db, run.id, "agent_started", payload={"agentId": agent.id, "type": agent.type})
    if agent.type != "autonomous" and not agent.workflow_id:
        run.status = "failed"
        run.error = {"message": "该 Agent 未绑定工作流"}
        run.ended_at = datetime.now(timezone.utc)
        db.commit()
        return run.id
    if enqueue:
        db.add(JobQueue(type="agent-execution", payload={"run_id": run.id}))
        db.commit()
        return run.id
    _execute_agent_inline(db, agent, run, run_input or {}, chain, call_chain_wf)
    return run.id


def _execute_agent_inline(db: Session, agent: Agent, run: Run, run_input: dict,
                          chain: list[str], call_chain_wf: list[str] | None) -> None:
    if agent.type == "autonomous":
        _autonomous_loop(db, agent, run, run_input, chain)
        return
    wf_chain = list(call_chain_wf or []) + [f"agent:{x}" for x in chain] + [f"agent:{agent.id}"]
    execute_run(run.id, call_chain=wf_chain)


def execute_agent_job(run_id: str) -> None:
    """worker 侧执行入口（SDD A-03）：顶层入队的 agent 运行在此执行。"""
    db = SessionLocal()
    try:
        run = db.get(Run, run_id)
        if not run or run.status not in ("queued",):
            return
        agent = db.get(Agent, run.agent_id)
        if not agent:
            run.status = "failed"
            run.error = {"message": "agent not found"}
            db.commit()
            return
        _execute_agent_inline(db, agent, run, run.input or {}, [], None)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        run = db.get(Run, run_id)
        if run and run.status not in ("succeeded", "failed"):
            run.status = "failed"
            run.error = {"message": str(exc)}
            run.ended_at = datetime.now(timezone.utc)
            db.commit()
            emit(db, run_id, "agent_failed", payload={"error": str(exc)})
    finally:
        db.close()
