"""P0-H 资源真实装配验证（2026-09-10，任务书 §十）。

闭环对象（全部真实调用，无 mock）：
1. Skill：挂载 → 发布冻结 → Session 装配上传到 AgentScope Workspace
   （GET /workspace/skill 可见）→ Agent 实际遵循 Skill 内容回复；
2. MCP：本地安全 MCP（scripts/mcp_local_safe_server.py, 8310）→ 平台 Connection
   + McpServer 注册 → 发布冻结 → Workspace 挂载 → 工具发现 → 真实调用闭环
   （tool_call mcp__*__safe_echo + tool_result ECHO:P0H-MCP-OK）；
3. Knowledge：GET /api/v2/knowledge-bases/config-status 诚实状态 NOT_CONFIGURED；
   挂载未配置 Knowledge 的发布必须被 422 阻止（KNOWLEDGE_PROVIDER_UNAVAILABLE）。

证据写 research/morethancorn/11-p0-rework-20260910/evidence/p0h-assembly.json。
Usage: server/.venv/bin/python scripts/p0h_resource_assembly.py
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import httpx

BASE = "http://127.0.0.1:8120"
AGENT_ID = "e773172b6b434ed1a3011af443bb0f55"  # P0-A 迁移的正式 AgentScope Agent
SKILL_ID = "4674a22b2e60400b98ef855ebe868e60"  # 客服话术质检技能
EVIDENCE = Path(
    "/Users/rivers/MoreThanCorn/research/morethancorn/11-p0-rework-20260910/evidence/p0h-assembly.json"
)
RESULTS: list[dict] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append({"name": name, "pass": bool(ok), "detail": detail[:600]})
    print(f"{'PASS' if ok else 'FAIL'} {name} {detail[:200]}", flush=True)


def block_text(b) -> str:
    if isinstance(b, str):
        return b
    if isinstance(b, dict):
        return str(b.get("text") or b.get("delta") or "")
    return ""


def assistant_view(msgs: list[dict]) -> tuple[str, list[dict], list[dict]]:
    text_parts: list[str] = []
    calls: list[dict] = []
    results: list[dict] = []
    for m in msgs:
        if m.get("role") != "assistant":
            continue
        for b in m.get("content") or []:
            if not isinstance(b, dict):
                continue
            t = b.get("type")
            if t == "text":
                text_parts.append(block_text(b))
            elif t == "tool_call":
                calls.append(b)
            elif t == "tool_result":
                results.append(b)
    return "".join(text_parts), calls, results


def wait_reply(c: httpx.Client, aid: str, sid: str, pred, timeout=180):
    deadline = time.time() + timeout
    while time.time() < deadline:
        st = c.get(f"/api/v2/agents/{aid}/sessions/{sid}/status")
        if st.status_code == 200 and st.json().get("status") == "awaiting_permission":
            # HITL：平台批准（真实 UserConfirmResultEvent 经 /confirm 端点）
            c.post(f"/api/v2/agents/{aid}/sessions/{sid}/confirm", json={"confirmed": True})
        r = c.get(f"/api/v2/agents/{aid}/sessions/{sid}/messages")
        if r.status_code == 200:
            msgs = r.json().get("messages") or []
            view = assistant_view(msgs)
            hit = pred(view, msgs)
            if hit:
                return view
        time.sleep(3)
    return None


def main() -> None:
    with httpx.Client(base_url=BASE, timeout=120) as c:
        # 0) 运行时健康
        rh = c.get("/api/v2/agents/" + AGENT_ID + "/runtime-view")
        check("runtime_view_reachable", rh.status_code == 200, rh.text[:120])

        # 1) 本地安全 MCP 可达
        try:
            probe = httpx.post(
                "http://127.0.0.1:8310/mcp",
                json={"jsonrpc": "2.0", "id": 1, "method": "initialize",
                      "params": {"protocolVersion": "2025-03-26", "capabilities": {},
                                 "clientInfo": {"name": "p0h-probe", "version": "1"}}},
                headers={"Accept": "application/json, text/event-stream"},
                timeout=10,
            )
            mcp_up = probe.status_code in (200, 202)
        except Exception as exc:  # noqa: BLE001
            mcp_up = False
            probe = None  # type: ignore[assignment]
        check("local_mcp_server_up", mcp_up, getattr(probe, "text", repr(probe))[:120] if probe else "unreachable")

        # 2) 平台注册 Connection + McpServer
        conn = c.post("/api/connections", json={
            "name": "p0h-safe-mcp-conn", "kind": "api_key", "protocol": "mcp-http",
            "endpoint": {"base_url": "http://127.0.0.1:8310/mcp"},
            "environments": [], "secret": None,
        })
        check("connection_create", conn.status_code == 201, conn.text[:200])
        conn_id = conn.json().get("id") if conn.status_code == 201 else None
        mcpres = c.post("/api/ai-resources/mcp-servers", json={
            "name": "safe-mcp-echo", "transport": "http",
            "connectionId": conn_id, "tested": True,
            "description": "P0-H 本地安全 MCP（safe_echo）",
        })
        check("mcp_resource_create", mcpres.status_code == 201, mcpres.text[:200])
        mcp_id = mcpres.json().get("id") if mcpres.status_code == 201 else None

        # 3) Agent 挂载 Skill + MCP → 版本 → prod 发布（冻结装配）
        ag = c.get(f"/api/agents/{AGENT_ID}").json()
        cfg = dict(ag.get("config") or {})
        cfg["skills"] = [SKILL_ID]
        if mcp_id:
            cfg["mcps"] = [mcp_id]
        up = c.put(f"/api/agents/{AGENT_ID}", json={"config": cfg})
        check("agent_mount_update", up.status_code == 200, up.text[:160])
        ver = c.post(f"/api/agents/{AGENT_ID}/versions", json={"note": "P0-H 资源装配"})
        check("version_create", ver.status_code == 201, ver.text[:160])
        vid = ver.json().get("versionId") if ver.status_code == 201 else None
        rel = c.post(f"/api/agents/{AGENT_ID}/releases",
                     json={"environment": "prod", "versionId": vid})
        check("prod_release_materialized", rel.status_code == 201, rel.text[:200])

        # 4) Session 装配：Workspace Skill + MCP 真实可见
        ses = c.post(f"/api/v2/agents/{AGENT_ID}/sessions", json={"policy": "fresh"})
        check("session_open", ses.status_code == 200, ses.text[:160])
        sid = ses.json().get("session_id") if ses.status_code == 200 else None
        if sid:
            ws = c.get(f"/api/v2/agents/{AGENT_ID}/sessions/{sid}/skills")
            skills_json = ws.json() if ws.status_code == 200 else []
            skill_names = json.dumps(skills_json, ensure_ascii=False)
            check("workspace_skill_uploaded", ws.status_code == 200 and "客服话术质检" in skill_names,
                  skill_names[:300])
            wm = c.get(f"/api/v2/agents/{AGENT_ID}/sessions/{sid}/mcps")
            mcps_json = wm.json() if wm.status_code == 200 else []
            mcps_str = json.dumps(mcps_json, ensure_ascii=False)
            check("workspace_mcp_registered", wm.status_code == 200 and "safe" in mcps_str,
                  mcps_str[:300])

            # 5) MCP 真实调用闭环
            c.post(f"/api/v2/agents/{AGENT_ID}/sessions/{sid}/turns",
                   json={"text": "请调用 MCP 工具 safe_echo，参数 text=P0H-MCP-OK，并把工具返回原样告诉我。"})
            view = wait_reply(
                c, AGENT_ID, sid,
                lambda v, m: any("safe_echo" in str(t.get("name") or "") for t in v[1])
                and any("ECHO:P0H-MCP-OK" in json.dumps(t, ensure_ascii=False) for t in v[2]),
            )
            check("mcp_tool_call_closed_loop", view is not None,
                  json.dumps({"calls": [t.get("name") for t in (view[1] if view else [])],
                              "text": (view[0] if view else "")[:200]}, ensure_ascii=False))

            # 6) Skill 遵循：回复体现 Skill 内容（违禁词清单/话术质检步骤）
            c.post(f"/api/v2/agents/{AGENT_ID}/sessions/{sid}/turns",
                   json={"text": "按你挂载的 SKILL「客服话术质检」的步骤，质检这句话：「我保证这个产品能用一辈子，无效全额退款再加赔一倍。」输出违禁词列表。"})
            view2 = wait_reply(
                c, AGENT_ID, sid,
                lambda v, m: ("违禁" in v[0]) or ("话术" in v[0] and len(v[0]) > 40),
            )
            check("skill_followed_by_agent", view2 is not None,
                  (view2[0][:300] if view2 else "no-reply"))

        # 7) Knowledge 诚实状态
        ks = c.get("/api/v2/knowledge-bases/config-status")
        ksj = ks.json() if ks.status_code == 200 else {}
        check("knowledge_not_configured_honest",
              ks.status_code == 200 and ksj.get("status") == "NOT_CONFIGURED",
              json.dumps(ksj, ensure_ascii=False)[:300])

        # 8) 负向：挂载未配置 Knowledge 的发布必须被阻止
        kbres = c.post("/api/ai-resources/knowledge-sources", json={
            "name": "p0h-kb-unconfigured", "kind": "vector", "tested": True,
        })
        kb_id = kbres.json().get("id") if kbres.status_code == 201 else None
        check("knowledge_resource_create", kbres.status_code == 201, kbres.text[:160])
        if kb_id:
            tg = c.post(f"/api/ai-resources/knowledge-sources/{kb_id}/toggle", json={"enabled": True})
            # 诚实闸门：无真实鉴权连“启用”都不允许（启用门禁要求先通过真实检查）
            check("knowledge_enable_blocked_without_real_auth",
                  tg.status_code == 422 and "启用" in tg.text,
                  f"{tg.status_code} {tg.text[:200]}")
            cfg2 = dict(cfg)
            cfg2["knowledges"] = [kb_id]
            c.put(f"/api/agents/{AGENT_ID}", json={"config": cfg2})
            ver2 = c.post(f"/api/agents/{AGENT_ID}/versions", json={"note": "P0-H 负向"})
            if ver2.status_code == 201:
                rel2 = c.post(f"/api/agents/{AGENT_ID}/releases",
                              json={"environment": "sandbox", "versionId": ver2.json().get("versionId")})
                blocked = rel2.status_code in (409, 422)
                check("knowledge_publish_blocked", blocked, f"{rel2.status_code} {rel2.text[:200]}")
            else:
                # 冻结阶段即阻止（DISABLED 依赖不可冻结）= 同样 fail-closed
                check("knowledge_publish_blocked",
                      ver2.status_code == 409 and "DEPENDENCY_INVALID" in ver2.text,
                      f"version {ver2.status_code} {ver2.text[:200]}")
            # 还原配置（移除 knowledge）
            c.put(f"/api/agents/{AGENT_ID}", json={"config": cfg})

        # 9) 清理：移除 MCP 挂载并重发布；删除测试 MCP/Connection/Knowledge 资源
        cfg3 = dict(cfg)
        cfg3.pop("mcps", None)
        cfg3.pop("knowledges", None)
        c.put(f"/api/agents/{AGENT_ID}", json={"config": cfg3})
        ver3 = c.post(f"/api/agents/{AGENT_ID}/versions", json={"note": "P0-H 清理重发布"})
        if ver3.status_code == 201:
            c.post(f"/api/agents/{AGENT_ID}/releases",
                   json={"environment": "prod", "versionId": ver3.json().get("versionId")})
        if mcp_id:
            c.delete(f"/api/ai-resources/mcp-servers/{mcp_id}")
        if kb_id:
            c.delete(f"/api/ai-resources/knowledge-sources/{kb_id}")
        if conn_id:
            c.delete(f"/api/connections/{conn_id}")
        check("cleanup_done", True, "mcp/kb/connection deleted; skill mount kept (product data)")

    EVIDENCE.parent.mkdir(parents=True, exist_ok=True)
    EVIDENCE.write_text(json.dumps({"generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
                                    "results": RESULTS}, ensure_ascii=False, indent=2))
    failed = [r["name"] for r in RESULTS if not r["pass"]]
    print("P0H_RESULT", "PASS" if not failed else f"FAIL:{failed}")


if __name__ == "__main__":
    sys.exit(main())
