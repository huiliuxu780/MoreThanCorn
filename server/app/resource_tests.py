"""Resource Test Executors — 六类资源的连通性/可用性测试 + 健康度回写。

真实路径优先（配置了真实 endpoint/驱动时），否则 mock 回落 —— 与 LLM/Tool 现有策略一致。
测试失败只降健康度（error），不自动停用。
"""
from __future__ import annotations

import time
from datetime import datetime, timezone

import httpx
from fastapi import HTTPException
from sqlalchemy.orm import Session

from .models import (CallRecord, Connection, DataAsset, Datasource, KnowledgeSource,
                     McpServer, Model, Tool)
from .resource_registry import CLS, log_change
from .runner import RunError, _call_model, _decrypt, exec_tool

_MOCK_MCP_TOOLS = [
    {"name": "search_docs", "description": "搜索文档", "inputSchema": {"type": "object", "properties": {"q": {"type": "string"}}}},
    {"name": "read_doc", "description": "读取文档", "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}}}},
]


def _conn_endpoint(db: Session, cid: str | None) -> dict:
    if not cid:
        return {}
    c = db.get(Connection, cid)
    return (c.endpoint or {}) if c else {}


def _test_model(db: Session, obj: Model, _input: dict) -> dict:
    t0 = time.time()
    answer, tokens = _call_model(db, obj.model_key, "ping")
    return {"ok": True, "latencyMs": int((time.time() - t0) * 1000),
            "output": {"answer": answer[:200], "tokens": tokens}}


def _test_tool(db: Session, obj: Tool, payload: dict) -> dict:
    from .routers.admin import test_tool
    return test_tool(obj.id, payload or None, db)


def _test_mcp(db: Session, obj: McpServer, _input: dict) -> dict:
    t0 = time.time()
    if obj.transport == "http":
        base = _conn_endpoint(db, obj.connection_id).get("base_url", "")
        if base.startswith(("http://", "https://")):
            try:
                with httpx.Client(timeout=5) as client:
                    r = client.post(base, json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
                    r.raise_for_status()
                tools = _MOCK_MCP_TOOLS  # 握手成功；工具发现回落示例
            except Exception as exc:  # noqa: BLE001
                return {"ok": False, "error": f"MCP 握手失败：{exc}"}
        else:
            tools = _MOCK_MCP_TOOLS
    else:
        if not obj.command:
            return {"ok": False, "error": "缺少 stdio 启动命令"}
        tools = _MOCK_MCP_TOOLS
    obj.discovered_tools = tools
    db.commit()
    return {"ok": True, "latencyMs": int((time.time() - t0) * 1000),
            "output": {"tools": [t["name"] for t in tools]}}


def _test_knowledge(db: Session, obj: KnowledgeSource, payload: dict) -> dict:
    t0 = time.time()
    q = (payload or {}).get("query", "样例查询")
    url = (obj.source_config or {}).get("url", "")
    if url.startswith(("http://", "https://")):
        try:
            with httpx.Client(timeout=5) as client:
                r = client.post(url, json={"query": q, "topK": 3})
                r.raise_for_status()
            slices = (r.json() or {}).get("slices", [])
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"检索失败：{exc}"}
    else:
        slices = [{"text": f"[mock] 与「{q}」相关的切片 #{i}", "score": round(0.9 - i * 0.1, 2)} for i in range(3)]
    return {"ok": True, "latencyMs": int((time.time() - t0) * 1000),
            "output": {"slices": len(slices)}}


def _test_datasource(db: Session, obj: Datasource, _input: dict) -> dict:
    t0 = time.time()
    ep = _conn_endpoint(db, obj.connection_id)
    if obj.type in ("mysql", "postgresql"):
        host = ep.get("host", "")
        if host:
            driver = {"mysql": "pymysql", "postgresql": "psycopg"}[obj.type]
            try:
                mod = __import__(driver)
                if driver == "pymysql":
                    conn = mod.connect(host=host, port=int(ep.get("port", 3306)),
                                       user=ep.get("user", ""), password=_secret(db, obj.connection_id),
                                       database=obj.location, connect_timeout=5)
                    conn.close()
                else:
                    conn = mod.connect(host=host, port=int(ep.get("port", 5432)),
                                       user=ep.get("user", ""), password=_secret(db, obj.connection_id),
                                       dbname=obj.location)
                    conn.close()
                return {"ok": True, "latencyMs": int((time.time() - t0) * 1000), "output": {"check": "SELECT 1"}}
            except ImportError:
                pass  # 驱动未安装 → mock 回落
            except Exception as exc:  # noqa: BLE001
                return {"ok": False, "error": f"连接失败：{exc}"}
        return {"ok": True, "latencyMs": 21, "output": {"check": "SELECT 1 (mock)"}}
    if obj.type == "oss":
        bucket = ep.get("bucket", obj.location)
        return {"ok": bool(bucket), "error": "" if bucket else "缺少 bucket 配置",
                "latencyMs": int((time.time() - t0) * 1000), "output": {"list": "mock 10 objects"}}
    # http
    base = ep.get("base_url", "")
    if base.startswith(("http://", "https://")):
        try:
            with httpx.Client(timeout=5) as client:
                r = client.get(base)
                ok = r.status_code < 500
            return {"ok": ok, "error": "" if ok else f"HTTP {r.status_code}",
                    "latencyMs": int((time.time() - t0) * 1000), "output": {"status": r.status_code}}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"健康检查失败：{exc}"}
    return {"ok": True, "latencyMs": 18, "output": {"health": "mock ok"}}


def _secret(db: Session, cid: str | None) -> str:
    if not cid:
        return ""
    c = db.get(Connection, cid)
    return _decrypt(c.secret_ref) if c else ""


def _test_asset(db: Session, obj: DataAsset, _input: dict) -> dict:
    t0 = time.time()
    if obj.datasource_id:
        ds = db.get(Datasource, obj.datasource_id)
        if not ds:
            return {"ok": False, "error": "所属 Datasource 不存在"}
        base = _test_datasource(db, ds, {})
        if not base.get("ok"):
            return base
        rows = 10
    else:
        rows = min(len(obj.rows or []), 10)
    missing = [f for f in (obj.time_field,) if f and not (obj.rows or [{}])[0].get(f)] if (obj.rows or []) and obj.datasource_id is None else []
    ok = not missing
    return {"ok": ok, "error": "" if ok else f"时间字段缺失：{missing}",
            "latencyMs": int((time.time() - t0) * 1000),
            "output": {"sampled": rows}}


_EXEC = {"model": _test_model, "tool": _test_tool, "mcp": _test_mcp,
         "knowledge": _test_knowledge, "datasource": _test_datasource, "asset": _test_asset}


def search_knowledge(db: Session, ks_id: str, query: str, top_k: int = 5) -> list[dict]:
    """knowledge-retrieval 节点与测试共用的检索入口；无真实后端时 mock 切片。"""
    obj = db.get(KnowledgeSource, ks_id)
    if not obj:
        raise RunError(f"knowledge source {ks_id} not found")
    url = (obj.source_config or {}).get("url", "")
    if url.startswith(("http://", "https://")):
        try:
            with httpx.Client(timeout=5) as client:
                r = client.post(url, json={"query": query, "topK": top_k})
                r.raise_for_status()
            return (r.json() or {}).get("slices", [])
        except Exception as exc:  # noqa: BLE001
            raise RunError(f"知识检索失败：{exc}") from exc
    return [{"text": f"[mock:{obj.name}] 与「{query}」相关切片 #{i}", "score": round(0.9 - i * 0.1, 2)}
            for i in range(min(top_k, 3))]


def mcp_call_tool(db: Session, server_id: str, tool_name: str, args: dict) -> dict:
    """mcp-call 节点执行入口；无真实 endpoint 时 mock 结果。"""
    obj = db.get(McpServer, server_id)
    if not obj:
        raise RunError(f"mcp server {server_id} not found")
    if obj.status != "enabled":
        raise RunError(f"mcp server {obj.name} 已停用")
    if obj.transport == "http":
        base = _conn_endpoint(db, obj.connection_id).get("base_url", "")
        if base.startswith(("http://", "https://")):
            try:
                with httpx.Client(timeout=10) as client:
                    r = client.post(base, json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                                "params": {"name": tool_name, "arguments": args or {}}})
                    r.raise_for_status()
                return r.json()
            except Exception as exc:  # noqa: BLE001
                raise RunError(f"MCP 调用失败：{exc}") from exc
    return {"result": f"[mock mcp:{obj.name}] {tool_name} 执行成功", "args": args or {}}


def run_test(db: Session, rtype: str, rid: str, payload: dict | None = None, actor: str = "") -> dict:
    obj = db.get(CLS[rtype], rid)
    if not obj:
        raise HTTPException(404, "资源不存在")
    result = _EXEC[rtype](db, obj, payload or {})
    now = datetime.now(timezone.utc)
    if hasattr(obj, "health"):
        obj.health = "healthy" if result.get("ok") else "error"
    if hasattr(obj, "last_test_at"):
        obj.last_test_at = now
    if hasattr(obj, "last_check_at"):
        obj.last_check_at = now
    db.add(CallRecord(kind=rtype, target_type=rtype, target_id=rid,
                      request={"summary": str(payload or {})[:500]},
                      response={"summary": str(result.get("output", ""))[:500]},
                      status="success" if result.get("ok") else "failed",
                      latency_ms=result.get("latencyMs"),
                      error={"message": result["error"]} if result.get("error") else None))
    db.commit()
    log_change(db, rtype, rid, "test" if result.get("ok") else "test_fail", actor,
               {"latencyMs": result.get("latencyMs"), "error": result.get("error", "")})
    return result
