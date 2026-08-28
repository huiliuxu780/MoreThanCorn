"""R-Archive（SDD 10 Phase R-Archive）：旧三类 Agent 运行层封存契约。

取代原"三型运行/挂载/护栏/发布同步"验收——旧行为由 tag archive/legacy-agents-20260828
与 docs/archive/legacy-agents/manifest.md 保存，此处验证封存后的产品契约：
- 全部写/运行入口 410 LEGACY_AGENT_ARCHIVED，且不产生新 Run；
- 历史 Agent/版本/Release/Run/指标只读可查；
- Workflow 引用旧 Agent：发布被阻止、agent-exec 运行期拒绝；
- worker 分派表不再执行 agent-execution；
- 数据封存工具 dry-run/apply 语义。

注意：测试库为共享持久库且存有历史旧 Agent，封存工具类断言一律用"子集/包含"，
不做全库相等断言。
"""
import time
import uuid

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.legacy_agent_archive import (LEGACY_ARCHIVED_CODE, LEGACY_ARCHIVED_MESSAGE,
                                      apply_archive, collect_archive_plan)
from app.main import app
from app.models import (Agent, AnalysisTask, AuditLog, EvalSample, EvolutionPatch, JobQueue,
                        Release, Run, Schedule)
from app.runner import claim_and_run, create_run, execute_run
from tests._legacy_agents import seed_agent, seed_release, seed_version, uniq

client = TestClient(app)
T = uuid.uuid4().hex[:6]


def _assert_410(resp, message: str | None = LEGACY_ARCHIVED_MESSAGE):
    assert resp.status_code == 410, resp.text
    body = resp.json()
    assert body["code"] == LEGACY_ARCHIVED_CODE, body
    if message is None:
        assert body["message"], body  # 自定义文案（如创建入口）只要求非空
    else:
        assert body["message"] == message, body


def _run_count(agent_id: str) -> int:
    db = SessionLocal()
    try:
        return db.query(Run).filter_by(agent_id=agent_id).count()
    finally:
        db.close()


# ---------- 创建 / 复制 / 编辑 / 删除 ----------

def test_create_legacy_agent_blocked_all_types():
    for t in ("autonomous", "dialogue", "expert-group", None):
        payload = {"name": uniq("封存")}
        if t:
            payload["type"] = t
        _assert_410(client.post("/api/agents", json=payload), message=None)


def test_update_agent_blocked():
    a = seed_agent()
    _assert_410(client.put(f"/api/agents/{a['id']}", json={"config": {"x": 1}}))
    # 携带正确 revision 的写同样被拒（封存门优先于乐观锁）
    detail = client.get(f"/api/agents/{a['id']}").json()
    _assert_410(client.put(f"/api/agents/{a['id']}",
                           json={"config": {"x": 2}, "expectedRevision": detail["configRevision"]}))


def test_duplicate_agent_blocked():
    a = seed_agent()
    _assert_410(client.post(f"/api/agents/{a['id']}/duplicate"))


def test_delete_agent_blocked():
    a = seed_agent()
    _assert_410(client.delete(f"/api/agents/{a['id']}"))


# ---------- 运行（manual/api/schedule/eval 触发）与重试 ----------

def test_run_blocked_and_creates_no_run():
    a = seed_agent()
    before = _run_count(a["id"])
    for trigger in ("test", "manual", "api", "schedule"):
        _assert_410(client.post(f"/api/agents/{a['id']}/run",
                                json={"input": {"userQuery": "hi"}, "trigger": trigger}))
    assert _run_count(a["id"]) == before, "封存运行不得产生 Run"


def test_retry_agent_run_blocked():
    a = seed_agent()
    db = SessionLocal()
    try:
        run = Run(agent_id=a["id"], trigger="manual", status="failed", input={})
        db.add(run)
        db.commit()
        run_id = run.id
    finally:
        db.close()
    _assert_410(client.post(f"/api/runs/{run_id}/retry"))


# ---------- 版本 / 发布生命周期 ----------

def test_version_and_release_writes_blocked():
    a = seed_agent()
    _assert_410(client.post(f"/api/agents/{a['id']}/versions", json={"note": "x"}))
    v = seed_version(a["id"])
    _assert_410(client.post(f"/api/agents/{a['id']}/releases",
                            json={"versionId": v["id"], "environment": "sandbox"}))
    r = seed_release(a["id"], v["id"], canary_percent=50)
    _assert_410(client.post(f"/api/agents/{a['id']}/releases/{r['id']}/stop-canary"))


# ---------- 评测 / 进化（写路径全部封存） ----------

def test_eval_and_evolution_writes_blocked():
    a = seed_agent()
    _assert_410(client.post(f"/api/agents/{a['id']}/eval-samples", json={"name": "s"}))
    _assert_410(client.post(f"/api/agents/{a['id']}/eval-run", json={}))
    _assert_410(client.post(f"/api/agents/{a['id']}/evolution/candidates"))
    s = EvalSample(agent_id=a["id"], name="样本", input={})
    p = EvolutionPatch(agent_id=a["id"], base_prompt="a", proposed_prompt="b")
    db = SessionLocal()
    try:
        db.add_all([s, p])
        db.commit()
        sid, pid = s.id, p.id
    finally:
        db.close()
    _assert_410(client.post(f"/api/agents/{a['id']}/eval-samples/{sid}/human-score",
                            json={"score": 4}))
    _assert_410(client.post(f"/api/agents/{a['id']}/evolution/{pid}/apply"))
    _assert_410(client.post(f"/api/agents/{a['id']}/evolution/{pid}/reject"))


# ---------- 历史只读查询完整保留 ----------

def test_read_paths_preserved():
    a = seed_agent(name=uniq("只读"), atype="autonomous")
    v = seed_version(a["id"])
    seed_release(a["id"], v["id"])
    assert client.get(f"/api/agents/{a['id']}").status_code == 200
    lst = client.get("/api/agents", params={"search": a["name"], "archived": "all"})
    assert lst.status_code == 200 and any(x["id"] == a["id"] for x in lst.json()["items"])
    assert client.get(f"/api/agents/{a['id']}/versions").status_code == 200
    vd = client.get(f"/api/agents/{a['id']}/versions/{v['id']}")
    assert vd.status_code == 200 and vd.json()["versionNo"] == v["versionNo"]
    rels = client.get(f"/api/agents/{a['id']}/releases")
    assert rels.status_code == 200 and rels.json()
    for path in ("runs", "metrics", "mounts-health", "definition-draft",
                 "eval-samples", "evolution"):
        assert client.get(f"/api/agents/{a['id']}/{path}").status_code == 200, path


def test_archived_flag_filter_read_semantics():
    a = seed_agent(archived=True)
    assert all(x["id"] != a["id"]
               for x in client.get("/api/agents", params={"pageSize": 100}).json()["items"])
    assert any(x["id"] == a["id"] for x in client.get(
        "/api/agents", params={"archived": "true", "pageSize": 100}).json()["items"])
    assert any(x["id"] == a["id"] for x in client.get(
        "/api/agents", params={"archived": "all", "pageSize": 100}).json()["items"])
    # 取消归档也是写操作 → 410
    _assert_410(client.put(f"/api/agents/{a['id']}", json={"archived": False}))


# ---------- Workflow 与旧 Agent 的边界 ----------

def _make_raw_workflow(name: str, nodes: list, edges: list) -> str:
    wid = client.post("/api/workflows", json={"name": name}).json()["id"]
    g = client.get(f"/api/workflows/{wid}").json()
    defn = g["definition"]
    defn["graph"]["nodes"] = [{"id": "s", "type": "input", "name": "开始", "config": {},
                               "inputs": []}] + nodes + [
        {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"},
         "inputs": [{"name": "output", "type": "string",
                     "source": {"kind": "fixed", "value": ""}}]}]
    defn["graph"]["edges"] = [{"id": "e0", "source": "s", "target": nodes[0]["id"]}] + edges + [
        {"id": "eN", "source": nodes[-1]["id"], "target": "e"}]
    r = client.put(f"/api/workflows/{wid}/draft",
                   json={"definition": defn, "baseRevision": g["draftRevision"]})
    assert r.status_code == 200, r.text
    return wid


def test_workflow_publish_blocks_legacy_agent_refs():
    member = seed_agent(atype="dialogue")
    wid = _make_raw_workflow(uniq("引用封存"), [
        {"id": "a1", "type": "agent", "name": "旧Agent", "config": {"agentCode": member["id"]},
         "inputs": []}], [])
    r = client.post(f"/api/workflows/{wid}/publish")
    assert r.status_code == 409, r.text
    body = r.json()["detail"]
    assert body["code"] == LEGACY_ARCHIVED_CODE
    assert any(i["nodeId"] == "a1" for i in body["issues"])


def test_workflow_agent_exec_refuses_legacy_member_at_runtime():
    member = seed_agent(atype="autonomous")
    wid = _make_raw_workflow(uniq("执行封存"), [
        {"id": "ex", "type": "agent-exec", "name": "旧执行", "config": {"agentCode": member["id"]},
         "inputs": []}], [])
    db = SessionLocal()
    try:
        run = create_run(db, wid, "test", {"userQuery": "hi"}, enqueue=False)
        run_id = run.id
    finally:
        db.close()
    execute_run(run_id)
    d = client.get(f"/api/runs/{run_id}").json()
    assert d["status"] == "failed", d
    assert LEGACY_ARCHIVED_CODE in str(d.get("error")), d
    assert _run_count(member["id"]) == 0, "agent-exec 拒绝时不得产生成员子 Run"


# ---------- worker 分派表防呆 ----------

def test_worker_dead_end_for_stale_agent_job():
    a = seed_agent()
    db = SessionLocal()
    try:
        run = Run(agent_id=a["id"], trigger="manual", status="queued", input={})
        db.add(run)
        db.flush()
        db.add(JobQueue(type="agent-execution", payload={"run_id": run.id}))
        db.commit()
        run_id = run.id
    finally:
        db.close()
    claim_and_run(SessionLocal())  # 与全局 worker 并发安全（SKIP LOCKED），谁认领都行
    deadline, status, err = time.time() + 10, None, None
    while time.time() < deadline:
        db = SessionLocal()
        try:
            r = db.get(Run, run_id)
            status, err = r.status, r.error
        finally:
            db.close()
        if status in ("failed", "succeeded"):
            break
        time.sleep(0.2)
    assert status == "failed", (status, err)
    assert err and err.get("code") == LEGACY_ARCHIVED_CODE, err


# ---------- 数据封存工具（R-A3） ----------

def _seed_archive_fixture() -> dict:
    """1 个已归档 + 2 个未归档旧 Agent；活跃 Release；受/不受影响的 Schedule 与 AnalysisTask。"""
    agent_done = seed_agent(archived=True)
    agent_a = seed_agent(atype="dialogue")
    agent_b = seed_agent(atype="autonomous")
    ver = seed_version(agent_a["id"])
    rel = seed_release(agent_a["id"], ver["id"], environment="prod")
    bound_wf = client.post("/api/workflows", json={"name": uniq("绑定流")}).json()["id"]
    db = SessionLocal()
    try:
        db.get(Agent, agent_a["id"]).workflow_id = bound_wf
        db.commit()
    finally:
        db.close()
    # agent-exec 引用 agent_b 的独立工作流（发布被阻止，但调度/任务引用成立）
    ref_wf = client.post("/api/workflows", json={"name": uniq("引用流")}).json()["id"]
    g = client.get(f"/api/workflows/{ref_wf}").json()
    defn = g["definition"]
    defn["graph"]["nodes"] += [{"id": "a1", "type": "agent", "name": "旧",
                                "config": {"agentCode": agent_b["id"]}, "inputs": []}]
    client.put(f"/api/workflows/{ref_wf}/draft",
               json={"definition": defn, "baseRevision": g["draftRevision"]})

    rows = [
        Schedule(name=uniq("绑定调度"), workflow_id=bound_wf, cron_expr="0 1 * * *", enabled=True),
        Schedule(name=uniq("引用调度"), workflow_id=ref_wf, cron_expr="0 2 * * *", enabled=True),
        Schedule(name=uniq("已停调度"), workflow_id=bound_wf, cron_expr="0 3 * * *", enabled=False),
        Schedule(name=uniq("保留调度"), cron_expr="0 4 * * *", enabled=True),
        AnalysisTask(name=uniq("命中任务"), workflow_id=ref_wf, data_asset_id="x", status="active"),
        AnalysisTask(name=uniq("无关任务"), workflow_id=bound_wf, data_asset_id="x", status="active"),
    ]
    db = SessionLocal()
    try:
        db.add_all(rows)
        db.commit()
        return {"agent_done": agent_done, "agent_a": agent_a, "agent_b": agent_b,
                "release": rel, "workflow_ids": [bound_wf, ref_wf],
                "sch_bound": rows[0].id, "sch_ref": rows[1].id, "sch_off": rows[2].id,
                "sch_keep": rows[3].id, "task_hit": rows[4].id, "task_keep": rows[5].id}
    finally:
        db.close()


def test_archive_tool_dry_run_does_not_modify():
    fx = _seed_archive_fixture()
    plan = collect_archive_plan(SessionLocal())
    ids_a = {x["id"] for x in plan["agentsToArchive"]}
    assert {fx["agent_a"]["id"], fx["agent_b"]["id"]} <= ids_a
    assert fx["agent_done"]["id"] not in ids_a, "已归档 Agent 不重复进计划"
    assert any(r["id"] == fx["release"]["id"] for r in plan["releasesToOffline"])
    sch_ids = {s["id"] for s in plan["schedulesToDisable"]}
    assert {fx["sch_bound"], fx["sch_ref"]} <= sch_ids
    assert fx["sch_off"] not in sch_ids and fx["sch_keep"] not in sch_ids
    task_ids = {t["id"] for t in plan["tasksToPause"]}
    assert fx["task_hit"] in task_ids and fx["task_keep"] not in task_ids
    # dry-run 零副作用
    db = SessionLocal()
    try:
        assert db.get(Agent, fx["agent_a"]["id"]).archived is False
        assert db.get(Release, fx["release"]["id"]).status == "active"
        assert db.get(Schedule, fx["sch_bound"]).enabled is True
        assert db.get(AnalysisTask, fx["task_hit"]).status == "active"
    finally:
        db.close()


def test_archive_tool_apply_is_transactional_idempotent_and_audited():
    fx = _seed_archive_fixture()
    db = SessionLocal()
    try:
        summary = apply_archive(db, actor="pytest")
        changed = summary["changed"]
        assert fx["agent_a"]["id"] in changed["archivedAgents"]
        assert fx["agent_b"]["id"] in changed["archivedAgents"]
        assert fx["release"]["id"] in changed["offlineReleases"]
        assert {fx["sch_bound"], fx["sch_ref"]} <= set(changed["disabledSchedules"])
        assert fx["task_hit"] in changed["pausedTasks"]
        assert db.get(Agent, fx["agent_a"]["id"]).archived is True
        assert db.get(Agent, fx["agent_b"]["id"]).archived is True
        assert db.get(Release, fx["release"]["id"]).status == "offline"
        assert db.get(Schedule, fx["sch_bound"]).enabled is False
        assert db.get(Schedule, fx["sch_ref"]).enabled is False
        assert db.get(Schedule, fx["sch_off"]).enabled is False
        assert db.get(Schedule, fx["sch_keep"]).enabled is True  # 无 workflow 的调度不受影响
        assert db.get(AnalysisTask, fx["task_hit"]).status == "paused"
        assert db.get(AnalysisTask, fx["task_keep"]).status == "active"
        audits = (db.query(AuditLog).filter_by(action="legacy_agent.archive.apply")
                  .filter(AuditLog.detail["archivedAgents"].astext.contains(fx["agent_a"]["id"]))
                  .all())
        assert audits, "封存必须写审计日志"
    finally:
        db.close()
    # 幂等：重复 apply 无新改动、不重复写审计
    db = SessionLocal()
    try:
        before = db.query(AuditLog).filter_by(action="legacy_agent.archive.apply").count()
        assert apply_archive(db, actor="pytest")["changed"] == {}
        after = db.query(AuditLog).filter_by(action="legacy_agent.archive.apply").count()
        assert after == before
    finally:
        db.close()


def test_unknown_agent_write_still_404():
    assert client.put("/api/agents/nope-archive", json={"config": {}}).status_code == 404
    assert client.post("/api/agents/nope-archive/run", json={}).status_code == 404
