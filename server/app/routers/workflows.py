from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

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
def create_workflow(req: CreateWorkflowRequest, db: Session = Depends(get_db)):
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
    q = db.query(Workflow).order_by(Workflow.updated_at.desc())
    if search:
        q = q.filter(Workflow.name.ilike(f"%{search}%"))
    total = q.count()
    items = q.offset((page - 1) * pageSize).limit(pageSize).all()
    return {
        "items": [WorkflowSummary(
            id=w.id, name=w.name, status=w.status, currentVersion=None,
            updatedAt=w.updated_at.isoformat()).model_dump() for w in items],
        "total": total, "page": page, "pageSize": pageSize,
    }


@router.get("/{wf_id}")
def get_workflow(wf_id: str, db: Session = Depends(get_db)):
    wf = db.get(Workflow, wf_id)
    if not wf:
        raise HTTPException(404, "workflow not found")
    return {"id": wf.id, "name": wf.name, "status": wf.status,
            "draftRevision": wf.draft_revision, "definition": wf.draft_definition,
            "updatedAt": wf.updated_at.isoformat()}


@router.put("/{wf_id}/draft")
def save_draft(wf_id: str, req: SaveDraftRequest, db: Session = Depends(get_db)):
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
def publish_workflow(wf_id: str, note: str = "", db: Session = Depends(get_db)):
    wf = db.get(Workflow, wf_id)
    if not wf:
        raise HTTPException(404, "workflow not found")
    defn = WorkflowDefinition.model_validate(wf.draft_definition)
    report = validate(defn)
    if not report.ok:
        raise HTTPException(409, detail=report.model_dump())
    version_no = (db.query(WorkflowVersion)
                  .filter_by(workflow_id=wf_id).count()) + 1
    ver = WorkflowVersion(workflow_id=wf_id, version_no=version_no,
                          definition=wf.draft_definition, note=note)
    db.add(ver)
    wf.status = "published"
    db.commit()
    db.refresh(ver)
    wf.current_version_id = ver.id
    db.commit()
    return {"versionId": ver.id, "versionNo": ver.version_no}


@router.get("/{wf_id}/versions")
def list_versions(wf_id: str, db: Session = Depends(get_db)):
    vers = (db.query(WorkflowVersion).filter_by(workflow_id=wf_id)
            .order_by(WorkflowVersion.version_no.desc()).all())
    return [{"versionId": v.id, "versionNo": v.version_no, "note": v.note,
             "publishedAt": v.published_at.isoformat()} for v in vers]
