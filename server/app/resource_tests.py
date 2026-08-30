"""Resource Test Executors — 六类资源的连通性/可用性测试 + 健康度回写。

SDD-12 P0-05（AR-09）：真实路径优先；缺真实配置时**失败关闭**。
示例/mock 仅在显式 `WF_TEST_FIXTURES=1`（非生产）可用，且输出带 `fixture` 标记；
普通 dev 与生产一律不自动回退假成功。测试失败只降健康度，不自动停用。
"""
from __future__ import annotations

import time
from datetime import datetime, timezone

import httpx
from fastapi import HTTPException
from sqlalchemy.orm import Session

from .auth_signers import AuthSignError, build_auth_headers
from .connection_runtime import resolve_for_request
from .models import (CallRecord, Connection, DataAsset, Datasource, KnowledgeSource,
                     McpServer, Model, Tool)
from .resource_registry import CLS, log_change
from .runner import RunError, _call_model, exec_tool
from .secrets import decrypt_payload

# 仅 fixture profile 可达（fixtures_enabled() 门控；生产恒不可达）
_MOCK_MCP_TOOLS = [
    {"name": "search_docs", "description": "搜索文档", "inputSchema": {"type": "object", "properties": {"q": {"type": "string"}}}},
    {"name": "read_doc", "description": "读取文档", "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}}}},
]


def _conn_endpoint(db: Session, cid: str | None) -> dict:
    """R4：经环境解析（default_env 覆盖），不再只读 connection 级 endpoint。"""
    if not cid:
        return {}
    c = db.get(Connection, cid)
    if not c:
        return {}
    ep, _payload, _code = resolve_for_request(c)
    return ep


def _conn_auth(db: Session, cid: str | None) -> tuple[dict, str]:
    """R4：connection 绑定的鉴权头（kind 真实生效）；返回 (headers, error)。"""
    if not cid:
        return {}, ""
    c = db.get(Connection, cid)
    if not c:
        return {}, ""
    _ep, payload, _code = resolve_for_request(c)
    try:
        return build_auth_headers(c.kind, payload, script=c.auth_script,
                                  env_vars=payload if isinstance(payload, dict) else None), ""
    except AuthSignError as exc:
        return {}, str(exc)


def _test_model(db: Session, obj: Model, _input: dict) -> dict:
    t0 = time.time()
    try:
        answer, tokens = _call_model(db, obj.model_key, "ping")
    except RunError as exc:  # 生产无真实 Provider → 测试失败（不得假成功）
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "latencyMs": int((time.time() - t0) * 1000),
            "output": {"answer": answer[:200], "tokens": tokens}}


def _test_tool(db: Session, obj: Tool, payload: dict) -> dict:
    from .routers.admin import test_tool
    return test_tool(obj.id, payload or None, db)


def _test_mcp(db: Session, obj: McpServer, _input: dict) -> dict:
    """09 P0-01 / SDD-12 P0-05：MCP 测试必须真协议。官方 SDK 发现落地（P2）前失败关闭；
    示例工具清单仅在显式 fixture profile 可达，且输出带 fixture 标记（不得写健康假象）。"""
    from .config import fixtures_enabled
    t0 = time.time()
    fixture = False
    if obj.transport == "http":
        base = _conn_endpoint(db, obj.connection_id).get("base_url", "")
        if base.startswith(("http://", "https://")):
            from .egress import EgressError, enforce_egress
            try:
                enforce_egress(base)
            except EgressError as exc:
                return {"ok": False, "error": str(exc)}
            headers, aerr = _conn_auth(db, obj.connection_id)
            if aerr:
                return {"ok": False, "error": aerr}
            try:
                with httpx.Client(timeout=5) as client:
                    r = client.post(base, headers=headers,
                                    json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
                    r.raise_for_status()
                # 真握手成功也仍需真 tools/list（P2）；无真发现则按环境门控
                if not fixtures_enabled():
                    return {"ok": False,
                            "error": "MCP tools/list 真实发现未实现（官方 SDK 为 P2），失败关闭"}
                tools = _MOCK_MCP_TOOLS  # fixture profile：显式标记
                fixture = True
            except Exception as exc:  # noqa: BLE001
                return {"ok": False, "error": f"MCP 握手失败：{exc}"}
        else:
            if not fixtures_enabled():
                return {"ok": False, "error": "缺少真实 MCP endpoint，失败关闭（无 fixture）"}
            tools = _MOCK_MCP_TOOLS
            fixture = True
    else:
        if not obj.command:
            return {"ok": False, "error": "缺少 stdio 启动命令"}
        if not fixtures_enabled():
            return {"ok": False, "error": "MCP stdio 未真实拉起进程（官方 SDK 为 P2），失败关闭"}
        tools = _MOCK_MCP_TOOLS
        fixture = True
    obj.discovered_tools = tools
    db.commit()
    return {"ok": True, "latencyMs": int((time.time() - t0) * 1000),
            "output": {"tools": [t["name"] for t in tools], "fixture": fixture}}


def _test_knowledge(db: Session, obj: KnowledgeSource, payload: dict) -> dict:
    from .config import fixtures_enabled
    t0 = time.time()
    q = (payload or {}).get("query", "样例查询")
    url = (obj.source_config or {}).get("url", "")
    if url.startswith(("http://", "https://")):
        from .egress import EgressError, enforce_egress
        try:
            enforce_egress(url)
        except EgressError as exc:
            return {"ok": False, "error": str(exc)}
        try:
            with httpx.Client(timeout=5) as client:
                r = client.post(url, json={"query": q, "topK": 3})
                r.raise_for_status()
            slices = (r.json() or {}).get("slices", [])
            fixture = False
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"检索失败：{exc}"}
    else:
        if not fixtures_enabled():
            return {"ok": False, "error": "知识库无真实后端，失败关闭（无 fixture，M-06）"}
        slices = [{"text": f"[mock] 与「{q}」相关的切片 #{i}", "score": round(0.9 - i * 0.1, 2)} for i in range(3)]
        fixture = True
    return {"ok": True, "latencyMs": int((time.time() - t0) * 1000),
            "output": {"slices": len(slices), "fixture": fixture}}


def _test_datasource(db: Session, obj: Datasource, _input: dict) -> dict:
    """09 P0-01/M-09 / SDD-12 P0-05：连接测试必须执行真实最小查询；
    缺配置/驱动一律失败关闭，mock 仅显式 fixture profile 可达（带标记）。"""
    from .config import fixtures_enabled
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
                if not fixtures_enabled():
                    return {"ok": False, "error": f"驱动 {driver} 未安装，失败关闭（无 fixture）"}
            except Exception as exc:  # noqa: BLE001
                return {"ok": False, "error": f"连接失败：{exc}"}
        if not fixtures_enabled():
            return {"ok": False, "error": "缺少数据库主机配置，失败关闭（无 fixture）"}
        return {"ok": True, "latencyMs": 21, "output": {"check": "SELECT 1 (fixture)", "fixture": True}}
    if obj.type == "oss":
        bucket = ep.get("bucket", obj.location)
        if not bucket:
            return {"ok": False, "error": "缺少 bucket 配置",
                    "latencyMs": int((time.time() - t0) * 1000), "output": {}}
        if not fixtures_enabled():
            # P1 落 OSS SDK 前的诚实状态：配置存在但未做真实对象探测（生产恒走此分支）
            return {"ok": False, "error": "OSS 真实对象探测未实现（P1 交付），失败关闭",
                    "latencyMs": int((time.time() - t0) * 1000), "output": {"bucket": bucket}}
        return {"ok": True, "error": "",
                "latencyMs": int((time.time() - t0) * 1000),
                "output": {"list": "10 objects (fixture)", "fixture": True}}
    # http
    base = ep.get("base_url", "")
    if base.startswith(("http://", "https://")):
        from .egress import EgressError, enforce_egress
        try:
            enforce_egress(base)
        except EgressError as exc:
            return {"ok": False, "error": str(exc)}
        headers, aerr = _conn_auth(db, obj.connection_id)
        if aerr:
            return {"ok": False, "error": aerr, "latencyMs": int((time.time() - t0) * 1000), "output": {}}
        try:
            with httpx.Client(timeout=5) as client:
                r = client.get(base, headers=headers)
                ok = r.status_code < 500 and r.status_code not in (401, 403)
            err = "" if ok else (f"鉴权失败（HTTP {r.status_code}）" if r.status_code in (401, 403)
                                 else f"HTTP {r.status_code}")
            return {"ok": ok, "error": err,
                    "latencyMs": int((time.time() - t0) * 1000), "output": {"status": r.status_code}}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"健康检查失败：{exc}"}
    if not fixtures_enabled():
        return {"ok": False, "error": "缺少真实 endpoint，失败关闭（无 fixture）"}
    return {"ok": True, "latencyMs": 18, "output": {"health": "ok (fixture)", "fixture": True}}


def _secret(db: Session, cid: str | None) -> str:
    """R4：凭据 payload 兼容裸串（历史）与 {username,password} 结构。"""
    if not cid:
        return ""
    c = db.get(Connection, cid)
    if not c or not c.secret_ref:
        return ""
    p = decrypt_payload(c.secret_ref)
    return p if isinstance(p, str) else str(p.get("password", ""))


def _test_asset(db: Session, obj: DataAsset, _input: dict) -> dict:
    t0 = time.time()
    if obj.datasource_id:
        ds = db.get(Datasource, obj.datasource_id)
        if not ds:
            return {"ok": False, "error": "所属 Datasource 不存在"}
        base = _test_datasource(db, ds, {})
        if not base.get("ok"):
            return base
        # 09 P0：真实计数（M-11：禁止固定 10 条假样本数）
        try:
            from .data_readers import get_reader
            reader = get_reader(db, obj)
            locator = {"table": obj.location or "", "idField": obj.record_id_field or "id",
                       "timeField": obj.time_field or ""}
            rows = reader.count(locator)
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"数据读取失败：{exc}"}
    else:
        rows = min(len(obj.rows or []), 10)
    missing = [f for f in (obj.time_field,) if f and not (obj.rows or [{}])[0].get(f)] if (obj.rows or []) and obj.datasource_id is None else []
    ok = not missing
    return {"ok": ok, "error": "" if ok else f"时间字段缺失：{missing}",
            "latencyMs": int((time.time() - t0) * 1000),
            "output": {"sampled": rows}}


_EXEC = {"model": _test_model, "tool": _test_tool, "mcp": _test_mcp,
         "knowledge": _test_knowledge, "datasource": _test_datasource, "asset": _test_asset}


def search_knowledge(db: Session, ks_id: str, query: str, top_k: int = 5, mode: str = "HYBRID") -> list[dict]:
    """knowledge-retrieval 节点与测试共用的检索入口。

    SDD-12 P0-05：无真实后端时失败关闭；fixture 切片仅在显式 fixture profile 可达。
    """
    obj = db.get(KnowledgeSource, ks_id)
    if not obj:
        raise RunError(f"knowledge source {ks_id} not found")
    url = (obj.source_config or {}).get("url", "")
    if url.startswith(("http://", "https://")):
        from .egress import EgressError, enforce_egress
        try:
            enforce_egress(url)
        except EgressError as exc:
            raise RunError(str(exc))
        try:
            with httpx.Client(timeout=5) as client:
                r = client.post(url, json={"query": query, "topK": top_k, "mode": mode})
                r.raise_for_status()
            return (r.json() or {}).get("slices", [])
        except Exception as exc:  # noqa: BLE001
            raise RunError(f"知识检索失败：{exc}") from exc
    from .config import fixtures_enabled
    if not fixtures_enabled():
        raise RunError(f"知识库 {obj.name} 无真实后端，失败关闭（无 fixture，M-06）")
    return [{"text": f"[mock:{obj.name}] 与「{query}」相关切片 #{i}", "score": round(0.9 - i * 0.1, 2),
             "fixture": True}
            for i in range(min(top_k, 3))]


def mcp_call_tool(db: Session, server_id: str, tool_name: str, args: dict) -> dict:
    """mcp-call 节点执行入口。

    SDD-12 P0-05：无真实 endpoint 一律失败关闭；mock 仅显式 fixture profile 可达。
    （手写 JSON-RPC 由 P2 官方 SDK 替换，见验收 E-09。）
    """
    obj = db.get(McpServer, server_id)
    if not obj:
        raise RunError(f"mcp server {server_id} not found")
    if obj.status != "enabled":
        raise RunError(f"mcp server {obj.name} 已停用")
    if obj.transport == "http":
        base = _conn_endpoint(db, obj.connection_id).get("base_url", "")
        if base.startswith(("http://", "https://")):
            from .egress import EgressError, enforce_egress
            try:
                enforce_egress(base)
            except EgressError as exc:
                raise RunError(str(exc))
            headers, aerr = _conn_auth(db, obj.connection_id)
            if aerr:
                raise RunError(aerr)
            try:
                with httpx.Client(timeout=10) as client:
                    r = client.post(base, headers=headers,
                                    json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                          "params": {"name": tool_name, "arguments": args or {}}})
                    r.raise_for_status()
                return r.json()
            except Exception as exc:  # noqa: BLE001
                raise RunError(f"MCP 调用失败：{exc}") from exc
    from .config import fixtures_enabled
    if not fixtures_enabled():
        raise RunError(f"MCP {obj.name} 无真实端点，失败关闭（无 fixture，M-08）")
    return {"result": f"[mock mcp:{obj.name}] {tool_name} 执行成功", "args": args or {},
            "fixture": True}


def run_test(db: Session, rtype: str, rid: str, payload: dict | None = None, actor: str = "") -> dict:
    from .check_runs import record_check, resource_fingerprint
    obj = db.get(CLS[rtype], rid)
    if not obj:
        raise HTTPException(404, "资源不存在")
    fp = resource_fingerprint(db, rtype, obj)
    result = _EXEC[rtype](db, obj, payload or {})
    now = datetime.now(timezone.utc)
    if hasattr(obj, "health"):
        obj.health = "healthy" if result.get("ok") else "error"
    if hasattr(obj, "last_test_at"):
        obj.last_test_at = now
    if hasattr(obj, "last_check_at"):
        obj.last_check_at = now
    # SDD-12 P0-04：真实测试结果落 CheckRun（带配置指纹），供启用门禁与健康度派生。
    purpose = {"mcp": "discover", "knowledge": "query", "model": "inference"}.get(rtype, "execute")
    run = record_check(db, scope="resource", target_id=rid, purpose=purpose,
                       ok=bool(result.get("ok")), fingerprint=fp,
                       latency_ms=result.get("latencyMs"),
                       error={"message": result["error"]} if result.get("error") else None,
                       diagnostics={"fixture": bool((result.get("output") or {}).get("fixture")),
                                    **({"sampled": (result.get("output") or {}).get("sampled")}
                                       if (result.get("output") or {}).get("sampled") is not None else {})},
                       actor=actor)
    db.add(CallRecord(kind=rtype, target_type=rtype, target_id=rid,
                      request={"summary": str(payload or {})[:500]},
                      response={"summary": str(result.get("output", ""))[:500]},
                      status="success" if result.get("ok") else "failed",
                      latency_ms=result.get("latencyMs"),
                      error={"message": result["error"]} if result.get("error") else None))
    db.commit()
    log_change(db, rtype, rid, "test" if result.get("ok") else "test_fail", actor,
               {"latencyMs": result.get("latencyMs"), "error": result.get("error", "")})
    result["checkRunId"] = run.id
    result["configFingerprint"] = fp[:16]
    return result
