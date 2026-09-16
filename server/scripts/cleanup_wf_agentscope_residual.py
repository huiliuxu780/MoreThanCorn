"""wf_agentscope 惰性残留清理（agentscope-cutover §11 登记项，09-17 用户「做吧」）。

残留定义：运行时 AgentRecord / Schedule 无平台侧任何引用——
引用面 = Release.runtime_binding_snapshot.agentscope_agent_id
        ∪ agent_session_index.runtime_agent_id（历史回放依赖）
        ∪ automation_definition.runtime_schedule_id（schedule 引用面）。
默认 dry-run 打印清单；--apply 才真删（DELETE /agent/{id}、DELETE /schedule/{id}）。
用法：cd server && .venv/bin/python scripts/cleanup_wf_agentscope_residual.py [--apply]
"""
from __future__ import annotations

import os
import sys

import httpx
from sqlalchemy.orm import Session

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.db import SessionLocal  # noqa: E402
from app.models import (  # noqa: E402
    AgentSessionIndex,
    AutomationDefinition,
    Release,
)

RUNTIME = os.environ.get("MTC_RUNTIME_URL", "http://127.0.0.1:8301")
USERS = ["dev", "system", "rivers-huiliu.xu"]


def _referenced(db: Session) -> tuple[set[str], set[str]]:
    agents: set[str] = set()
    for (rid,) in db.query(Release.runtime_binding_snapshot).all():
        if isinstance(rid, dict) and rid.get("agentscope_agent_id"):
            agents.add(str(rid["agentscope_agent_id"]))
    for (rid,) in db.query(AgentSessionIndex.runtime_agent_id).filter(
            AgentSessionIndex.runtime_agent_id.isnot(None)).distinct():
        agents.add(str(rid))
    schedules: set[str] = set()
    for (sid,) in db.query(AutomationDefinition.runtime_schedule_id).filter(
            AutomationDefinition.runtime_schedule_id.isnot(None)).distinct():
        schedules.add(str(sid))
    return agents, schedules


def main() -> None:
    apply = "--apply" in sys.argv
    with SessionLocal() as db:
        ref_agents, ref_schedules = _referenced(db)
    users = list(USERS)
    residual_agents: list[tuple[str, str]] = []
    all_schedules: list[tuple[str, str, bool]] = []
    for u in users:
        with httpx.Client(timeout=15) as c:
            try:
                data = c.get(f"{RUNTIME}/agent/",
                             headers={"X-User-ID": u}).json()
            except Exception as exc:  # noqa: BLE001
                print(f"[warn] list agents user={u} failed: {exc}")
                continue
            for row in data.get("agents", []):
                aid = row.get("id")
                if aid and aid not in ref_agents:
                    residual_agents.append((u, aid))
            try:
                sdata = c.get(f"{RUNTIME}/schedule/",
                              headers={"X-User-ID": u}).json()
            except Exception as exc:  # noqa: BLE001
                print(f"[warn] list schedules user={u} failed: {exc}")
                continue
            rows = sdata if isinstance(sdata, list) else sdata.get("schedules", [])
            for row in rows:
                sid = row.get("id")
                enabled = bool(row.get("enabled", True))
                if sid:
                    all_schedules.append((u, sid, enabled))
    dead_schedules = [(u, s) for (u, s, en) in all_schedules
                      if not en and s not in ref_schedules]
    print(f"referenced agents={len(ref_agents)} schedules={len(ref_schedules)}")
    print(f"residual agents={len(residual_agents)} dead schedules={len(dead_schedules)}")
    for u, aid in residual_agents[:20]:
        print(f"  agent  user={u} id={aid}")
    for u, s in dead_schedules[:20]:
        print(f"  sched  user={u} id={s}")
    if not apply:
        print("[dry-run] 加 --apply 真删")
        return
    with httpx.Client(timeout=30) as c:
        for u, aid in residual_agents:
            r = c.delete(f"{RUNTIME}/agent/{aid}", headers={"X-User-ID": u})
            print(f"  delete agent {aid}: {r.status_code}")
        for u, s in dead_schedules:
            r = c.delete(f"{RUNTIME}/schedule/{s}", headers={"X-User-ID": u})
            print(f"  delete schedule {s}: {r.status_code}")
    print("[apply] done")


if __name__ == "__main__":
    main()
