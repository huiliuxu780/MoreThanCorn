"""Agent 运行门面（AgentScope 换底，P0-07 返工版 2026-09-10）。

生产执行边界（任务书 §一）：
- 所有可执行 Agent（Module 与 custom）的唯一执行路径 = agent_execution 统一
  入口 → AgentScope Session；本模块只做 Release 解析（显式环境）、Run 业务链
  记录与结果结算转发（P0-B 09-10：custom Agent 一次性 run 不再拒绝）。
- Workflow 画布 agent/agent-select/agent-exec 节点族经 _run_member 委托
  _run_native_agent（Workflow 调度 Agent = 统一入口）。_route 语义路由是
  平台工具级模型调用，不产生 Agent Run/Session。
- _chat_completion 是平台工具级模型直连（draft-role 起草、Workflow LLM 节点、
  路由/分类），不属于 Agent 执行入口。
- 已退役删除（2026-09-10，历史实现经 Git 历史恢复）：自建 ReAct 循环族
  （_Ctx/_build_tools/_expand_mentions/build_mounted_skills_section/
  _autonomous_loop/_fallback_answer/_maybe_follow_up/ctx_agent_config/
  _dispatch/_latest_tv）与 worker 内联执行（_execute_agent_inline/
  execute_agent_job）。runner 对 agent-execution/chat-turn 作业 fail-stale。
"""
from __future__ import annotations

import json

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from .legacy_agent_archive import (LEGACY_ARCHIVED_CODE, assert_agent_executable,
                                   is_legacy_agent)
from .models import Agent, Connection, Model, ModelProvider, Run, new_id
from .runner import RunError, emit

# ---------- 平台工具级模型直连（非 Agent 执行入口） ----------

def _resolve_base_headers(db: Session, model_key: str) -> tuple[str, dict]:
    """R4：返回 (base, 鉴权请求头)。kind 真实生效（aksk/script 经签名层产出）。"""
    import os
    from .auth_signers import AuthSignError, build_auth_headers
    from .connection_runtime import resolve_for_request
    base = os.environ.get("WF_LLM_BASE_URL", "")
    secret = os.environ.get("WF_LLM_API_KEY", "")
    conn = None
    if not base:
        for m in db.execute(select(Model).where(Model.model_key == model_key)).scalars().all():
            prov = db.get(ModelProvider, m.provider_id)
            if prov and prov.base_url.startswith(("http://", "https://")):
                base = prov.base_url
                if prov.auth_connection_id:
                    conn = db.get(Connection, prov.auth_connection_id)
            break
    if secret:
        return base, {"Authorization": f"Bearer {secret}"}
    if conn is not None:
        _ep, payload, _code = resolve_for_request(conn)
        # 09-17 修：本路径只服务 OpenAI 兼容 chat/completions——kind=api_key 的
        # 通用签名头是 X-API-Key，DashScope 等兼容口只认 Bearer（此前 401 根因）。
        if conn.kind == "api_key":
            key = payload if isinstance(payload, str) else (
                (payload or {}).get("api_key") or (payload or {}).get("key") or "")
            if key:
                return base, {"Authorization": f"Bearer {key}"}
        try:
            return base, build_auth_headers(conn.kind, payload, script=conn.auth_script,
                                            env_vars=payload if isinstance(payload, dict) else None)
        except AuthSignError as exc:
            raise RunError(str(exc))
    return base, {}

def _resolve_base_secret(db: Session, model_key: str) -> tuple[str, str]:
    """返回 (base, secret 可用标记)。

    P0-07 修复：此前该函数根本不存在，而 runner._route_workflow/_llm_base 都
    import 它——ImportError 被 except 吞掉后工作流路由/LLM 节点静默降级，
    从未走过真实模型。解析顺序与 _resolve_base_headers 一致：
    env(WF_LLM_BASE_URL/WF_LLM_API_KEY) → Model→ModelProvider→Connection。
    secret 不返回明文凭据（调用方仅判断 base 可用性）；连接类凭据以非空
    占位标记。
    """
    import os
    base = os.environ.get("WF_LLM_BASE_URL", "")
    secret = os.environ.get("WF_LLM_API_KEY", "")
    if base:
        return base, secret
    for m in db.execute(select(Model).where(Model.model_key == model_key)).scalars().all():
        prov = db.get(ModelProvider, m.provider_id)
        if prov and prov.base_url.startswith(("http://", "https://")):
            base = prov.base_url
            if prov.auth_connection_id:
                conn = db.get(Connection, prov.auth_connection_id)
                if conn is not None:
                    secret = secret or "connection"  # 非明文占位：凭据存在
        break
    return base, secret


def _chat_completion(db: Session, model_key: str, messages: list[dict], tools: list[dict],
                     on_delta=None, temperature: float = 0.7) -> dict:
    """返回 {"content": str|None, "tool_calls": [{"name","args"}]}。
    on_delta 提供时走流式（SDD B-08），逐块回调文本增量；mock 模式整段一次回调。"""
    base, headers = _resolve_base_headers(db, model_key)
    if not base or not base.startswith(("http://", "https://")):
        from .config import is_production
        if is_production():
            # 09 §12 / M-03：生产缺模型必须失败，禁止 mock 对话/工具调用
            raise RunError("MODEL_UNAVAILABLE：生产环境未配置真实模型 Provider（禁止 mock）")
        last_user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
        has_tool_result = any(m["role"] == "tool" for m in messages)
        if tools and not has_tool_result:
            t = tools[0]
            return {"content": None, "tool_calls": [{"name": t["function"]["name"], "args": {"input": "ping"}}]}
        content = f"[mock:{model_key}] 已处理：{last_user[:200]}"
        if on_delta:
            on_delta(content)
        return {"content": content, "tool_calls": []}
    # 09 P0（审计反例 4）：Agent 模型调用出站统一过 Egress
    from .egress import EgressError, enforce_egress
    try:
        enforce_egress(base)
    except EgressError as exc:
        raise RunError(str(exc))
    body = {"model": model_key, "messages": messages, "temperature": temperature}
    if tools:
        body["tools"] = tools
    if on_delta is None:
        with httpx.Client(timeout=60) as client:
            r = client.post(f"{base.rstrip('/')}/chat/completions",
                            headers=headers, json=body)
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
                               headers=headers, json=body) as r:
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

# ---------- Workflow 画布 Agent 节点族（委托统一入口） ----------

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
        from .config import is_production
        if is_production():
            raise RunError("MODEL_UNAVAILABLE：生产环境 Agent 路由不可用（禁止 mock 首项）")
        return candidates[0], "mock"  # 非生产确定性回落，标记可观测
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
    # R-Archive：Workflow agent-exec 不能再发起旧 Agent Run（节点级失败，不产生子 Run）
    if is_legacy_agent(member):
        raise RunError(f"{LEGACY_ARCHIVED_CODE}：成员 Agent「{member.name}」已封存，仅支持历史查询")
    # call_chain 中 "agent:" 前缀项 = Agent 递归链，其余 = workflow 链
    agent_chain = [x[len("agent:"): ] for x in ctx.call_chain if x.startswith("agent:")]
    wf_chain = [x for x in ctx.call_chain if not x.startswith("agent:")]
    # SDD B：父运行按版本执行时，成员优先使用发布时冻结的成员版本；无则回退草稿并留痕
    member_version = (getattr(ctx, "frozen_agent_versions", None) or {}).get(member.id)
    if getattr(ctx, "frozen_agent_versions", None) and not member_version:
        emit(ctx.db, ctx.run.id, "member_unfrozen", payload={"memberId": member.id})
    # AgentScope 换底（2026-09-09 任务书 §五-E）：Workflow 的 Agent 节点委托
    # _run_native_agent（统一入口 + Run 业务链 + 结算），不再自建执行。
    sub_run_id = _run_native_agent(ctx.db, member, ctx.run_input, trigger="agent",
                                   version_id=member_version, provider_id=None,
                                   enqueue=False, agent_chain=agent_chain)
    fresh = ctx.db.get(Run, sub_run_id)
    if fresh is None or fresh.status != "succeeded":
        raise RunError(f"成员 Agent「{member.name}」执行失败："
                       f"{(fresh.error or {}).get('message', 'unknown') if fresh else 'missing'}")
    content = (fresh.output or {}).get("content", json.dumps(fresh.output or {}, ensure_ascii=False))
    return {"content": content, "output": fresh.output or {}}

# ---------- 统一入口门面（SDD A-03 签名兼容） ----------

def _canary_bucket(run_id: str) -> int:
    """E-2.3：run_id → 0-99 稳定桶（md5 取模，跨进程一致）。"""
    import hashlib
    return int(hashlib.md5(run_id.encode()).hexdigest(), 16) % 100

def _run_native_agent(db: Session, agent: Agent, run_input: dict, trigger: str,
                      version_id: str | None, provider_id: str | None, enqueue: bool,
                      agent_chain: list[str],
                      model_override: dict | None = None) -> str:
    """Agent 一次性运行（Module 与 custom 共用，P0-B 09-10）：
    显式环境解析 Release → Run 业务链 → 统一入口进 AgentScope（fresh Session）。

    P0-04/P0-07：运行只认发布快照，环境显式——
    - 显式 version_id：取包含该版本的 active Release 所在环境（显式版本=显式选择）；
    - 否则 prod（产品执行）；灰度 Release 按 run_id 稳定桶选择。
    enqueue/provider_id 为历史签名参数仅保兼容：执行总是内联同步进统一入口，
    Release 不再绑定 Provider。
    输出契约：Module Agent 用 Module outputSchema；custom Agent 用平台 content
    契约（{"content": string}）。Run=平台执行事实；agentscope_session_id=真实
    Session（上下文与事件载体），不伪造。
    """
    from .models import AgentVersion, Release
    if agent.id in agent_chain:
        raise RunError(f"检测到 Agent 递归调用：{agent.id}")
    run_id = new_id()
    if version_id:
        ver = db.get(AgentVersion, version_id)
        if not ver or ver.agent_id != agent.id:
            raise RunError(f"version {version_id} not found for agent {agent.id}")
        chosen = (db.query(Release)
                  .filter(Release.agent_id == agent.id,
                          Release.agent_version_id == ver.id,
                          Release.status == "active")
                  .order_by(Release.canary_percent.asc(), Release.created_at.desc())
                  .first())
        if chosen is None:
            raise RunError("NO_RELEASED_VERSION：该版本无 active Release，运行只认发布快照")
        environment = chosen.environment
    else:
        environment = "prod"
        releases = (db.query(Release)
                    .filter_by(agent_id=agent.id, environment="prod", status="active")
                    .all())
        if not releases:
            raise RunError(
                "NO_RELEASED_VERSION：该 Agent 无 active prod Release，"
                "请先发布（禁止跨环境静默降级）")
        stable = next((r for r in releases if not (r.canary_percent or 0)), None)
        canary = next((r for r in releases if (r.canary_percent or 0) > 0), None)
        chosen = (canary
                  if (canary and _canary_bucket(run_id) < (canary.canary_percent or 0))
                  else stable)
        if chosen is None:
            raise RunError("NO_RELEASED_VERSION：prod 仅有灰度 Release 且本 run 未命中灰度桶，"
                           "请发布稳定版")
    ver = db.get(AgentVersion, chosen.agent_version_id)
    if not ver:
        raise RunError("NO_RELEASED_VERSION：发布版本记录丢失，请重新发布")
    run = Run(id=run_id, agent_id=agent.id, trigger=trigger, input=run_input or {},
              agent_version_id=ver.id, definition_source="version")
    # 09-17 规则 Skill 化：开工冻结规则资产引用（「这单按哪版规则跑」可查）；fail-closed
    if agent.module_key:
        from . import rules_skills
        try:
            _rules, _ref = rules_skills.resolve_rules(db, agent)
        except rules_skills.RulesSkillMissing as exc:
            raise RunError(f"{exc.code}：{exc}") from exc
        if _ref:
            run.asset_refs = {"rules_skill": _ref}
    db.add(run)
    db.commit()
    emit(db, run.id, "agent_started",
         payload={"agentId": agent.id, "module": agent.module_key,
                  "moduleVersion": agent.module_version,
                  "agentVersion": ver.version_no,
                  "environment": environment, "releaseId": chosen.id})
    # AgentScope 换底（任务书 §五-C）：Module Agent 执行经统一入口进入
    # AgentScope Session（结构化输出用 Module outputSchema）；Run 仅作为
    # 业务链记录（TaskRun/QualityResult 关联），执行事实在 Session。
    from . import agent_execution as ex
    from .agent_modules import registry as module_registry

    schema = {"type": "object", "properties": {"content": {"type": "string"}},
              "required": ["content"]}
    if agent.module_key:
        try:
            schema = module_registry.get(agent.module_key, agent.module_version).output_schema
        except Exception:  # noqa: BLE001 —— schema 缺失回落 content 契约
            pass
    try:
        index, result = ex.run_structured(
            db,
            "platform-run",
            agent,
            json.dumps(run_input or {}, ensure_ascii=False)[:6000],
            schema,
            trigger_kind="manual" if trigger in ("manual", "test") else trigger,
            environment=environment,
            timeout_seconds=600,
            model_override=model_override,
        )
        # 09-18 端到端观测：run ↔ session 关联落库（金样本工具调用核对依赖）
        if not run.interaction_ref:
            run.interaction_ref = index.session_id
            db.commit()
    except Exception as exc:  # noqa: BLE001
        run.status = "failed"
        run.error = {"message": repr(exc)}
        db.commit()
        emit(db, run.id, "agent_failed", payload={"error": repr(exc)})
        return run.id
    run.status = "succeeded"
    run.output = result.get("structured_output") or {"content": result.get("text", "")}
    run.agentscope_session_id = index.session_id  # P0-07 语义适配层
    db.commit()
    # R3-4 业务结算（Schema 二次校验/CallRecord/QualityResult 链）——中立模块
    from types import SimpleNamespace

    from .run_settlement import settle_module_result
    settle_module_result(db, run, SimpleNamespace(trace=[], output=run.output))
    emit(db, run.id, "agent_completed",
         payload={"sessionId": index.session_id,
                  "outputKeys": sorted((run.output or {}).keys())})
    return run.id


def run_agent(db: Session, agent: Agent, run_input: dict, trigger: str = "agent",
              agent_chain: list[str] | None = None, call_chain_wf: list[str] | None = None,
              enqueue: bool = True, version_id: str | None = None,
              provider_id: str | None = None,
              model_override: dict | None = None) -> str:
    """返回 run_id。P0-07/P0-B：Agent 执行唯一生产路径 = AgentScope 统一入口。

    Module Agent 与 custom Agent 同走 _run_native_agent（Release 解析 → Run
    业务链 → ex.run_structured，fresh Session）。旧三类（autonomous/dialogue/
    expert-group）被 R-Archive 封存门拦截；归档 Agent 拒绝执行（AGENT_ARCHIVED）。
    enqueue/call_chain_wf/provider_id 为历史签名参数，仅保 API 兼容。
    """
    assert_agent_executable(agent)
    if bool(getattr(agent, "archived", False)):
        raise RunError(
            f"AGENT_ARCHIVED：Agent「{agent.name}」已归档并退出产品运行面，"
            "仅支持历史查询（P0-A 09-10）"
        )
    return _run_native_agent(db, agent, run_input, trigger, version_id,
                             provider_id, enqueue, agent_chain or [],
                             model_override)
