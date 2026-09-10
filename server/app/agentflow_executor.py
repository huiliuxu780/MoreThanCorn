"""AgentFlow 控制面编排（审核 P0-1 返工版）。

执行 = 运行时官方 PipelineProtocol 实现（/mtc/flow-run：ChatService 节点执行 +
structured_run_core + GoalPipeline）。本模块只做：
- Release/版本解析与节点运行时绑定；
- 单次 flow-run 调用（无轮询、无 sleep）；
- 控制面记录（run/node_run/Session 索引）；
- 选择性重跑：计算目标节点+下游 stale 集合，以上游最新成功输出为输入重执行，
  并重算 Flow 总输出与终态。
"""
from __future__ import annotations

import hashlib
import secrets as _secrets
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from . import agent_execution as ex
from . import agentscope_client as rt
from .models import (
    Agent,
    AgentFlowNodeRun,
    AgentFlowRelease,
    AgentFlowRun,
    AgentFlowVersion,
    AgentSessionIndex,
)


def resolve_agentflow_release(
    db: Session,
    *,
    release_id: str | None = None,
    definition_id: str | None = None,
    environment: str | None = None,
) -> AgentFlowRelease:
    """THE one AgentFlow release resolution (P0-05).

    Manual runs, automations and agent Tool callbacks all resolve through
    this function.  ``definition_id`` walks the correct chain
    definition → AgentFlowVersion → active AgentFlowRelease — it is NEVER
    treated as a version id.  ``environment`` filters when given (flow
    releases currently publish to sandbox by default, so it stays optional
    until the product defines flow environments).
    """
    if release_id:
        release = db.get(AgentFlowRelease, release_id)
        if release is None or release.status != "active":
            raise ValueError(
                f"agentflow release {release_id} not found or not active"
            )
        return release
    if not definition_id:
        raise ValueError("release_id or definition_id required")
    query = (
        db.query(AgentFlowRelease)
        .join(AgentFlowVersion, AgentFlowVersion.id == AgentFlowRelease.version_id)
        .filter(
            AgentFlowVersion.definition_id == definition_id,
            AgentFlowRelease.status == "active",
        )
    )
    if environment:
        query = query.filter(AgentFlowRelease.environment == environment)
    release = query.order_by(AgentFlowRelease.created_at.desc()).first()
    if release is None:
        raise ValueError(
            f"agentflow definition {definition_id} has no active release"
            + (f" in environment {environment}" if environment else "")
        )
    return release


def _topo_order(node_ids: list[str], edges: list[dict]) -> list[str]:
    indeg = {i: 0 for i in node_ids}
    adj: dict[str, list[str]] = {i: [] for i in node_ids}
    for e in edges:
        if e.get("from") in adj and e.get("to") in indeg:
            adj[e["from"]].append(e["to"])
            indeg[e["to"]] += 1
    queue = [i for i in node_ids if indeg[i] == 0]
    order: list[str] = []
    while queue:
        cur = queue.pop(0)
        order.append(cur)
        for nxt in adj[cur]:
            indeg[nxt] -= 1
            if indeg[nxt] == 0:
                queue.append(nxt)
    return order


def _downstream(node_id: str, edges: list[dict]) -> set[str]:
    adj: dict[str, list[str]] = {}
    for e in edges:
        adj.setdefault(e.get("from", ""), []).append(e.get("to", ""))
    seen: set[str] = set()
    stack = [node_id]
    while stack:
        cur = stack.pop()
        for nxt in adj.get(cur, []):
            if nxt not in seen:
                seen.add(nxt)
                stack.append(nxt)
    return seen


def _node_runtime_binding(db: Session, uid: str, agent_id: str) -> tuple[str, dict]:
    agent = db.get(Agent, agent_id)
    if agent is None:
        raise ValueError(f"node agent {agent_id} not found")
    runtime_id, release = ex.resolve_runtime_agent(db, uid, agent, environment="prod")
    # P0-02: AgentFlow nodes use the SAME release-snapshot model resolution as
    # chat/fresh run/schedule — no live-default drift.
    model_cfg = ex.chat_model_config_for_release(db, uid, release)
    manifest = ex.manifest_for_release(release)
    frozen_kbs = manifest.get("_frozen_knowledges") or {}
    knowledge_ids = [
        (frozen_kbs.get(kid) or {}).get("runtime_kb_id")
        for kid in (manifest.get("knowledge_ids") or [])
    ]
    return runtime_id, {
        "chat_model_config": model_cfg,
        # P0-01: only REAL AgentScope KB ids cross the boundary
        "knowledge_ids": [k for k in knowledge_ids if k and not k.startswith("kb_")],
    }


def _build_flow_body(
    db: Session,
    uid: str,
    definition: dict,
    flow_input: dict,
    only: list[str] | None = None,
) -> dict:
    nodes = definition.get("nodes") or []
    edges = definition.get("edges") or []
    if only:
        nodes = [n for n in nodes if n.get("id") in set(only)]
        keep = {n.get("id") for n in nodes}
        edges = [e for e in edges if e.get("from") in keep and e.get("to") in keep]
    body_nodes = []
    for n in nodes:
        runtime_id, extra = _node_runtime_binding(db, uid, n.get("agent_id", ""))
        body_nodes.append(
            {
                "id": n.get("id"),
                "agent_id": runtime_id,
                "prompt_template": n.get("prompt_template", ""),
                "structured_schema": n.get("structured_schema"),
                **extra,
            }
        )
    return {
        "user_id": uid,
        "nodes": body_nodes,
        "edges": edges,
        "flow_input": flow_input,
        "goal": definition.get("goal"),
    }


def _record_nodes(
    db: Session,
    run: AgentFlowRun,
    definition: dict,
    result: dict,
    attempt_base: dict[str, int] | None = None,
    runtime_map: dict[str, str] | None = None,
) -> None:
    node_defs = {n.get("id"): n for n in definition.get("nodes") or []}
    for nr in result.get("nodes") or []:
        nid = nr.get("id")
        attempt = (attempt_base or {}).get(nid, 0) + 1
        row = AgentFlowNodeRun(
            run_id=run.id,
            node_id=nid,
            attempt=attempt,
            agent_id=(node_defs.get(nid) or {}).get("agent_id"),
            session_id=nr.get("session_id"),
            status=nr.get("status"),
            input_version=attempt,
            output=nr.get("output") if isinstance(nr.get("output"), dict) else (
                {"text": nr.get("output")} if nr.get("output") is not None else None
            ),
            error=nr.get("error") or "",
            started_at=datetime.now(timezone.utc),
            ended_at=datetime.now(timezone.utc),
        )
        db.add(row)
        if nr.get("session_id"):
            db.add(
                AgentSessionIndex(
                    session_id=nr["session_id"],
                    user_id="system",
                    agent_id=(node_defs.get(nid) or {}).get("agent_id") or "",
                    runtime_agent_id=(runtime_map or {}).get(nid),
                    trigger_kind="agentflow",
                    agentflow_run_id=run.id,
                    agentflow_node_run_id=row.id,
                )
            )
    db.commit()


def _latest_outputs(db: Session, run_id: str) -> dict[str, Any]:
    rows = (
        db.query(AgentFlowNodeRun)
        .filter_by(run_id=run_id, status="succeeded")
        .order_by(AgentFlowNodeRun.attempt.desc())
        .all()
    )
    out: dict[str, Any] = {}
    for r in rows:
        out.setdefault(r.node_id, r.output)
    return out


def start_run(
    db: Session,
    user_id: str,
    release: AgentFlowRelease,
    flow_input: dict,
    *,
    trigger_kind: str = "manual",
    automation_id: str | None = None,
    parent_session_id: str | None = None,
) -> AgentFlowRun:
    version = db.get(AgentFlowVersion, release.version_id)
    definition = version.definition or {}
    # P0-08: flow-run 级内部 Tool 回调令牌——节点 Session 由运行时创建，
    # 令牌绑定整个 run（哈希落库），运行时为每个节点 Session 登记原文。
    run_token = _secrets.token_urlsafe(32)
    run = AgentFlowRun(
        release_id=release.id,
        trigger_kind=trigger_kind,
        status="running",
        input=flow_input,
        automation_id=automation_id,
        parent_session_id=parent_session_id,
        run_token_hash=hashlib.sha256(run_token.encode()).hexdigest(),
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    body = _build_flow_body(db, user_id, definition, flow_input)
    body["internal_token"] = run_token
    body["agentflow_run_id"] = run.id
    runtime_map = {n["id"]: n["agent_id"] for n in body["nodes"]}
    try:
        result = rt.flow_run(body)
    except Exception as exc:  # noqa: BLE001
        run.status = "failed"
        run.error = repr(exc)
        run.ended_at = datetime.now(timezone.utc)
        db.commit()
        return run
    _record_nodes(db, run, definition, result, runtime_map=runtime_map)
    run.status = result.get("status", "failed")
    run.output = result.get("output")
    run.error = "" if run.status == "succeeded" else "node failed"
    run.ended_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(run)
    return run


def rerun_node(db: Session, user_id: str, run_id: str, node_id: str) -> AgentFlowNodeRun:
    """选择性重跑（审核 P0-1）：目标+下游 stale，上游最新成功输出为输入，
    重算 Flow 总输出与终态。"""
    run = db.get(AgentFlowRun, run_id)
    if run is None:
        raise ValueError("run not found")
    release = db.get(AgentFlowRelease, run.release_id)
    version = db.get(AgentFlowVersion, release.version_id)
    definition = version.definition or {}
    edges = definition.get("edges") or []
    stale = {node_id} | _downstream(node_id, edges)
    order = [i for i in _topo_order([n.get("id") for n in definition.get("nodes") or []], edges) if i in stale]
    upstream = {k: v for k, v in _latest_outputs(db, run_id).items() if k not in stale}
    flow_input = {**(run.input or {}), **upstream}
    attempts = {
        r.node_id: r.attempt
        for r in db.query(AgentFlowNodeRun).filter_by(run_id=run_id).all()
    }
    body = _build_flow_body(db, user_id, definition, flow_input, only=order)
    runtime_map = {n["id"]: n["agent_id"] for n in body["nodes"]}
    result = rt.flow_run(body)
    _record_nodes(db, run, definition, result, attempt_base=attempts, runtime_map=runtime_map)
    # 重算总输出与终态
    merged = {**upstream, **(result.get("output") or {})}
    run.output = merged
    run.status = result.get("status", "failed")
    run.error = "" if run.status == "succeeded" else "node failed"
    run.ended_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(run)
    return (
        db.query(AgentFlowNodeRun)
        .filter_by(run_id=run_id, node_id=node_id)
        .order_by(AgentFlowNodeRun.attempt.desc())
        .first()
    )
