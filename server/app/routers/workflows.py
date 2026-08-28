from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import require_operator
from ..db import get_db
from ..models import Workflow, WorkflowVersion, new_id
from ..schemas import (
    CreateWorkflowRequest,
    SaveDraftRequest,
    SaveDraftResponse,
    WorkflowDefinition,
    WorkflowSummary,
)
from ..validator import validate

router = APIRouter(prefix="/api/workflows", tags=["workflows"])


def _default_definition(name: str) -> WorkflowDefinition:
    return WorkflowDefinition.model_validate({
        "schemaVersion": "1.0",
        "workflow": {"id": "", "name": name, "status": "draft", "draftRevision": 1},
        "graph": {
            "nodes": [
                {"id": "n_start", "type": "input", "name": "开始",
                 "config": {}, "inputs": []},
                {"id": "n_end", "type": "end", "name": "结束",
                 "config": {"outputKey": "quality_result"}, "inputs": [
                     {"name": "output", "type": "string",
                      "source": {"kind": "fixed", "value": ""}}]},
            ],
            "edges": [{"id": "e_start_end", "source": "n_start", "target": "n_end"}],
        },
        "io": {"inputSchema": {}, "structuredOutputs": [{"key": "quality_result", "schema": {}}]},
        "ui": {"positions": {"n_start": {"x": 80, "y": 160}, "n_end": {"x": 640, "y": 160}},
               "viewport": {}},
    })


@router.post("", status_code=201)
def create_workflow(req: CreateWorkflowRequest, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    wf = Workflow(id=new_id(), name=req.name, description=req.description)
    defn = _default_definition(req.name)
    defn.workflow.id = wf.id
    wf.draft_definition = defn.model_dump(mode="json")
    db.add(wf)
    db.commit()
    db.refresh(wf)
    return {"id": wf.id, "name": wf.name, "status": wf.status}


@router.get("")
def list_workflows(search: str = "", page: int = 1, pageSize: int = 20,
                   db: Session = Depends(get_db)):
    from ..models import Agent, WorkflowVersion
    q = db.query(Workflow).order_by(Workflow.updated_at.desc())
    if search:
        q = q.filter(Workflow.name.ilike(f"%{search}%"))
    total = q.count()
    items = q.offset((page - 1) * pageSize).limit(pageSize).all()
    out = []
    for w in items:
        version_count = db.query(WorkflowVersion).filter_by(workflow_id=w.id).count()
        node_count = len((w.draft_definition or {}).get("graph", {}).get("nodes", []))
        agent_refs = db.query(Agent).filter_by(workflow_id=w.id).count()
        out.append({**WorkflowSummary(
            id=w.id, name=w.name, status=w.status, currentVersion=None,
            updatedAt=w.updated_at.isoformat()).model_dump(),
            "versionCount": version_count, "nodeCount": node_count, "agentRefCount": agent_refs,
            "icon": w.icon})
    return {"items": out, "total": total, "page": page, "pageSize": pageSize}


@router.get("/{wf_id}")
def get_workflow(wf_id: str, db: Session = Depends(get_db)):
    wf = db.get(Workflow, wf_id)
    if not wf:
        raise HTTPException(404, "workflow not found")
    # 09 P2-08：当前生效版本可见（发布治理依赖）
    cur_no = None
    if wf.current_version_id:
        cur = db.get(WorkflowVersion, wf.current_version_id)
        cur_no = cur.version_no if cur else None
    return {"id": wf.id, "name": wf.name, "status": wf.status,
            "draftRevision": wf.draft_revision, "definition": wf.draft_definition,
            "currentVersionId": wf.current_version_id, "currentVersionNo": cur_no,
            "updatedAt": wf.updated_at.isoformat()}


@router.post("/{wf_id}/migrate", status_code=200)
def migrate_workflow(wf_id: str, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    """07-SDD §5.3（08-26 修订）：agent 三键→workflow 三连为显式迁移工具。

    GET/保存保持透传（冻结 Agent 轨道的画布仍用旧键编辑与运行，兼容层可执行）；
    独立工作流由用户/运维显式触发迁移并落盘。"""
    from ..runner import migrate_definition
    wf = db.get(Workflow, wf_id)
    if not wf:
        raise HTTPException(404, "workflow not found")
    import copy
    defn, changed = migrate_definition(db, copy.deepcopy(wf.draft_definition or {}))
    if changed:
        wf.draft_definition = defn  # 新对象引用，触发 JSONB dirty
        wf.draft_revision += 1
        wf.updated_at = datetime.now(timezone.utc)
        db.commit()
    return {"migrated": changed, "draftRevision": wf.draft_revision}


@router.post("/{wf_id}/polish")
def polish_prompt(wf_id: str, payload: dict, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    """07-SDD §4.3：提示词 AI 润色（替换/重试由前端交互层承担）。"""
    from ..runner import _call_model
    text = payload.get("text") or ""
    if not text.strip():
        raise HTTPException(422, "text 为空")
    try:
        answer, _t = _call_model(
            db, payload.get("model") or "qwen-plus",
            "优化以下指令提示词，使其更清晰、结构化；直接输出优化结果，不要解释：\n" + text)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"polish failed: {e}")
    return {"text": answer}


@router.put("/{wf_id}/meta")
def update_workflow_meta(wf_id: str, payload: dict, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    """08-26：工作流基础信息编辑（名称/简介/图标）。"""
    wf = db.get(Workflow, wf_id)
    if not wf:
        raise HTTPException(404, "workflow not found")
    if payload.get("name"):
        wf.name = str(payload["name"]).strip()[:64]
    if "description" in payload:
        wf.description = payload.get("description") or ""
    if "icon" in payload:
        wf.icon = payload.get("icon")
    db.commit()
    return {"ok": True}


@router.put("/{wf_id}/draft")
def save_draft(wf_id: str, req: SaveDraftRequest, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    wf = db.get(Workflow, wf_id)
    if not wf:
        raise HTTPException(404, "workflow not found")
    if req.baseRevision != wf.draft_revision:
        raise HTTPException(409, "draft revision conflict")
    defn = req.definition
    defn.workflow.id = wf_id
    wf.draft_definition = defn.model_dump(mode="json")
    wf.draft_revision += 1
    wf.updated_at = datetime.now(timezone.utc)
    db.commit()
    return SaveDraftResponse(workflowCode=wf_id, draftVersion=f"V1.0.{wf.draft_revision}",
                             savedAt=wf.updated_at.isoformat())


@router.get("/{wf_id}/validation")
def validate_workflow(wf_id: str, db: Session = Depends(get_db)):
    wf = db.get(Workflow, wf_id)
    if not wf:
        raise HTTPException(404, "workflow not found")
    defn = WorkflowDefinition.model_validate(wf.draft_definition)
    return validate(defn)


@router.post("/{wf_id}/publish", status_code=201)
def publish_workflow(wf_id: str, note: str = "", db: Session = Depends(get_db),
                     user: dict = Depends(require_operator)):
    wf = db.get(Workflow, wf_id)
    if not wf:
        raise HTTPException(404, "workflow not found")
    defn = WorkflowDefinition.model_validate(wf.draft_definition)
    report = validate(defn)
    if not report.ok:
        raise HTTPException(409, detail=report.model_dump())
    # R-Archive（SDD 10 R-A4）：发布校验阻止引用已封存旧 Agent 的工作流
    from ..legacy_agent_archive import (LEGACY_ARCHIVED_CODE, LEGACY_ARCHIVED_MESSAGE,
                                        workflow_legacy_refs)
    refs = workflow_legacy_refs(db, wf_id)
    if refs:
        raise HTTPException(409, detail={
            "ok": False, "code": LEGACY_ARCHIVED_CODE, "message": LEGACY_ARCHIVED_MESSAGE,
            "issues": [{"code": LEGACY_ARCHIVED_CODE,
                        "message": f"节点 {h['nodeId']}（{h['type']}）引用已封存 Agent"
                                   f"「{h['agentName']}」，发布被阻止",
                        "nodeId": h["nodeId"], "agentId": h["agentId"]}
                       for h in refs]})
    version_no = (db.query(WorkflowVersion)
                  .filter_by(workflow_id=wf_id).count()) + 1
    # 07-SDD form：发布快照冻结 form 字段（与 tool 版本冻结同哲学）
    import copy as _copy
    frozen_def = _copy.deepcopy(wf.draft_definition)
    from ..models import Form as _Form
    for nd in (frozen_def or {}).get("graph", {}).get("nodes", []):
        if nd.get("type") == "input":
            fid = (nd.get("config") or {}).get("formId")
            if fid:
                f = db.get(_Form, fid)
                if f:
                    (nd.setdefault("config", {}))["formSnapshot"] = [dict(x) for x in (f.fields or [])]
    ver = WorkflowVersion(workflow_id=wf_id, version_no=version_no,
                          definition=frozen_def, note=note,
                          **_collect_refs(wf.draft_definition))
    db.add(ver)
    wf.status = "published"
    db.commit()
    db.refresh(ver)
    wf.current_version_id = ver.id
    # 发布同步（05 设计）：绑定该工作流的 Agent 状态同步为 published
    # R-Archive：旧 Agent 已封存只读，跳过状态回写（独立 Workflow 发布不受影响）
    from ..legacy_agent_archive import is_legacy_agent
    from ..models import Agent
    for a in db.query(Agent).filter_by(workflow_id=wf_id).all():
        if not is_legacy_agent(a):
            a.status = "published"
    from .admin import audit
    audit(db, user.get("username", "system"), "workflow.publish", "workflow", wf_id,
          {"versionNo": ver.version_no})
    db.commit()
    return {"versionId": ver.id, "versionNo": ver.version_no}


def _collect_refs(defn: dict) -> dict:
    """发布快照：收集节点对 tool/model/mcp/knowledge 的引用，供引用扫描/删除防护。"""
    tool_refs, model_refs, mcp_refs, knowledge_refs = [], [], [], []
    for n in (defn or {}).get("graph", {}).get("nodes", []):
        cfg = n.get("config") or {}
        if n.get("type") == "tool" and cfg.get("toolVersionId"):
            tool_refs.append({"nodeId": n.get("id"), "ref": cfg["toolVersionId"]})
        if n.get("type") == "llm":
            mid = (cfg.get("modelRef") or {}).get("modelId")
            if mid:
                model_refs.append({"nodeId": n.get("id"), "ref": mid})
        if n.get("type") == "mcp-call" and cfg.get("mcpServerId"):
            mcp_refs.append({"nodeId": n.get("id"), "ref": cfg["mcpServerId"]})
        if n.get("type") == "knowledge-retrieval" and cfg.get("knowledgeSourceId"):
            knowledge_refs.append({"nodeId": n.get("id"), "ref": cfg["knowledgeSourceId"]})
    return {"tool_version_refs": tool_refs, "model_refs": model_refs,
            "mcp_refs": mcp_refs, "knowledge_refs": knowledge_refs}


@router.get("/{wf_id}/versions")
def list_versions(wf_id: str, db: Session = Depends(get_db)):
    vers = (db.query(WorkflowVersion).filter_by(workflow_id=wf_id)
            .order_by(WorkflowVersion.version_no.desc()).all())
    return [{"versionId": v.id, "versionNo": v.version_no, "note": v.note,
             "publishedAt": v.published_at.isoformat()} for v in vers]


@router.post("/{wf_id}/node-test")
def node_test(wf_id: str, payload: dict, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    """SDD C-6 节点单测：用给定输入执行单个节点执行器，不落 Run/事件（调研 07 §4）。"""
    import time as _time

    from ..runner import EXECUTORS, RunError, _agent_family_executor
    wf = db.get(Workflow, wf_id)
    if not wf:
        raise HTTPException(404, "workflow not found")
    defn = WorkflowDefinition.model_validate(wf.draft_definition)
    node = next((n.model_dump() for n in defn.graph.nodes if n.id == payload.get("nodeId")), None)
    if not node:
        raise HTTPException(404, "node not found")
    fn = EXECUTORS.get(node["type"]) or _agent_family_executor(node["type"])
    if not fn:
        raise HTTPException(422, f"节点类型 {node['type']} 暂不支持单测")
    from types import SimpleNamespace

    from ..models import Run
    run_input = payload.get("input") or {}
    # 单测入参覆盖节点自身的固定绑定（调研 07 §4：用户填入参执行单节点）
    for b in node.get("inputs", []):
        if b.get("name") in run_input:
            b["source"] = {"kind": "fixed", "value": run_input[b["name"]]}
    # 会发事件的执行器（emit 内部即 commit）需要真实 run 外键：建临时 Run，
    # 结束后删除并级联清理事件——对外仍满足"不落 Run/事件"
    # （E-1.3 修复：此前固定 id "node-test" 触发 run_event FK 违约）
    tmp_run = Run(id=new_id(), workflow_id=wf_id, agent_id=payload.get("agentId"),
                  trigger="test", status="running", input=run_input)
    db.add(tmp_run)
    db.commit()

    class _TCtx:
        def __init__(self):
            self.db = db
            self.run = tmp_run
            self.run_input = run_input
            self.outputs = {"n_start": run_input, "start": run_input}
            self.call_chain = []
            self.current_node_run_id = None
            self.frozen_agent_versions = {}

        def call(self, *a, **k):
            pass
    t0 = _time.time()
    try:
        try:
            out = fn(node, _TCtx())
            return {"ok": True, "output": out, "durationMs": int((_time.time() - t0) * 1000)}
        except RunError as e:
            return {"ok": False, "error": str(e), "durationMs": int((_time.time() - t0) * 1000)}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": str(e), "durationMs": int((_time.time() - t0) * 1000)}
    finally:
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass
        try:
            db.delete(tmp_run)  # run_event/node_run 走 FK ON DELETE CASCADE
            db.commit()
        except Exception:  # noqa: BLE001
            db.rollback()
