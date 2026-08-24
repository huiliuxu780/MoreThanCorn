"""Agent 层 API（三型 + 运行层 + 版本/发布，uiux/05 设计 + SDD 02）。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Agent, AgentVersion, KnowledgeSource, Release, Run, RunEvent, Tool, Workflow
from ..routers.workflows import _default_definition

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
def create_agent(payload: dict, db: Session = Depends(get_db)):
    t = payload.get("type", "dialogue")
    if t not in TYPE_LABEL:
        raise HTTPException(422, "unknown agent type")
    _check_name(payload.get("name", ""))
    wf_id = None
    if t in ("dialogue", "expert-group"):
        wf = Workflow(name=f"{payload['name']}的工作流")
        defn = _default_definition(wf.name)
        wf.draft_definition = defn.model_dump(mode="json")
        db.add(wf)
        db.commit()
        wf_id = wf.id
    agent = Agent(name=payload["name"], type=t, description=payload.get("description", ""),
                  workflow_id=wf_id,
                  config=payload.get("config", default_config(t)))
    db.add(agent)
    db.commit()
    return {"id": agent.id, "name": agent.name, "type": agent.type, "workflowId": wf_id,
            "configRevision": agent.config_revision}


def default_config(t: str) -> dict:
    if t == "autonomous":
        return {"rolePrompt": "# 角色：\n## 目标：\n## 技能：\n## 限制：", "modelRef": {"modelId": ""},
                "skills": [], "tools": [], "workflows": [], "knowledges": [], "memories": []}
    if t == "expert-group":
        return {"members": []}
    return {"knowledges": []}


@router.get("")
def list_agents(page: int = 1, pageSize: int = 20, search: str = "", db: Session = Depends(get_db)):
    q = db.query(Agent)
    if search:
        q = q.filter(Agent.name.ilike(f"%{search}%"))
    total = q.count()
    rows = q.order_by(Agent.updated_at.desc()).offset((page - 1) * pageSize).limit(pageSize).all()
    return {"items": [{"id": a.id, "name": a.name, "type": a.type, "typeLabel": TYPE_LABEL[a.type],
                       "status": a.status, "workflowId": a.workflow_id, "avatar": a.avatar,
                       "updatedAt": a.updated_at.isoformat()} for a in rows],
            "total": total, "page": page, "pageSize": pageSize}


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
def update_agent(aid: str, payload: dict, db: Session = Depends(get_db)):
    a = db.get(Agent, aid)
    if not a:
        raise HTTPException(404, "agent not found")
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
    if expected is not None:
        a.config_revision += 1
    db.commit()
    return {"id": a.id, "config": a.config, "configRevision": a.config_revision}


# ---------- 运行层（05 设计） ----------

@router.post("/{aid}/run", status_code=202)
def run_agent_endpoint(aid: str, payload: dict | None = None, db: Session = Depends(get_db)):
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
def create_agent_version(aid: str, payload: dict | None = None, db: Session = Depends(get_db)):
    """发布不可变版本：校验 → 同事务快照（配置+图+依赖冻结）→ artifactHash（02 §3）。"""
    from ..agent_release import (artifact_hash, build_common_config, build_definition,
                                 freeze_dependencies, next_version_no, validate_publish)
    a = db.get(Agent, aid)
    if not a:
        raise HTTPException(404, "agent not found")
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
    db.commit()
    return {"versionId": ver.id, "versionNo": ver.version_no, "artifactHash": ver.artifact_hash}


@router.get("/{aid}/versions")
def list_agent_versions(aid: str, db: Session = Depends(get_db)):
    vers = (db.query(AgentVersion).filter_by(agent_id=aid)
            .order_by(AgentVersion.version_no.desc()).all())
    return [{"versionId": v.id, "versionNo": v.version_no, "note": v.note,
             "artifactHash": v.artifact_hash, "createdAt": v.created_at.isoformat()} for v in vers]


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
def create_release(aid: str, payload: dict, db: Session = Depends(get_db)):
    """部署版本到环境（02 §3）：同环境旧 active → rolled_back；回滚=对旧版本再发一次。"""
    a = db.get(Agent, aid)
    if not a:
        raise HTTPException(404, "agent not found")
    env = (payload or {}).get("environment", "sandbox")
    if env not in ("sandbox", "prod"):
        raise HTTPException(422, detail={"code": "BAD_ENVIRONMENT", "message": "environment 必须是 sandbox|prod"})
    v = db.get(AgentVersion, (payload or {}).get("versionId", ""))
    if not v or v.agent_id != aid:
        raise HTTPException(404, detail={"code": "VERSION_NOT_FOUND", "message": "版本不存在"})
    for r in db.query(Release).filter_by(agent_id=aid, environment=env, status="active").all():
        r.status = "rolled_back"
    rel = Release(agent_id=aid, agent_version_id=v.id, environment=env)
    db.add(rel)
    if env == "sandbox":
        a.sandbox_version_id = v.id
    else:
        a.prod_version_id = v.id
    a.status = "published"
    db.commit()
    return {"releaseId": rel.id, "environment": env, "versionNo": v.version_no, "status": rel.status}


@router.get("/{aid}/releases")
def list_releases(aid: str, db: Session = Depends(get_db)):
    rows = db.query(Release).filter_by(agent_id=aid).order_by(Release.created_at.desc()).all()
    out = []
    for r in rows:
        v = db.get(AgentVersion, r.agent_version_id)
        out.append({"releaseId": r.id, "environment": r.environment, "status": r.status,
                    "versionNo": v.version_no if v else None, "createdAt": r.created_at.isoformat()})
    return out
