#!/usr/bin/env python
"""09-18 端到端全链路真跑：数据(SLS 生产日志) → 任务(automation) → agent(prompt+tools+skill) → run → 结束。

链路（全部走平台 API，无直写 DB）：
  1. 上传 Skill（.md 文件驱动，frontmatter 定名）
  2. 创建 custom Agent（rolePrompt + modelRef）
  3. PUT config 补齐 tools + skills（发布冻结用）
  4. POST versions  → definition 快照（rolePrompt/tools/skills/modelRef 全冻结）
  5. POST releases  → prod 物化（注册 AgentScope 运行时 + 冻结资源清单）
  6. POST /api/v2/automations → 任务（prompt_template 带 {{content}}，max_runs 限流）
  7. POST /api/v2/event-routes → SLS 源 → automation（filter: content contains ERROR，
     completionPolicy=terminal：delivery 等 invocation 终态才算完成）
  8. POST /api/v2/data-sources/{sls}/poll → 真实拉取阿里云 SLS 生产日志（增量游标）
  9. 轮询 invocations 至终态 → 拉会话消息 → 存证

用法：server/.venv/bin/python assets/2026-09-18-e2e-fullchain/run_e2e_fullchain.py [--from-stage N]
状态存 evidence/state.json，可断点续跑。
"""
from __future__ import annotations

import json
import pathlib
import sys
import time

import httpx

BASE = "http://127.0.0.1:8120"
HERE = pathlib.Path(__file__).resolve().parent
EVIDENCE = HERE / "evidence"
STATE_FILE = EVIDENCE / "state.json"

SLS_SOURCE_ID = "da363b4af61340a186f81ecda681d4b4"      # SLS bsh 日志（k8s-log 生产）
TOOL_TICKET = "08c43094b52340b19b7f111b8b6d8a13"        # 工单查询（dubbo searchTicket，AKSK 真外呼）
TOOL_KB = "12e97c5dd98a44efbb7c05ff87262057"            # knowledge_search（dev fixture 后端）
MODEL_ID = "qwen3.8-max"

AGENT_NAME = "数据事件分析员-0918"
AUTOMATION_NAME = "生产ERROR事件分析-0918"

ROLE_PROMPT = """你是数据链路事件值班分析员。你接收生产系统（热线/质检链路）实时采集的日志事件，独立完成分析并给出结论。

工作方式：
1. 严格按已挂载的 Skill《热线日志事件分析规程》执行分析步骤（要素解析→业务ID提取→工具核实→结构化输出）。
2. 需要核实业务数据时必须真实调用工具，并基于工具的真实返回作答；工具报错就如实引用错误信息，禁止编造工具结果或业务数据。
3. 分析只基于事件内容与工具返回，不臆测日志中不存在的信息。

输出：按规程第 4 节的结构化格式（一句话结论/影响面/建议动作/证据）给出最终回答。"""

PROMPT_TEMPLATE = """生产链路新到一条 ERROR 日志事件，请严格按已挂载的《热线日志事件分析规程》完整分析，并按规程第 4 节格式输出。

事件内容：
{{content}}

注意：需要核实业务数据时必须真实调用工具；工具报错要如实引用，不得假装查到数据。"""

client = httpx.Client(base_url=BASE, timeout=120)


def _state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {}


def _save(state: dict) -> None:
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2))


def _check(step: str, resp: httpx.Response, ok_codes=(200, 201, 202)) -> dict:
    if resp.status_code not in ok_codes:
        raise SystemExit(f"[FAIL] {step}: HTTP {resp.status_code} {resp.text[:500]}")
    try:
        data = resp.json()
    except Exception:
        data = {"raw": resp.text[:500]}
    print(f"[ok] {step}")
    return data


def stage1_skill(state: dict) -> dict:
    md = (HERE / "skill-hotline-log-analysis.md").read_bytes()
    r = client.post("/api/skills/upload",
                    files={"file": ("skill-hotline-log-analysis.md", md, "text/markdown")})
    d = _check("stage1 上传 Skill", r)
    state["skill_id"] = d["id"]
    state["skill_name"] = d.get("name")
    (EVIDENCE / "stage1-skill.json").write_text(json.dumps(d, ensure_ascii=False, indent=2))
    return state


def stage2_agent(state: dict) -> dict:
    r = client.post("/api/agents", json={
        "type": "custom",
        "name": AGENT_NAME,
        "description": "接收生产日志事件，按 Skill 规程分析并真实调用工具核实，输出结论与建议动作（09-18 端到端链路）",
        "rolePrompt": ROLE_PROMPT,
        "skills": [state["skill_id"]],
        "modelRef": {"modelId": MODEL_ID},
    })
    d = _check("stage2 创建 Agent", r)
    state["agent_id"] = d["id"]
    (EVIDENCE / "stage2-agent.json").write_text(json.dumps(d, ensure_ascii=False, indent=2))
    return state


def stage3_config(state: dict) -> dict:
    r = client.put(f"/api/agents/{state['agent_id']}", json={"config": {
        "rolePrompt": ROLE_PROMPT,
        "skills": [state["skill_id"]],
        "tools": [TOOL_TICKET, TOOL_KB],
        "modelRef": {"modelId": MODEL_ID},
        "capabilities": [],
    }})
    d = _check("stage3 配置 tools+skills", r)
    (EVIDENCE / "stage3-config.json").write_text(json.dumps(d, ensure_ascii=False, indent=2))
    return state


def stage4_version(state: dict) -> dict:
    r = client.post(f"/api/agents/{state['agent_id']}/versions",
                    json={"note": "09-18 端到端：rolePrompt+2 tools+1 skill 冻结"})
    d = _check("stage4 创建版本", r)
    state["version_id"] = d["versionId"]
    (EVIDENCE / "stage4-version.json").write_text(json.dumps(d, ensure_ascii=False, indent=2))
    return state


def stage5_release(state: dict) -> dict:
    r = client.post(f"/api/agents/{state['agent_id']}/releases",
                    json={"versionId": state["version_id"], "environment": "prod"})
    d = _check("stage5 发布 prod release", r)
    state["release_id"] = d["releaseId"]
    (EVIDENCE / "stage5-release.json").write_text(json.dumps(d, ensure_ascii=False, indent=2))
    return state


def stage6_automation(state: dict) -> dict:
    r = client.post("/api/v2/automations", json={
        "name": AUTOMATION_NAME,
        "description": "SLS 生产 ERROR 日志事件 → 数据事件分析员逐条分析（09-18 端到端，max_runs=3 限流）",
        "target_kind": "agent",
        "agent_id": state["agent_id"],
        "session_policy": "fresh",
        "prompt_template": PROMPT_TEMPLATE,
        "max_runs": 3,
        "triggers": [],
    })
    d = _check("stage6 创建自动任务", r)
    state["automation_id"] = d.get("id") or d.get("automationId")
    (EVIDENCE / "stage6-automation.json").write_text(json.dumps(d, ensure_ascii=False, indent=2))
    return state


def stage7_route(state: dict) -> dict:
    r = client.post("/api/v2/event-routes", json={
        "sourceId": SLS_SOURCE_ID,
        "eventType": "",
        "destination": {"kind": "automation", "id": state["automation_id"]},
        "filter": {"expression": {"field": "content", "op": "contains", "value": "ERROR"}},
        "completionPolicy": "terminal",
        "enabled": True,
    })
    d = _check("stage7 创建 EventRoute", r)
    state["route_id"] = d.get("id") or d.get("routeId")
    (EVIDENCE / "stage7-route.json").write_text(json.dumps(d, ensure_ascii=False, indent=2))
    return state


def stage8_poll(state: dict) -> dict:
    r = client.post(f"/api/v2/data-sources/{SLS_SOURCE_ID}/poll")
    d = _check("stage8 真实拉取 SLS 生产日志", r)
    state["poll"] = d
    print(f"     polled={d.get('polled')} dispatched={d.get('dispatched')} pages={d.get('pages')}")
    (EVIDENCE / "stage8-poll.json").write_text(json.dumps(d, ensure_ascii=False, indent=2))
    return state


def stage9_wait(state: dict) -> dict:
    aid = state["automation_id"]
    deadline = time.time() + 420
    invs: list[dict] = []
    while time.time() < deadline:
        r = client.get(f"/api/v2/automations/{aid}/invocations")
        invs = (r.json() or {}).get("items") or []
        real = [i for i in invs if i["status"] not in ("REJECTED",)]
        if real and all(i["status"] in ("COMPLETED", "FAILED", "CANCELLED") for i in real):
            break
        time.sleep(5)
    state["invocations"] = invs
    (EVIDENCE / "stage9-invocations.json").write_text(
        json.dumps(invs, ensure_ascii=False, indent=2))
    for i in invs:
        print(f"     invocation {i['id'][:8]}… status={i['status']} "
              f"target={i.get('target', {}).get('kind')}:{str(i.get('target', {}).get('id'))[:8]}")
    return state


def stage10_messages(state: dict) -> dict:
    out = {}
    for inv in state.get("invocations", []):
        if inv["status"] == "REJECTED":
            continue
        sid = (inv.get("target") or {}).get("id")
        if not sid:
            continue
        r = client.get(f"/api/v2/agents/{state['agent_id']}/sessions/{sid}/messages")
        msgs = r.json() if r.status_code == 200 else {"error": r.text[:300]}
        out[sid] = msgs
        (EVIDENCE / f"stage10-messages-{sid[:8]}.json").write_text(
            json.dumps(msgs, ensure_ascii=False, indent=2))
        n = len(msgs) if isinstance(msgs, list) else len(msgs.get("items", []) if isinstance(msgs, dict) else [])
        print(f"[ok] stage10 会话 {sid[:8]}… 消息数={n}")
    (EVIDENCE / "stage10-messages-all.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2))
    return state


STAGES = [stage1_skill, stage2_agent, stage3_config, stage4_version, stage5_release,
          stage6_automation, stage7_route, stage8_poll, stage9_wait, stage10_messages]


def main() -> None:
    start = 1
    if "--from-stage" in sys.argv:
        start = int(sys.argv[sys.argv.index("--from-stage") + 1])
    state = _state()
    for idx, fn in enumerate(STAGES, start=1):
        if idx < start:
            print(f"[skip] stage{idx} {fn.__name__}")
            continue
        state = fn(state)
        _save(state)
    print("\n=== 链路终值 ===")
    print(json.dumps({k: state.get(k) for k in
                      ("skill_id", "agent_id", "version_id", "release_id",
                       "automation_id", "route_id", "poll")},
                     ensure_ascii=False, indent=2))
    for inv in state.get("invocations", []):
        print(f"invocation {inv['id']} → {inv['status']}")


if __name__ == "__main__":
    main()
