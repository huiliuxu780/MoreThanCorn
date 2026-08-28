"""Agent 层 API（三型 + 运行层 + 版本/发布，uiux/05 设计 + SDD 02）。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..legacy_agent_archive import assert_agent_executable
from ..models import Agent, AgentVersion, KnowledgeSource, Release, Run, RunEvent, Tool, Workflow
from ..routers.workflows import _default_definition
from ..auth import require_operator

router = APIRouter(prefix="/api/agents", tags=["agents"])

TYPE_LABEL = {"autonomous": "自主规划", "dialogue": "对话编排", "expert-group": "编排Agent专家组"}

# 调研 12 §3.1（SDD A-17）：数据库约束/服务端校验/前端 Schema 共用同一上限
NAME_MAX_LEN = 20


def _check_name(name: str) -> None:
    if name is not None and len(name) > NAME_MAX_LEN:
        raise HTTPException(400, detail={"code": "NAME_TOO_LONG",
                                         "message": f"名称不能超过 {NAME_MAX_LEN} 字",
                                         "path": "name"})


@router.post("", status_code=201)
def create_agent(payload: dict, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    """R-Archive（SDD 10 R-A2）：旧三类 Agent 已封存，不接受新建。
    新 Agent 将在领域 Module 体系下创建（SDD 10 R2，moduleKey）。"""
    from ..legacy_agent_archive import LegacyAgentArchivedError
    raise LegacyAgentArchivedError(
        "旧三类 Agent 已封存，仅支持历史查询；新 Agent 创建将在领域 Module 体系下开放")


def default_config(t: str) -> dict:
    if t == "autonomous":
        return {"rolePrompt": "# 角色：\n## 目标：\n## 技能：\n## 限制：", "modelRef": {"modelId": ""},
                "skills": [], "tools": [], "workflows": [], "knowledges": [], "memories": []}
    if t == "expert-group":
        return {"members": []}
    return {"knowledges": []}


@router.get("")
def list_agents(page: int = 1, pageSize: int = 20, search: str = "", archived: str = "",
                db: Session = Depends(get_db)):
    q = db.query(Agent)
    # E-2.1：默认隐藏已归档；archived=true 只看归档；all 全部
    if archived == "true":
        q = q.filter(Agent.archived.is_(True))
    elif archived != "all":
        q = q.filter(Agent.archived.is_(False))
    if search:
        q = q.filter(Agent.name.ilike(f"%{search}%"))
    total = q.count()
    rows = q.order_by(Agent.updated_at.desc()).offset((page - 1) * pageSize).limit(pageSize).all()
    items = []
    for a in rows:
        latest = (db.query(AgentVersion).filter_by(agent_id=a.id)
                  .order_by(AgentVersion.version_no.desc()).first())

        def _env_ver(vid):
            v = db.get(AgentVersion, vid) if vid else None
            return v.version_no if v else None
        items.append({"id": a.id, "name": a.name, "type": a.type, "typeLabel": TYPE_LABEL[a.type],
                      "status": a.status, "workflowId": a.workflow_id, "avatar": a.avatar,
                      "archived": bool(a.archived),
                      "latestVersion": latest.version_no if latest else None,
                      "sandboxVersion": _env_ver(a.sandbox_version_id),
                      "prodVersion": _env_ver(a.prod_version_id),
                      "updatedAt": a.updated_at.isoformat()})
    return {"items": items, "total": total, "page": page, "pageSize": pageSize}


@router.get("/{aid}")
def get_agent(aid: str, db: Session = Depends(get_db)):
    a = db.get(Agent, aid)
    if not a:
        raise HTTPException(404, "agent not found")
    return {"id": a.id, "name": a.name, "type": a.type, "typeLabel": TYPE_LABEL[a.type],
            "status": a.status, "workflowId": a.workflow_id, "config": a.config,
            "configRevision": a.config_revision,
            "description": a.description, "avatar": a.avatar}


@router.put("/{aid}")
def update_agent(aid: str, payload: dict, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    a = db.get(Agent, aid)
    if not a:
        raise HTTPException(404, "agent not found")
    assert_agent_executable(a)  # R-Archive：旧 Agent 只读（含 archived 开关）
    # SDD A-08 乐观锁：携带 expectedRevision 时校验，冲突 409（旧调用不带则兼容放行）
    expected = payload.get("expectedRevision")
    if expected is not None and int(expected) != a.config_revision:
        raise HTTPException(409, detail={"code": "REVISION_CONFLICT",
                                         "message": "Agent 配置已被更新，请刷新后重试",
                                         "currentRevision": a.config_revision})
    if "name" in payload:
        _check_name(payload["name"])
        a.name = payload["name"]
    if "config" in payload:
        a.config = payload["config"]
    if "workflowId" in payload:
        a.workflow_id = payload["workflowId"]
    if "avatar" in payload:
        a.avatar = payload["avatar"]
    if "description" in payload:
        a.description = payload["description"]
    if "archived" in payload:
        a.archived = bool(payload["archived"])
    if expected is not None:
        a.config_revision += 1
    db.commit()
    return {"id": a.id, "config": a.config, "configRevision": a.config_revision, "archived": bool(a.archived)}


@router.post("/{aid}/duplicate", status_code=201)
def duplicate_agent(aid: str, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    """E-2.1：复制 Agent（新 id、名称+「 副本」受 20 字上限约束、草稿复制；版本/部署不带）。"""
    src = db.get(Agent, aid)
    if not src:
        raise HTTPException(404, "agent not found")
    assert_agent_executable(src)  # R-Archive：旧 Agent 不复制
    suffix = " 副本"
    base = src.name if len(src.name) + len(suffix) <= NAME_MAX_LEN else src.name[:NAME_MAX_LEN - len(suffix)]
    name = base + suffix
    # 同名重复复制时追加序号，避免撞名混淆
    n = 2
    while db.query(Agent).filter_by(name=name).first():
        tail = f"{suffix}{n}"
        name = (src.name[:NAME_MAX_LEN - len(tail)] if len(src.name) + len(tail) > NAME_MAX_LEN else src.name) + tail
        n += 1
    wf_id = None
    if src.workflow_id:
        src_wf = db.get(Workflow, src.workflow_id)
        wf = Workflow(name=f"{name}的工作流")
        wf.draft_definition = dict(src_wf.draft_definition) if src_wf and src_wf.draft_definition else _default_definition(wf.name).model_dump(mode="json")
        db.add(wf)
        db.flush()
        wf_id = wf.id
    copy = Agent(name=name, type=src.type, description=src.description, workflow_id=wf_id,
                 avatar=src.avatar, config=dict(src.config or {}))
    db.add(copy)
    from .admin import audit
    audit(db, "质量管理员", "agent.duplicate", "agent", copy.id, {"sourceId": aid})
    db.commit()
    return {"id": copy.id, "name": copy.name, "type": copy.type, "workflowId": wf_id,
            "configRevision": copy.config_revision}


@router.get("/{aid}/definition-draft")
def get_draft_definition(aid: str, db: Session = Depends(get_db)):
    """E-2.2：当前草稿 definition 预览（供版本对比）。"""
    from ..agent_release import build_definition
    a = db.get(Agent, aid)
    if not a:
        raise HTTPException(404, "agent not found")
    try:
        return {"definition": build_definition(db, a)}
    except ValueError as e:
        raise HTTPException(409, detail={"code": "NO_WORKFLOW", "message": str(e)})


# ---------- 运行层（05 设计） ----------

@router.post("/{aid}/run", status_code=202)
def run_agent_endpoint(aid: str, payload: dict | None = None, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    """SDD A-03：顶层运行异步入队。SDD B-03：可指定 versionId；
    schedule/api 触发默认走沙箱已发布版本，无版本 422。"""
    a = db.get(Agent, aid)
    if not a:
        raise HTTPException(404, "agent not found")
    from ..agent_runtime import RunError, run_agent
    try:
        run_id = run_agent(db, a, (payload or {}).get("input") or {},
                           trigger=(payload or {}).get("trigger", "agent"),
                           version_id=(payload or {}).get("versionId"))
    except RunError as e:
        msg = str(e)
        if msg.startswith("NO_RELEASED_VERSION"):
            raise HTTPException(422, detail={"code": "NO_RELEASED_VERSION", "message": msg})
        raise HTTPException(409, msg)
    return {"runId": run_id}


@router.get("/{aid}/runs")
def list_agent_runs(aid: str, db: Session = Depends(get_db)):
    rows = db.query(Run).filter_by(agent_id=aid).order_by(Run.created_at.desc()).limit(20).all()
    return {"items": [{"runId": r.id, "status": r.status, "trigger": r.trigger,
                       "startedAt": r.started_at.isoformat() if r.started_at else None,
                       "endedAt": r.ended_at.isoformat() if r.ended_at else None,
                       "error": r.error, "durationMs": r.duration_ms} for r in rows]}


@router.get("/{aid}/runs/{run_id}")
def agent_run_detail(aid: str, run_id: str, db: Session = Depends(get_db)):
    r = db.get(Run, run_id)
    if not r or r.agent_id != aid:
        raise HTTPException(404, "run not found")
    evs = db.query(RunEvent).filter_by(run_id=run_id).order_by(RunEvent.sequence).all()
    return {"runId": r.id, "status": r.status, "trigger": r.trigger, "input": r.input,
            "output": r.output, "error": r.error, "durationMs": r.duration_ms,
            "events": [{"type": e.type, "payload": e.payload,
                        "at": e.created_at.isoformat()} for e in evs]}


@router.get("/{aid}/mounts-health")
def mounts_health(aid: str, db: Session = Depends(get_db)):
    a = db.get(Agent, aid)
    if not a:
        raise HTTPException(404, "agent not found")
    cfg = a.config or {}
    items = []
    for s in cfg.get("skills", []):
        items.append({"kind": "skill", "name": s, "valid": True})
    for tname in cfg.get("tools", []):
        t = db.get(Tool, tname) or db.query(Tool).filter_by(name=tname).first()
        items.append({"kind": "tool", "name": tname, "valid": bool(t and t.status in ("ready", "enabled"))})
    for wname in cfg.get("workflows", []):
        w = db.get(Workflow, wname) or db.query(Workflow).filter_by(name=wname).first()
        items.append({"kind": "workflow", "name": wname, "valid": bool(w and w.status == "published")})
    for kname in cfg.get("knowledges", []):
        k = db.get(KnowledgeSource, kname) or db.query(KnowledgeSource).filter_by(name=kname).first()
        items.append({"kind": "knowledge", "name": kname, "valid": bool(k and k.status == "enabled")})
    for m in cfg.get("memories", []):
        items.append({"kind": "memory", "name": m, "valid": True})
    return {"items": items}


# ---------- 版本与发布（SDD 02） ----------

@router.post("/{aid}/versions", status_code=201)
def create_agent_version(aid: str, payload: dict | None = None, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    """发布不可变版本：校验 → 同事务快照（配置+图+依赖冻结）→ artifactHash（02 §3）。"""
    from ..agent_release import (artifact_hash, build_common_config, build_definition,
                                 freeze_dependencies, next_version_no, validate_publish)
    a = db.get(Agent, aid)
    if not a:
        raise HTTPException(404, "agent not found")
    assert_agent_executable(a)  # R-Archive：旧 Agent 不再创建版本
    try:
        definition = build_definition(db, a)
    except ValueError as e:
        raise HTTPException(409, detail={"code": "NO_WORKFLOW", "message": str(e)})
    common = build_common_config(a)
    issues = validate_publish(db, a, definition, common)
    if issues:
        raise HTTPException(409, detail={"code": "VALIDATION_FAILED", "issues": issues})
    deps = freeze_dependencies(db, a, definition)
    blocking = [i for i in deps["items"] if i["status"] in ("MISSING", "NO_READY_VERSION", "DISABLED")]
    if blocking:
        raise HTTPException(409, detail={"code": "DEPENDENCY_INVALID", "issues": [
            {"code": f"DEP_{i['status']}", "message": f"{i['type']} {i['ref']} {i['status']}"} for i in blocking]})
    ver = AgentVersion(agent_id=aid, version_no=next_version_no(db, aid),
                       definition=definition, common_config=common, dependency_snapshot=deps,
                       artifact_hash=artifact_hash(definition, common, deps),
                       note=(payload or {}).get("note", ""))
    db.add(ver)
    a.status = "published"
    from .admin import audit
    audit(db, "质量管理员", "agent.version.create", "agent", aid,
          {"versionNo": ver.version_no, "artifactHash": ver.artifact_hash})
    db.commit()
    return {"versionId": ver.id, "versionNo": ver.version_no, "artifactHash": ver.artifact_hash}


@router.get("/{aid}/versions")
def list_agent_versions(aid: str, db: Session = Depends(get_db)):
    vers = (db.query(AgentVersion).filter_by(agent_id=aid)
            .order_by(AgentVersion.version_no.desc()).all())
    out = []
    for v in vers:
        # SDD D-1：成员冻结版本摘要（依赖快照中的 AGENT 项）
        members = [{"ref": i.get("ref"), "version": i.get("version")}
                   for i in ((v.dependency_snapshot or {}).get("items") or [])
                   if i.get("type") == "AGENT"]
        out.append({"versionId": v.id, "versionNo": v.version_no, "note": v.note,
                    "artifactHash": v.artifact_hash, "createdAt": v.created_at.isoformat(),
                    "frozenMembers": members})
    return out


@router.get("/{aid}/versions/{vid}")
def get_agent_version(aid: str, vid: str, db: Session = Depends(get_db)):
    v = db.get(AgentVersion, vid)
    if not v or v.agent_id != aid:
        raise HTTPException(404, "agent version not found")
    return {"versionId": v.id, "versionNo": v.version_no, "note": v.note,
            "artifactHash": v.artifact_hash, "schemaVersion": v.schema_version,
            "definition": v.definition, "commonConfig": v.common_config,
            "dependencySnapshot": v.dependency_snapshot, "createdAt": v.created_at.isoformat()}


@router.post("/{aid}/releases", status_code=201)
def create_release(aid: str, payload: dict, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    """部署版本到环境（02 §3）：同环境旧 active → rolled_back；回滚=对旧版本再发一次。
    E-2.3 灰度：canaryPercent>0 时与稳定版并存（同环境至多一条灰度），不动稳定指针。"""
    a = db.get(Agent, aid)
    if not a:
        raise HTTPException(404, "agent not found")
    assert_agent_executable(a)  # R-Archive：旧 Agent 不再部署/回滚
    env = (payload or {}).get("environment", "sandbox")
    if env not in ("sandbox", "prod"):
        raise HTTPException(422, detail={"code": "BAD_ENVIRONMENT", "message": "environment 必须是 sandbox|prod"})
    try:
        canary_percent = int((payload or {}).get("canaryPercent", 0))
    except (TypeError, ValueError):
        raise HTTPException(422, detail={"code": "BAD_CANARY", "message": "canaryPercent 必须是 0-100 整数"})
    if not 0 <= canary_percent <= 100:
        raise HTTPException(422, detail={"code": "BAD_CANARY", "message": "canaryPercent 必须是 0-100 整数"})
    v = db.get(AgentVersion, (payload or {}).get("versionId", ""))
    if not v or v.agent_id != aid:
        raise HTTPException(404, detail={"code": "VERSION_NOT_FOUND", "message": "版本不存在"})
    actives = db.query(Release).filter_by(agent_id=aid, environment=env, status="active").all()
    if canary_percent > 0:
        # 灰度部署：只替换已有灰度，稳定版保持
        for r in actives:
            if r.canary_percent:
                r.status = "rolled_back"
    else:
        # 全量部署：同环境全部 active（含灰度）→ rolled_back
        for r in actives:
            r.status = "rolled_back"
    rel = Release(agent_id=aid, agent_version_id=v.id, environment=env, canary_percent=canary_percent)
    db.add(rel)
    if canary_percent == 0:
        if env == "sandbox":
            a.sandbox_version_id = v.id
        else:
            a.prod_version_id = v.id
    a.status = "published"
    from .admin import audit
    audit(db, "质量管理员", "agent.release", "agent", aid,
          {"versionNo": v.version_no, "environment": env, "canaryPercent": canary_percent})
    db.commit()
    return {"releaseId": rel.id, "environment": env, "versionNo": v.version_no,
            "status": rel.status, "canaryPercent": canary_percent}


@router.post("/{aid}/releases/{rid}/stop-canary")
def stop_canary(aid: str, rid: str, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    """E-2.3：停止灰度=该 release rolled_back（流量全部回到稳定版）。"""
    rel = db.get(Release, rid)
    if not rel or rel.agent_id != aid:
        raise HTTPException(404, "release not found")
    assert_agent_executable(db.get(Agent, aid))  # R-Archive：旧 Agent 发布生命周期冻结
    if rel.status != "active" or not rel.canary_percent:
        raise HTTPException(409, detail={"code": "NOT_CANARY_ACTIVE", "message": "该记录不是进行中的灰度发布"})
    rel.status = "rolled_back"
    from .admin import audit
    audit(db, "质量管理员", "agent.canary.stop", "agent", aid, {"releaseId": rid})
    db.commit()
    return {"releaseId": rid, "status": rel.status}


@router.get("/{aid}/releases")
def list_releases(aid: str, db: Session = Depends(get_db)):
    rows = db.query(Release).filter_by(agent_id=aid).order_by(Release.created_at.desc()).all()
    out = []
    for r in rows:
        v = db.get(AgentVersion, r.agent_version_id)
        out.append({"releaseId": r.id, "environment": r.environment, "status": r.status,
                    "canaryPercent": r.canary_percent or 0,
                    "versionNo": v.version_no if v else None, "createdAt": r.created_at.isoformat()})
    return out


# ---------- 运行观测与评测（SDD D-1） ----------

@router.get("/{aid}/metrics")
def agent_metrics(aid: str, db: Session = Depends(get_db)):
    """Agent 级观测指标：总数/成功率/平均时长/近 7 日趋势（SDD D-1）。"""
    from sqlalchemy import func as _func
    from ..models import RunEvent
    runs = db.query(Run).filter_by(agent_id=aid).all()
    total = len(runs)
    succeeded = sum(1 for r in runs if r.status == "succeeded")
    failed = sum(1 for r in runs if r.status == "failed")
    durs = [r.duration_ms for r in runs if r.duration_ms is not None]
    # 调研 07 §6 观测指标：Token 消耗
    total_tokens = sum(int((t := (r.token_usage or {})).get("total")
                         or (t.get("prompt", 0) or 0) + (t.get("completion", 0) or 0)) for r in runs)
    # E-3.4：首 token 耗时 = 首个 llm_delta 事件 − run.started_at（avg/p50）
    first_tokens: list[int] = []
    run_ids = [r.id for r in runs if r.started_at]
    if run_ids:
        deltas = dict(db.query(RunEvent.run_id, _func.min(RunEvent.created_at))
                      .filter(RunEvent.run_id.in_(run_ids), RunEvent.type == "llm_delta")
                      .group_by(RunEvent.run_id).all())
        for r in runs:
            first = deltas.get(r.id)
            if first and r.started_at:
                ms = int((first - r.started_at).total_seconds() * 1000)
                if ms >= 0:
                    first_tokens.append(ms)
    first_tokens.sort()
    ft = {"avgMs": int(sum(first_tokens) / len(first_tokens)) if first_tokens else None,
          "p50Ms": first_tokens[len(first_tokens) // 2] if first_tokens else None,
          "samples": len(first_tokens)}
    return {"total": total, "succeeded": succeeded, "failed": failed,
            "successRate": round(succeeded / total, 3) if total else 0,
            "avgDurationMs": int(sum(durs) / len(durs)) if durs else 0,
            "maxDurationMs": max(durs) if durs else 0,
            "totalTokens": total_tokens, "firstToken": ft}


@router.post("/{aid}/eval-run", status_code=201)
def agent_eval_run(aid: str, payload: dict | None = None, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    """Agent 级评测：样本逐个真实运行（同步等待终态），返回结果（SDD D-1）。
    D-3：judge=rule（期望包含匹配）或 model（LLM 打分 1-5）；结果落 judge_result。"""
    from ..models import EvalSample
    from ..agent_runtime import RunError, run_agent
    a = db.get(Agent, aid)
    if not a:
        raise HTTPException(404, "agent not found")
    assert_agent_executable(a)  # R-Archive：旧 Agent 评测运行封存
    judge = (payload or {}).get("judge") or "none"
    samples = db.query(EvalSample).filter_by(agent_id=aid).all()
    ids = (payload or {}).get("sampleIds") or [s.id for s in samples]
    results = []
    for s in samples:
        if s.id not in ids:
            continue
        try:
            run_id = run_agent(db, a, s.input or {}, trigger="eval", enqueue=False)
            r = db.get(Run, run_id)
            output_text = str((r.output or {}).get("content", ""))
            judge_result = None
            expected_text = str((s.expected or {}).get("text", "")) if s.expected else ""
            if judge == "rule" and expected_text:
                score = 1.0 if expected_text in output_text else 0.0
                judge_result = {"kind": "rule", "score": score,
                                "passed": expected_text in output_text}
            elif judge == "model" and (expected_text or output_text):
                judge_result = _model_judge(db, str((s.input or {}).get("userQuery", "")),
                                            expected_text, output_text)
            if judge_result:
                s.judge_result = judge_result
            results.append({"sampleId": s.id, "name": s.name, "runId": run_id, "status": r.status,
                            "durationMs": r.duration_ms,
                            "output": output_text[:120],
                            "judge": judge_result,
                            "error": (r.error or {}).get("message") if r.status == "failed" else None})
        except RunError as e:
            results.append({"sampleId": s.id, "name": s.name, "status": "failed", "error": str(e)})
    db.commit()
    succeeded = sum(1 for r in results if r["status"] == "succeeded")
    return {"total": len(results), "succeeded": succeeded, "results": results}


def _model_judge(db, question: str, expected: str, actual: str) -> dict:
    """模型 Judge：LLM 对回答打 1-5 分（真实调用；失败回落规则）。"""
    from ..runner import _call_model
    try:
        answer, _t = _call_model(
            db, "qwen-plus",
            f"你是评测裁判。请给回答打 1-5 分（5 最好），只输出一个数字。\n问题：{question[:300]}\n"
            f"参考答案：{expected[:300] or '（无）'}\n实际回答：{actual[:500]}")
        digits = "".join(ch for ch in (answer or "") if ch.isdigit())
        score = float(digits[0]) if digits else 3.0
        return {"kind": "model", "score": min(max(score, 1.0), 5.0)}
    except Exception:  # noqa: BLE001
        score = 1.0 if expected and expected not in actual else (3.0 if not expected else 0.0)
        return {"kind": "model-fallback-rule", "score": score}


@router.post("/{aid}/eval-samples/{sid}/human-score")
def human_score_sample(aid: str, sid: str, payload: dict, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    """D-3：人评——手动给样本打分（覆盖/补充机器 Judge）。"""
    from ..models import EvalSample
    s = db.get(EvalSample, sid)
    if not s or s.agent_id != aid:
        raise HTTPException(404, "样本不存在")
    assert_agent_executable(db.get(Agent, aid))  # R-Archive：旧 Agent 评测数据冻结
    score = (payload or {}).get("score")
    if score is None or not (0 <= float(score) <= 5):
        raise HTTPException(422, "score 必须在 0-5 之间")
    s.judge_result = {"kind": "human", "score": float(score), "note": (payload or {}).get("note", "")}
    db.commit()
    return {"id": s.id, "judge": s.judge_result}


# ---------- 进化：失败归因 → 候选补丁 → 审批应用（SDD D-3） ----------

@router.post("/{aid}/evolution/candidates", status_code=201)
def create_evolution_candidate(aid: str, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    """基于近期失败运行归因，LLM 生成 Prompt 候选补丁（真实生成；失败给明确错误）。"""
    from ..models import EvolutionPatch
    from ..runner import _call_model
    a = db.get(Agent, aid)
    if not a:
        raise HTTPException(404, "agent not found")
    assert_agent_executable(a)  # R-Archive：旧 Agent 不再进化
    failed = (db.query(Run).filter(Run.agent_id == aid, Run.status == "failed")
              .order_by(Run.created_at.desc()).limit(5).all())
    if not failed:
        raise HTTPException(422, detail={"code": "NO_FAILURES", "message": "近期没有失败运行，无需进化"})
    errors = "\n".join(f"- {(r.error or {}).get('message', '未知错误')[:120]}" for r in failed)
    base_prompt = str((a.config or {}).get("rolePrompt", ""))
    attribution = "timeout" if any("护栏" in (r.error or {}).get("message", "") for r in failed) \
        else ("tool_failed" if any("失败" in (r.error or {}).get("message", "") for r in failed) else "other")
    try:
        proposed, _t = _call_model(
            db, "qwen-plus",
            f"以下是 Agent 的角色提示词与近期失败原因。请输出改进后的完整提示词（保持原结构，"
            f"针对失败原因补充约束与边界说明），直接输出提示词本身。\n原提示词：\n{base_prompt[:1500]}\n失败：\n{errors}")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, detail={"code": "GENERATE_FAILED", "message": str(exc)})
    patch = EvolutionPatch(agent_id=aid, attribution=attribution, reason=errors[:800],
                           base_prompt=base_prompt, proposed_prompt=str(proposed or "").strip())
    db.add(patch)
    db.commit()
    return {"id": patch.id, "attribution": attribution, "basePrompt": base_prompt,
            "proposedPrompt": patch.proposed_prompt, "status": patch.status}


@router.get("/{aid}/evolution")
def list_evolution(aid: str, db: Session = Depends(get_db)):
    from ..models import EvolutionPatch
    rows = (db.query(EvolutionPatch).filter_by(agent_id=aid)
            .order_by(EvolutionPatch.created_at.desc()).limit(20).all())
    return [{"id": p.id, "attribution": p.attribution, "reason": p.reason[:200],
             "status": p.status, "createdAt": p.created_at.isoformat()} for p in rows]


@router.post("/{aid}/evolution/{pid}/apply")
def apply_evolution(aid: str, pid: str, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    """应用候选补丁到草稿（可撤销=再次编辑；历史补丁保留记录）。"""
    from ..models import EvolutionPatch
    p = db.get(EvolutionPatch, pid)
    if not p or p.agent_id != aid:
        raise HTTPException(404, "补丁不存在")
    if p.status != "pending":
        raise HTTPException(409, "补丁已处理")
    a = db.get(Agent, aid)
    assert_agent_executable(a)  # R-Archive：旧 Agent 配置冻结
    cfg = dict(a.config or {})
    cfg["rolePrompt"] = p.proposed_prompt
    a.config = cfg
    a.config_revision += 1
    p.status = "applied"
    db.commit()
    return {"id": p.id, "status": "applied", "configRevision": a.config_revision}


@router.post("/{aid}/evolution/{pid}/reject")
def reject_evolution(aid: str, pid: str, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    from ..models import EvolutionPatch
    p = db.get(EvolutionPatch, pid)
    if not p or p.agent_id != aid:
        raise HTTPException(404, "补丁不存在")
    assert_agent_executable(db.get(Agent, aid))  # R-Archive：旧 Agent 进化记录冻结
    p.status = "rejected"
    db.commit()
    return {"id": p.id, "status": "rejected"}


@router.get("/{aid}/eval-samples")
def list_agent_eval_samples(aid: str, db: Session = Depends(get_db)):
    from ..models import EvalSample
    rows = db.query(EvalSample).filter_by(agent_id=aid).all()
    return {"items": [{"id": s.id, "agentId": s.agent_id, "name": s.name,
                       "input": s.input, "expected": s.expected} for s in rows]}


@router.post("/{aid}/eval-samples", status_code=201)
def create_agent_eval_sample(aid: str, payload: dict, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    from ..models import EvalSample
    a = db.get(Agent, aid)
    if not a:
        raise HTTPException(404, "agent not found")
    assert_agent_executable(a)  # R-Archive：旧 Agent 评测样本冻结
    s = EvalSample(agent_id=aid, name=payload.get("name") or "样本",
                   input=payload.get("input", {}), expected=payload.get("expected"))
    db.add(s)
    db.commit()
    return {"id": s.id, "name": s.name}


@router.post("/generate-prompt", status_code=201)
def generate_prompt(payload: dict, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    """AI 生成 Prompt（SDD D-1）：真 LLM 生成，失败给出明确错误。"""
    from ..runner import _call_model
    name = (payload or {}).get("name") or "智能助手"
    hint = (payload or {}).get("hint") or ""
    try:
        answer, _t = _call_model(
            db, "qwen-plus",
            f"为名为「{name}」的 Agent 写一份中文角色提示词，包含 角色/目标/技能/限制 四节，"
            f"使用 Markdown，直接输出提示词本身。补充要求：{hint or '无'}")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, detail={"code": "GENERATE_FAILED", "message": str(exc)})
    return {"prompt": (answer or "").strip()}
