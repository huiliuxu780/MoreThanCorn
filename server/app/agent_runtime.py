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
from .models import (Agent, Connection, KnowledgeSource, Model, ModelProvider, Release, Run,
                     Tool, ToolVersion, Workflow, new_id)
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


def _chat_completion(db: Session, model_key: str, messages: list[dict], tools: list[dict],
                     on_delta=None, temperature: float = 0.7) -> dict:
    """返回 {"content": str|None, "tool_calls": [{"name","args"}]}。
    on_delta 提供时走流式（SDD B-08），逐块回调文本增量；mock 模式整段一次回调。"""
    base, secret = _resolve_base_secret(db, model_key)
    if not base or not base.startswith(("http://", "https://")):
        last_user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
        has_tool_result = any(m["role"] == "tool" for m in messages)
        if tools and not has_tool_result:
            t = tools[0]
            return {"content": None, "tool_calls": [{"name": t["function"]["name"], "args": {"input": "ping"}}]}
        content = f"[mock:{model_key}] 已处理：{last_user[:200]}"
        if on_delta:
            on_delta(content)
        return {"content": content, "tool_calls": []}
    body = {"model": model_key, "messages": messages, "temperature": temperature}
    if tools:
        body["tools"] = tools
    if on_delta is None:
        with httpx.Client(timeout=60) as client:
            r = client.post(f"{base.rstrip('/')}/chat/completions",
                            headers={"Authorization": f"Bearer {secret}"} if secret else {}, json=body)
            r.raise_for_status()
            j = r.json()
        msg = j["choices"][0]["message"]
        calls = [{"name": c["function"]["name"], "args": json.loads(c["function"].get("arguments") or "{}")}
                 for c in msg.get("tool_calls") or []]
        return {"content": msg.get("content"), "tool_calls": calls}
    # 流式：OpenAI 兼容 SSE（tool_calls 分片按 index 累积）
    body["stream"] = True
    content_parts: list[str] = []
    tc_acc: dict[int, dict] = {}
    try:
        with httpx.Client(timeout=120) as client:
            with client.stream("POST", f"{base.rstrip('/')}/chat/completions",
                               headers={"Authorization": f"Bearer {secret}"} if secret else {}, json=body) as r:
                r.raise_for_status()
                for line in r.iter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        j = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    delta = ((j.get("choices") or [{}])[0]).get("delta") or {}
                    if delta.get("content"):
                        content_parts.append(delta["content"])
                        on_delta(delta["content"])
                    for tcf in delta.get("tool_calls") or []:
                        slot = tc_acc.setdefault(tcf.get("index", 0), {"name": "", "args": ""})
                        fn = tcf.get("function") or {}
                        if fn.get("name"):
                            slot["name"] += fn["name"]
                        if fn.get("arguments"):
                            slot["args"] += fn["arguments"]
    except httpx.HTTPError:
        return _chat_completion(db, model_key, messages, tools, on_delta=None)  # 流式失败回落非流式
    calls = []
    for slot in tc_acc.values():
        if slot["name"]:
            try:
                args = json.loads(slot["args"] or "{}")
            except json.JSONDecodeError:
                args = {}
            calls.append({"name": slot["name"], "args": args})
    return {"content": "".join(content_parts) or None, "tool_calls": calls}


# ---------- 挂载 → tools schema ----------

def _build_tools(db: Session, cfg: dict) -> tuple[list[dict], dict, dict]:
    """返回 (tools, dispatch 元信息, 解析留痕)。

    留痕（SDD A-09）：每个挂载解析到的真实资源 id + 版本；查不到的记 missing。
    """
    tools: list[dict] = []
    meta: dict[str, tuple[str, str]] = {}
    resolved: dict[str, list[dict]] = {"tools": [], "workflows": [], "knowledges": [], "missing": []}
    for tname in cfg.get("tools", []):
        tool = db.get(Tool, tname) or db.execute(select(Tool).where(Tool.name == tname)).scalars().first()
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
        wf = db.get(Workflow, wname) or db.execute(select(Workflow).where(Workflow.name == wname)).scalars().first()
        if not wf:
            resolved["missing"].append({"kind": "workflow", "name": wname})
            continue
        tools.append({"type": "function", "function": {
            "name": f"workflow_{wf.id}", "description": f"执行工作流：{wf.name}",
            "parameters": {"type": "object", "properties": {"input": {"type": "object"}}}}})
        meta[f"workflow_{wf.id}"] = ("workflow", wf.id)
        resolved["workflows"].append({"name": wname, "id": wf.id})
    for kname in cfg.get("knowledges", []):
        ks = db.get(KnowledgeSource, kname) or db.execute(select(KnowledgeSource).where(KnowledgeSource.name == kname)).scalars().first()
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

def _autonomous_loop(db: Session, agent, run: Run, run_input: dict, call_chain: list[str]) -> None:
    cfg = agent.config or {}
    from .agent_release import build_common_config_dict
    # 版本运行注入 __common；草稿运行从当前 config 现算（SDD B-05 两种路径都真消费）
    common = cfg.get("__common") or build_common_config_dict(cfg)
    ctx = _Ctx(db, run, run_input, call_chain)
    skills = cfg.get("skills", []) or []
    system = (cfg.get("rolePrompt") or "") + "\n## 挂载技能\n" + "\n".join(f"- {s}" for s in skills)
    memories_declared = common.get("memories") or []
    if memories_declared:
        # R1 修复：description 一并注入（此前只写不读）
        lines = "\n".join(f"- {m.get('name')}（{m.get('dataType', 'STRING')}"
                          + (f"：{m.get('description')}" if m.get("description") else "")
                          + (f"，默认 {m.get('defaultValue')}" if m.get("defaultValue") else "") + "）"
                          for m in memories_declared)
        system += f"\n## 可用记忆变量（仅可读写以下已声明键）\n{lines}"

    # 闲聊兜底（SDD B-05）：无用户问题且已启用 → 直接兜底回复
    chitchat = (common.get("conversation") or {}).get("chitchatFallback") or {}
    if chitchat.get("enabled") and not str(run_input.get("userQuery") or "").strip():
        prompt = chitchat.get("prompt") or "你是友好的助手，请与用户打招呼。"
        answer, _t = _fallback_answer(db, chitchat.get("modelId") or (cfg.get("modelRef") or {}).get("modelId") or "qwen-plus", prompt)
        run.output = {"content": answer, "fallback": "chitchat"}
        run.status = "succeeded"
        run.ended_at = datetime.now(timezone.utc)
        db.commit()
        emit(db, run.id, "agent_completed", payload={"content": answer[:2000], "fallback": "chitchat"})
        return

    # D-2：历史轮次真消费——预览传入 chatHistory，按 historyTurns 裁剪
    model_ref = cfg.get("modelRef") or {}
    history_turns = int(model_ref.get("historyTurns") or 5)
    messages = [{"role": "system", "content": system}]
    chat_history = run_input.get("chatHistory") or []
    if isinstance(chat_history, list):
        for turn in chat_history[-history_turns:]:
            if isinstance(turn, dict):
                if turn.get("user"):
                    messages.append({"role": "user", "content": str(turn["user"])[:2000]})
                if turn.get("ai"):
                    messages.append({"role": "assistant", "content": str(turn["ai"])[:2000]})
    user_msg = {k: v for k, v in run_input.items() if k not in ("chatHistory", "__modelOverride")}
    messages.append({"role": "user", "content": json.dumps(user_msg, ensure_ascii=False)})
    tools, meta, resolved = _build_tools(db, cfg)
    # SDD A-09：挂载解析留痕（含失效项），运行可审计实际用到的资源与版本
    emit(db, run.id, "agent_mounts_resolved", payload=resolved)
    # D-2：模型对比覆盖 + 生成多样性→temperature 真消费
    model = str(run_input.get("__modelOverride") or "") or model_ref.get("modelId") or "qwen-plus"
    temperature = {"rigorous": 0.2, "balanced": 0.7, "creative": 1.1}.get(
        str(model_ref.get("diversity") or "balanced"), 0.7)
    declared_keys = {m.get("name") for m in memories_declared}
    memory: dict[str, str] = {}
    t0 = time.time()
    steps = 0
    while steps < MAX_STEPS and (time.time() - t0) < MAX_SECONDS:
        steps += 1
        resp = _chat_completion(db, model, messages, tools,
                                on_delta=lambda d: emit(db, run.id, "llm_delta", payload={"delta": d}),
                                temperature=temperature)
        if not resp["tool_calls"]:
            content = resp["content"] or ""
            output = {"content": content}
            follow = _maybe_follow_up(db, common, model, content)
            if follow:
                output["followUps"] = follow
            run.output = output
            run.status = "succeeded"
            run.ended_at = datetime.now(timezone.utc)
            db.commit()
            emit(db, run.id, "agent_completed", payload={"content": content[:2000]})
            return
        messages.append({"role": "assistant", "content": resp["content"] or "",
                         "tool_calls": [{"id": str(i), "type": "function",
                                         "function": {"name": c["name"], "arguments": json.dumps(c["args"], ensure_ascii=False)}}
                                        for i, c in enumerate(resp["tool_calls"])]})
        for i, tc in enumerate(resp["tool_calls"]):
            kind, rid = meta.get(tc["name"], ("unknown", ""))
            emit(db, run.id, "tool_call", payload={"name": tc["name"], "args": tc["args"]})
            result = _dispatch(db, ctx, kind, rid, tc["args"], run_input, call_chain, memory, declared_keys)
            emit(db, run.id, "tool_result", payload={"name": tc["name"], "result": str(result)[:500]})
            messages.append({"role": "tool", "tool_call_id": str(i),
                             "content": json.dumps(result, ensure_ascii=False)[:4000]})
    run.status = "failed"
    run.error = {"message": f"超过护栏（steps={MAX_STEPS} / {MAX_SECONDS}s）"}
    run.ended_at = datetime.now(timezone.utc)
    db.commit()
    emit(db, run.id, "agent_failed", payload={"error": run.error["message"]})


def _fallback_answer(db: Session, model_key: str, prompt: str) -> tuple[str, dict]:
    """闲聊兜底单独调用（无工具）。"""
    from .runner import _call_model
    try:
        return _call_model(db, model_key, prompt)
    except Exception:  # noqa: BLE001
        return "你好，我在。", {}


def _maybe_follow_up(db: Session, common: dict, model_key: str, content: str) -> list[str]:
    """自动续问（SDD B-05）：终答后生成 ≤count 条后续问题。"""
    fu = (common.get("conversation") or {}).get("autoFollowUp") or {}
    if not fu.get("enabled"):
        return []
    count = min(int(fu.get("count") or 3), 3)
    from .runner import _call_model
    try:
        answer, _t = _call_model(db, model_key,
                                 f"基于以下回答，用中文生成{count}个简短的后续追问，每行一个，不要编号：\n{content[:600]}")
        lines = [ln.strip() for ln in (answer or "").splitlines() if ln.strip()]
        return lines[:count] or []
    except Exception:  # noqa: BLE001
        return []


def ctx_agent_config(ctx: _Ctx) -> dict | None:
    """运行上下文中取 Agent 配置（知识高级配置等消费用；工作流运行无 Agent 时返回 None）。"""
    if ctx.run.agent_id:
        a = ctx.db.get(Agent, ctx.run.agent_id)
        if a:
            return a.config or {}
    return None


def _dispatch(db: Session, ctx: _Ctx, kind: str, rid: str, args: dict, run_input: dict,
              call_chain: list[str], memory: dict[str, str], declared_keys: set | None = None) -> dict:
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
        # SDD D-1 / R1：知识高级配置（TopK/匹配分/检索模式）真消费
        adv = ((ctx_agent_config(ctx) or {}).get("knowledgeAdvanced") or {}).get(rid) or {}
        top_k = int(adv.get("topK") or 3)
        slices = search_knowledge(db, rid, str(args.get("query", "")), top_k, mode=str(adv.get("mode") or "HYBRID"))
        threshold = adv.get("scoreThreshold")
        if threshold is not None:
            try:
                slices = [s for s in slices if float(s.get("score", 1)) >= float(threshold)]
            except (TypeError, ValueError):
                pass
        return {"slices": slices}
    if kind == "memory_write":
        key = str(args.get("key", ""))
        # SDD B-05：记忆写入必须是显式动作且键必须在已声明的记忆 Schema 内
        if declared_keys is not None and key not in declared_keys:
            return {"ok": False, "error": f"记忆变量 {key} 未在记忆 Schema 中声明"}
        memory[key] = str(args.get("value", ""))
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
    # SDD B：父运行按版本执行时，成员优先使用发布时冻结的成员版本；无则回退草稿并留痕
    member_version = (getattr(ctx, "frozen_agent_versions", None) or {}).get(member.id)
    if getattr(ctx, "frozen_agent_versions", None) and not member_version:
        emit(ctx.db, ctx.run.id, "member_unfrozen", payload={"memberId": member.id})
    t0 = time.time()
    sub_run = run_agent(ctx.db, member, ctx.run_input, trigger="agent",
                        agent_chain=agent_chain, call_chain_wf=wf_chain, enqueue=False,
                        version_id=member_version)
    fresh = ctx.db.get(Run, sub_run)
    latency = int((time.time() - t0) * 1000)
    # E-3.3：子 Run 作为调用记录挂到当前节点（target=子 run id），/trace 据此递归展开子树
    call = getattr(ctx, "call", None)
    if callable(call):
        try:
            call("agent", sub_run, f"member:{member.name}",
                 str((fresh.output or {}).get("content", ""))[:200], latency, fresh.token_usage or {})
        except Exception:  # noqa: BLE001 —— 观测失败不影响主流程
            pass
    if fresh.status != "succeeded":
        raise RunError(f"成员 Agent「{member.name}」执行失败：{(fresh.error or {}).get('message', fresh.status)}")
    return {"content": (fresh.output or {}).get("content", json.dumps(fresh.output or {}, ensure_ascii=False))}


# ---------- 统一入口（SDD A-03：顶层异步入队，嵌套保持同步） ----------

def _canary_bucket(run_id: str) -> int:
    """E-2.3：run_id → 0-99 稳定桶（md5 取模，跨进程一致）。"""
    import hashlib
    return int(hashlib.md5(run_id.encode()).hexdigest(), 16) % 100


def run_agent(db: Session, agent: Agent, run_input: dict, trigger: str = "agent",
              agent_chain: list[str] | None = None, call_chain_wf: list[str] | None = None,
              enqueue: bool = True, version_id: str | None = None) -> str:
    """返回 run_id。enqueue=True 时创建 Run 后立即返回，由 worker 执行；
    嵌套调用（成员 Agent/子工作流）必须 enqueue=False 保持顺序。
    SDD B-03 运行认版本：version_id 显式指定；schedule/api 默认沙箱已发布版本。"""
    from .models import AgentVersion, JobQueue
    chain = list(agent_chain or [])
    if agent.id in chain:
        raise RunError(f"检测到 Agent 递归调用：{agent.id}")
    run_id = new_id()
    ver: AgentVersion | None = None
    canary_hit = False
    if version_id:
        ver = db.get(AgentVersion, version_id)
        if not ver or ver.agent_id != agent.id:
            raise RunError(f"version {version_id} not found for agent {agent.id}")
    elif trigger in ("schedule", "api"):
        vid = agent.sandbox_version_id or agent.prod_version_id
        if not vid:
            raise RunError("NO_RELEASED_VERSION：该 Agent 尚未发布，请先发布到沙箱或线上")
        # E-2.3 灰度：同环境存在灰度 release 时，按 run_id 稳定哈希落桶选 canary/稳定
        env = "sandbox" if agent.sandbox_version_id else "prod"
        canary = next((r for r in db.query(Release)
                       .filter_by(agent_id=agent.id, environment=env, status="active").all()
                       if (r.canary_percent or 0) > 0), None)
        if canary and _canary_bucket(run_id) < (canary.canary_percent or 0):
            cv = db.get(AgentVersion, canary.agent_version_id)
            if cv:
                ver, canary_hit = cv, True
        if ver is None:
            ver = db.get(AgentVersion, vid)
            if not ver:
                raise RunError("NO_RELEASED_VERSION：发布版本记录丢失，请重新发布")
    run = Run(id=run_id, agent_id=agent.id, workflow_id=agent.workflow_id, trigger=trigger, input=run_input or {},
              agent_version_id=ver.id if ver else None,
              definition_source="version" if ver else "draft")
    db.add(run)
    db.commit()
    emit(db, run.id, "agent_started", payload={"agentId": agent.id, "type": agent.type,
                                               "agentVersion": ver.version_no if ver else None,
                                               **({"canary": True} if canary_hit else {})})
    if agent.type != "autonomous" and not agent.workflow_id and not ver:
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
    if run.started_at is None:  # E-3.4：Agent 运行此前从不记开始时间（时间轴/首 token 失真）
        run.started_at = datetime.now(timezone.utc)
        db.commit()
    if agent.type == "autonomous":
        if run.agent_version_id:
            from types import SimpleNamespace

            from .models import AgentVersion
            av = db.get(AgentVersion, run.agent_version_id)
            # 版本快照即配置（02 §2.5）：definition 顶层即 autonomous 配置键
            cfg = {**(av.definition or {}), "__common": av.common_config or {}}
            proxy = SimpleNamespace(id=agent.id, type=agent.type, workflow_id=agent.workflow_id, config=cfg)
            _autonomous_loop(db, proxy, run, run_input, chain)
        else:
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
