"""Thin HTTP client for the MoreThanCorn Agent Runtime (AgentScope 2.0.8).

The runtime is the single source of truth for AgentRecord/Session/
messages/AgentState/Schedule/Skill/MCP/Knowledge/Workspace. This client
only proxies and adapts; it never caches runtime state as a second
truth (docs/v2-design/13 §3).
"""
from __future__ import annotations

import json
import os
from typing import Any, Iterator

import httpx

RUNTIME_URL = os.environ.get("MTC_RUNTIME_URL", "http://127.0.0.1:8301")
DEFAULT_TIMEOUT = 120.0


class RuntimeError_(Exception):
    def __init__(self, status: int, detail: Any) -> None:
        super().__init__(f"runtime {status}: {detail}")
        self.status = status
        self.detail = detail


def _client(user_id: str, timeout: float = DEFAULT_TIMEOUT) -> httpx.Client:
    return httpx.Client(
        base_url=RUNTIME_URL,
        headers={"X-User-ID": user_id},
        timeout=timeout,
    )


def _raise(r: httpx.Response) -> httpx.Response:
    if r.status_code >= 400:
        try:
            detail = r.json()
        except Exception:  # noqa: BLE001
            detail = r.text[:300]
        raise RuntimeError_(r.status_code, detail)
    return r


def health(user_id: str = "system") -> dict:
    with _client(user_id, timeout=5) as c:
        return _raise(c.get("/health")).json()


# --- credentials / models -------------------------------------------------

def ensure_credential(user_id: str, kind: str, api_key: str, base_url: str) -> str:
    """Create (or reuse by deterministic name) a runtime credential."""
    with _client(user_id) as c:
        r = _raise(
            c.post(
                "/credential/",
                json={
                    "data": {
                        "type": kind,
                        "api_key": api_key,
                        "base_url": base_url,
                    }
                },
            )
        )
        return r.json()["credential_id"]


def list_credentials(user_id: str) -> list[dict]:
    with _client(user_id) as c:
        return _raise(c.get("/credential/")).json()


# --- agents ----------------------------------------------------------------

def create_agent(user_id: str, name: str, system_prompt: str, **cfg: Any) -> str:
    with _client(user_id) as c:
        body: dict[str, Any] = {"name": name, "system_prompt": system_prompt}
        if cfg.get("react_config"):
            body["react_config"] = cfg["react_config"]
        if cfg.get("context_config"):
            body["context_config"] = cfg["context_config"]
        return _raise(c.post("/agent/", json=body)).json()["agent_id"]


def update_agent(user_id: str, agent_id: str, **patch: Any) -> dict:
    with _client(user_id) as c:
        return _raise(c.patch(f"/agent/{agent_id}", json=patch)).json()


def get_agent(user_id: str, agent_id: str) -> dict:
    """The official app exposes no single-agent GET; filter the list."""
    with _client(user_id) as c:
        data = _raise(c.get("/agent/")).json()
        for row in data.get("agents", []):
            if row.get("id") == agent_id:
                return row
        raise RuntimeError_(404, f"agent {agent_id} not found")


# --- sessions --------------------------------------------------------------

def create_session(
    user_id: str,
    agent_id: str,
    chat_model_config: dict,
    knowledge_base_ids: list[str] | None = None,
    internal_token: str | None = None,
) -> str:
    """Create a fresh session; ``internal_token`` (P0-08) is the per-session
    callback credential the runtime must present on internal Tool calls."""
    body: dict[str, Any] = {
        "agent_id": agent_id,
        "chat_model_config": chat_model_config,
        "knowledge_base_ids": knowledge_base_ids or [],
    }
    if internal_token:
        body["internal_token"] = internal_token
    with _client(user_id) as c:
        return _raise(c.post("/mtc/session", json=body)).json()["session_id"]


def group_session(user_id: str, body: dict, timeout: float = 60.0) -> dict:
    """Group 装配（Spec group-capability §4.2）：/mtc/group-session 串行五步。

    返回 {runtime_team_id, leader_session_id, member_sessions[]}。
    internal_token 为群会话令牌（run_token 同款共享先例），平台存哈希入索引。
    """
    with _client(user_id, timeout=httpx.Timeout(timeout)) as c:
        return _raise(c.post("/mtc/group-session", json=body)).json()


def chat_trigger(
    user_id: str, agent_id: str, session_id: str, text: str
) -> dict:
    with _client(user_id) as c:
        return _raise(
            c.post(
                "/chat/",
                json={
                    "agent_id": agent_id,
                    "session_id": session_id,
                    "input": {
                        "role": "user",
                        "name": user_id,
                        "content": [{"type": "text", "text": text}],
                    },
                },
            )
        ).json()


def delete_session(user_id: str, agent_id: str, session_id: str) -> dict:
    """永久删除运行时 Session 及其状态（对话任务删除；官方 DELETE /sessions/{id}）。

    运行时返回 204 无正文——不解析 body，只确认状态码成功。
    """
    with _client(user_id) as c:
        r = c.delete(f"/sessions/{session_id}", params={"agent_id": agent_id})
        if r.status_code >= 400:
            _raise(r)
        return {"deleted": True, "status_code": r.status_code}


def chat_confirm(
    user_id: str,
    agent_id: str,
    session_id: str,
    reply_id: str,
    tool_calls: list[dict],
    confirmed: bool = True,
) -> dict:
    """HITL 恢复（P0-H 09-10）：对 awaiting_permission 的回复提交
    UserConfirmResultEvent（官方 /chat/ input 联合类型之一）。

    tool_calls 为 RequireUserConfirmEvent 携带的 ToolCallBlock 列表，
    原样回传（confirmed=True 批准 / False 拒绝）。不伪造、不跳过门禁。
    """
    with _client(user_id) as c:
        return _raise(
            c.post(
                "/chat/",
                json={
                    "agent_id": agent_id,
                    "session_id": session_id,
                    "input": {
                        "type": "USER_CONFIRM_RESULT",
                        "reply_id": reply_id,
                        "confirm_results": [
                            {"confirmed": confirmed, "tool_call": tc} for tc in tool_calls
                        ],
                    },
                },
            )
        ).json()


def structured_run(
    user_id: str,
    agent_id: str,
    input_text: str,
    schema: dict,
    chat_model_config: dict | None = None,
    session_id: str | None = None,
    timeout_seconds: float = 300.0,
) -> dict:
    with _client(user_id, timeout=timeout_seconds + 30) as c:
        return _raise(
            c.post(
                "/mtc/structured-run",
                json={
                    "agent_id": agent_id,
                    "session_id": session_id,
                    "chat_model_config": chat_model_config,
                    "input_text": input_text,
                    "schema": schema,
                    "timeout_seconds": timeout_seconds,
                },
            )
        ).json()


def flow_run(body: dict, timeout: float = 600.0) -> dict:
    """运行时官方 Pipeline 执行（/mtc/flow-run）。"""
    with _client(user_id="system", timeout=timeout) as c:
        return _raise(c.post("/mtc/flow-run", json=body)).json()


def flow_run_stream(body: dict, timeout: float = 900.0) -> Iterator[dict]:
    """运行时 SSE Pipeline 执行（/mtc/flows/run/stream, F0）。

    逐个产出解析后的 ``{"event": "stage:{nid}"|"flow:complete", "data": {...}}``
    事件，供平台在节点真正执行时增量落 NodeRun/SessionIndex（不再结束后一次性
    补写）。连接失败/非 2xx 抛 RuntimeError_。"""
    read_timeout = httpx.Timeout(timeout, read=timeout)
    with _client(user_id="system", timeout=read_timeout) as c:
        with c.stream("POST", "/mtc/flows/run/stream", json=body) as r:
            if r.status_code >= 400:
                _raise(r)
            for line in r.iter_lines():
                if not line.startswith("data: "):
                    continue
                try:
                    yield json.loads(line[len("data: "):])
                except json.JSONDecodeError:
                    continue


def script_run_stream(body: dict, timeout: float = 900.0) -> Iterator[dict]:
    """脚本编排 SSE 执行（/mtc/script-run, 16号稿 P1）。

    事件形状与 flow_run_stream 一致（stage:{label} + flow:complete，另含
    phase/log/needs_input 观测事件），平台消费代码零分叉。"""
    read_timeout = httpx.Timeout(timeout, read=timeout)
    with _client(user_id="system", timeout=read_timeout) as c:
        with c.stream("POST", "/mtc/script-run", json=body) as r:
            if r.status_code >= 400:
                _raise(r)
            for line in r.iter_lines():
                if not line.startswith("data: "):
                    continue
                try:
                    yield json.loads(line[len("data: "):])
                except json.JSONDecodeError:
                    continue


def script_resume(
    agentflow_run_id: str,
    request_id: str,
    value: Any = None,
    skipped: bool = False,
    timeout: float = 10.0,
) -> dict:
    """答复挂起的 askUser（/mtc/script-resume, 16号稿 P2）。"""
    with _client(user_id="system", timeout=timeout) as c:
        return _raise(
            c.post(
                "/mtc/script-resume",
                json={
                    "agentflow_run_id": agentflow_run_id,
                    "request_id": request_id,
                    "value": value,
                    "skipped": bool(skipped),
                },
            )
        ).json()


def session_messages(user_id: str, agent_id: str, session_id: str) -> dict:
    with _client(user_id) as c:
        return _raise(
            c.get(
                f"/sessions/{session_id}/messages",
                params={"agent_id": agent_id},
            )
        ).json()


def session_status(user_id: str, agent_id: str, session_id: str) -> dict:
    with _client(user_id) as c:
        return _raise(
            c.get(
                f"/sessions/{session_id}/status",
                params={"agent_id": agent_id},
            )
        ).json()


def sessions_status(user_id: str, triples: list[dict]) -> list[dict]:
    with _client(user_id) as c:
        return _raise(
            c.post("/mtc/sessions-status", json=triples)
        ).json()["sessions"]


def interrupt_session(user_id: str, agent_id: str, session_id: str) -> dict:
    with _client(user_id) as c:
        return _raise(
            c.post(
                f"/sessions/{session_id}/interrupt",
                params={"agent_id": agent_id},
            )
        ).json()


def stream_url(session_id: str, agent_id: str) -> str:
    return (
        f"{RUNTIME_URL}/sessions/{session_id}/stream?agent_id={agent_id}"
    )


# --- schedules -------------------------------------------------------------

def create_schedule(
    user_id: str,
    name: str,
    description: str,
    cron_expression: str,
    timezone: str,
    agent_id: str,
    chat_model_config: dict,
    stateful: bool = False,
    ended_at: str | None = None,
) -> str:
    body: dict[str, Any] = {
        "name": name,
        "description": description,
        "cron_expression": cron_expression,
        "timezone": timezone,
        "agent_id": agent_id,
        "chat_model_config": chat_model_config,
        "stateful": stateful,
    }
    if ended_at:
        body["ended_at"] = ended_at
    with _client(user_id) as c:
        return _raise(c.post("/schedule/", json=body)).json()["schedule_id"]


def patch_schedule(user_id: str, schedule_id: str, **patch: Any) -> dict:
    with _client(user_id) as c:
        return _raise(c.patch(f"/schedule/{schedule_id}", json=patch)).json()


def delete_schedule(user_id: str, schedule_id: str) -> None:
    with _client(user_id) as c:
        _raise(c.delete(f"/schedule/{schedule_id}"))


def schedule_sessions(user_id: str, schedule_id: str) -> list[dict]:
    with _client(user_id) as c:
        data = _raise(c.get(f"/schedule/{schedule_id}/sessions")).json()
        return data if isinstance(data, list) else data.get("sessions", [])


# --- workspace skills / mcp -------------------------------------------------

def upload_workspace_skill(
    user_id: str,
    agent_id: str,
    session_id: str,
    root: str,
    parts: list[tuple[str, bytes]],
) -> None:
    """把 Skill 内容上传进指定 Session 的 Workspace（官方 /workspace/skill/upload）。"""
    import json as _json

    manifest = _json.dumps(
        {"entries": [{"path": f"{root}/{name}", "size": len(data)} for name, data in parts]}
    )
    with _client(user_id) as c:
        _raise(
            c.post(
                "/workspace/skill/upload",
                params={"agent_id": agent_id, "session_id": session_id},
                data={"manifest": manifest},
                files=[("files", (name, data, "application/octet-stream")) for name, data in parts],
            )
        )


def workspace_skills(user_id: str, agent_id: str, session_id: str) -> list:
    with _client(user_id) as c:
        return _raise(
            c.get(
                "/workspace/skill",
                params={"agent_id": agent_id, "session_id": session_id},
            )
        ).json()


def add_workspace_mcp(
    user_id: str, agent_id: str, session_id: str, mcp: dict
) -> None:
    with _client(user_id) as c:
        _raise(
            c.post(
                "/workspace/mcp",
                params={"agent_id": agent_id, "session_id": session_id},
                json=mcp,
            )
        )


def workspace_mcps(user_id: str, agent_id: str, session_id: str) -> list:
    with _client(user_id) as c:
        return _raise(
            c.get(
                "/workspace/mcp",
                params={"agent_id": agent_id, "session_id": session_id},
            )
        ).json()


def mcp_library(user_id: str) -> list:
    with _client(user_id) as c:
        return _raise(c.get("/mcp")).json()


# --- knowledge --------------------------------------------------------------

def list_knowledge_bases(user_id: str) -> list[dict]:
    """Official GET /knowledge_bases/ — the only sanctioned KB lookup (P0-01)."""
    with _client(user_id) as c:
        data = _raise(c.get("/knowledge_bases/")).json()
        if isinstance(data, list):
            return data
        return data.get("knowledge_bases") or data.get("items") or []


def create_knowledge_base(
    user_id: str, name: str, embedding_model_config: dict
) -> str:
    with _client(user_id) as c:
        data = _raise(
            c.post(
                "/knowledge_bases/",
                json={
                    "name": name,
                    "embedding_model_config": embedding_model_config,
                },
            )
        ).json()
        return data.get("knowledge_base_id") or data.get("id")


def upload_knowledge_document(
    user_id: str, kb_id: str, filename: str, content: bytes
) -> str:
    with _client(user_id) as c:
        return _raise(
            c.post(
                f"/knowledge_bases/{kb_id}/documents",
                files=[("file", (filename, content, "text/plain"))],
            )
        ).json()["document_id"]


def knowledge_document_status(
    user_id: str, kb_id: str, doc_ids: list[str]
) -> list[dict]:
    with _client(user_id) as c:
        data = _raise(
            c.get(
                f"/knowledge_bases/{kb_id}/documents/status",
                params={"ids": ",".join(doc_ids)},
            )
        ).json()
        return data if isinstance(data, list) else data.get("items", [])


def search_knowledge_base(
    user_id: str, kb_id: str, query: str, limit: int = 5
) -> dict:
    with _client(user_id) as c:
        return _raise(
            c.post(
                f"/knowledge_bases/{kb_id}/search",
                json={"query": query, "limit": limit},
            )
        ).json()
