"""发布治理（09-SDD P2-08）：版本 Diff、审批、Canary、发布、回滚与变更审计。

对 workflow|rule|definition|task 四类资源的不可变版本，提供统一的发布申请
（ReleaseRequest）状态机：

    pending → approved | rejected → released（可 canary）→ promoted / rolled_back

治理约束：
- 审批门禁：未审批不得发布；
- 职责分离：申请人不得审批自己的申请；
- 发布/回滚都会切换资源"当前生效版本"指针，并写审计日志；
- Canary：先灰度（canary=True + scope），promote 后转全量；
- 回滚：恢复申请时的 from_version_no（首次发布无前置版本时不可回滚）。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..auth import auth_enforced_now, require_admin, require_operator
from ..db import get_db
from ..models import (
    AnalysisTask,
    AnalysisTaskVersion,
    DataDefinition,
    DataDefinitionVersion,
    ReleaseRequest,
    ResultRuleSet,
    ResultRuleVersion,
    Workflow,
    WorkflowVersion,
)
from .admin import audit

router = APIRouter(tags=["governance"])

RESOURCE_TYPES = ("workflow", "rule", "definition", "task")
STATES = ("pending", "approved", "rejected", "released", "rolled_back")


# ---------- 版本快照 / 当前指针适配 ----------

def _version_row(db: Session, resource_type: str, resource_id: str, version_no: int):
    if resource_type == "workflow":
        return db.query(WorkflowVersion).filter_by(workflow_id=resource_id, version_no=version_no).first()
    if resource_type == "rule":
        return db.query(ResultRuleVersion).filter_by(rule_set_id=resource_id, version_no=version_no).first()
    if resource_type == "definition":
        return db.query(DataDefinitionVersion).filter_by(definition_id=resource_id, version_no=version_no).first()
    if resource_type == "task":
        return db.query(AnalysisTaskVersion).filter_by(task_id=resource_id, version_no=version_no).first()
    return None


def _snapshot(resource_type: str, row) -> dict:
    """把版本行序列化为可比对的配置快照。"""
    if row is None:
        return {}
    if resource_type == "workflow":
        return {"definition": row.definition, "input_schema": row.input_schema,
                "structured_output_schemas": row.structured_output_schemas,
                "tool_version_refs": row.tool_version_refs, "model_refs": row.model_refs,
                "mcp_refs": row.mcp_refs, "knowledge_refs": row.knowledge_refs}
    if resource_type == "rule":
        return {"rules": row.rules, "evaluation_priority": row.evaluation_priority}
    if resource_type == "definition":
        return {"field_schema": row.field_schema, "eligibility": row.eligibility}
    if resource_type == "task":
        return {"workflow_id": row.workflow_id, "workflow_version_policy": row.workflow_version_policy,
                "pinned_workflow_version_id": row.pinned_workflow_version_id,
                "data_asset_id": row.data_asset_id,
                "data_definition_version_id": row.data_definition_version_id,
                "result_rule_version_id": row.result_rule_version_id, "rule_policy": row.rule_policy,
                "input_mapping": row.input_mapping, "scope": row.scope, "sampling": row.sampling,
                "data_window": row.data_window, "output_schema_version_id": row.output_schema_version_id}
    return {}


def _resource(db: Session, resource_type: str, resource_id: str):
    if resource_type == "workflow":
        return db.get(Workflow, resource_id)
    if resource_type == "rule":
        return db.get(ResultRuleSet, resource_id)
    if resource_type == "definition":
        return db.get(DataDefinition, resource_id)
    if resource_type == "task":
        return db.get(AnalysisTask, resource_id)
    return None


def _current_version_no(db: Session, resource_type: str, resource_id: str) -> int | None:
    """资源当前生效版本（无则 None）。"""
    res = _resource(db, resource_type, resource_id)
    if res is None:
        return None
    if resource_type == "workflow":
        if not res.current_version_id:
            return None
        v = db.get(WorkflowVersion, res.current_version_id)
        return v.version_no if v else None
    if resource_type == "rule":
        return res.version if res.status == "published" else None
    if resource_type == "definition":
        return res.revision if res.revision else None
    if resource_type == "task":
        if not res.current_version_id:
            return None
        v = db.get(AnalysisTaskVersion, res.current_version_id)
        return v.version_no if v else None
    return None


def _apply_pointer(db: Session, resource_type: str, resource_id: str, version_no: int) -> None:
    """把资源当前生效指针切到指定版本。"""
    res = _resource(db, resource_type, resource_id)
    if res is None:
        raise HTTPException(404, "资源不存在")
    row = _version_row(db, resource_type, resource_id, version_no)
    if row is None:
        raise HTTPException(404, f"版本 v{version_no} 不存在")
    if resource_type == "workflow":
        res.current_version_id = row.id
        res.status = "published"
    elif resource_type == "rule":
        res.version = version_no
        res.status = "published"
    elif resource_type == "definition":
        res.revision = version_no
        res.lifecycle = "Ready"
    elif resource_type == "task":
        res.current_version_id = row.id


# ---------- 深度 Diff ----------

def deep_diff(a, b, path: str = "") -> tuple[dict, dict, dict]:
    """递归比对两个 JSON 值，返回 (added, removed, changed)。"""
    added: dict = {}
    removed: dict = {}
    changed: dict = {}
    if isinstance(a, dict) and isinstance(b, dict):
        for k in set(a) | set(b):
            p = f"{path}.{k}" if path else str(k)
            if k not in a:
                added[p] = b[k]
            elif k not in b:
                removed[p] = a[k]
            else:
                _a, _r, _c = deep_diff(a[k], b[k], p)
                added.update(_a)
                removed.update(_r)
                changed.update(_c)
    elif isinstance(a, list) and isinstance(b, list):
        for i in range(max(len(a), len(b))):
            p = f"{path}[{i}]"
            if i >= len(a):
                added[p] = b[i]
            elif i >= len(b):
                removed[p] = a[i]
            else:
                _a, _r, _c = deep_diff(a[i], b[i], p)
                added.update(_a)
                removed.update(_r)
                changed.update(_c)
    else:
        if a != b:
            changed[path or "(root)"] = {"from": a, "to": b}
    return added, removed, changed


# ---------- 序列化 ----------

def _rr_json(r: ReleaseRequest) -> dict:
    return {"id": r.id, "resourceType": r.resource_type, "resourceId": r.resource_id,
            "fromVersionNo": r.from_version_no, "toVersionNo": r.to_version_no,
            "state": r.state, "canary": r.canary, "canaryScope": r.canary_scope,
            "canaryPromoted": r.canary_promoted, "requestedBy": r.requested_by,
            "approvedBy": r.approved_by,
            "approvedAt": r.approved_at.isoformat() if r.approved_at else None,
            "rejectedReason": r.rejected_reason,
            "releasedAt": r.released_at.isoformat() if r.released_at else None,
            "rolledBackAt": r.rolled_back_at.isoformat() if r.rolled_back_at else None,
            "note": r.note, "createdAt": r.created_at.isoformat()}


def _get_rr(db: Session, rid: str) -> ReleaseRequest:
    r = db.get(ReleaseRequest, rid)
    if not r:
        raise HTTPException(404, "发布申请不存在")
    return r


# ---------- 版本 Diff 端点 ----------

@router.get("/api/governance/diff")
def version_diff(resource_type: str = Query(..., alias="resourceType"),
                 resource_id: str = Query(..., alias="resourceId"),
                 from_version: int = Query(..., alias="from"),
                 to_version: int = Query(..., alias="to"),
                 db: Session = Depends(get_db)):
    """09 P2-08：两个不可变版本的结构化 Diff（added/removed/changed）。"""
    if resource_type not in RESOURCE_TYPES:
        raise HTTPException(422, f"resourceType 必须是 {'/'.join(RESOURCE_TYPES)}")
    fa = _snapshot(resource_type, _version_row(db, resource_type, resource_id, from_version))
    fb = _snapshot(resource_type, _version_row(db, resource_type, resource_id, to_version))
    if not fa and not fb:
        raise HTTPException(404, "版本不存在")
    added, removed, changed = deep_diff(fa, fb)
    return {"resourceType": resource_type, "resourceId": resource_id,
            "from": from_version, "to": to_version,
            "added": added, "removed": removed, "changed": changed,
            "hasChanges": bool(added or removed or changed)}


# ---------- 发布申请 ----------

@router.post("/api/governance/release-requests", status_code=201)
def create_release_request(payload: dict, db: Session = Depends(get_db),
                           user: dict = Depends(require_operator)):
    resource_type = str((payload or {}).get("resourceType") or "")
    resource_id = str((payload or {}).get("resourceId") or "")
    to_version = (payload or {}).get("toVersionNo")
    canary = bool((payload or {}).get("canary"))
    if resource_type not in RESOURCE_TYPES:
        raise HTTPException(422, f"resourceType 必须是 {'/'.join(RESOURCE_TYPES)}")
    if _resource(db, resource_type, resource_id) is None:
        raise HTTPException(404, "资源不存在")
    if not isinstance(to_version, int) or to_version < 1:
        raise HTTPException(422, "toVersionNo 必须是正整数")
    if _version_row(db, resource_type, resource_id, to_version) is None:
        raise HTTPException(404, f"目标版本 v{to_version} 不存在")
    actor = user.get("username", "system")
    rr = ReleaseRequest(resource_type=resource_type, resource_id=resource_id,
                        from_version_no=_current_version_no(db, resource_type, resource_id),
                        to_version_no=to_version, state="pending", canary=canary,
                        canary_scope=(payload or {}).get("canaryScope") or {},
                        requested_by=actor, note=str((payload or {}).get("note") or ""))
    db.add(rr)
    db.flush()
    audit(db, actor, "release.request", resource_type, resource_id,
          {"releaseRequestId": rr.id, "toVersionNo": to_version, "canary": canary})
    db.commit()
    return _rr_json(rr)


@router.get("/api/governance/release-requests")
def list_release_requests(resource_type: str | None = Query(None, alias="resourceType"),
                          resource_id: str | None = Query(None, alias="resourceId"),
                          state: str | None = None, limit: int = 100,
                          db: Session = Depends(get_db)):
    q = db.query(ReleaseRequest)
    if resource_type:
        q = q.filter(ReleaseRequest.resource_type == resource_type)
    if resource_id:
        q = q.filter(ReleaseRequest.resource_id == resource_id)
    if state:
        q = q.filter(ReleaseRequest.state == state)
    rows = q.order_by(ReleaseRequest.created_at.desc()).limit(min(limit, 500)).all()
    return {"items": [_rr_json(r) for r in rows]}


@router.get("/api/governance/release-requests/{rid}")
def get_release_request(rid: str, db: Session = Depends(get_db)):
    return _rr_json(_get_rr(db, rid))


@router.post("/api/governance/release-requests/{rid}/approve")
def approve_release_request(rid: str, db: Session = Depends(get_db),
                            user: dict = Depends(require_admin)):
    """09 P2-08：审批（仅 admin；职责分离——申请人不得审批自己）。"""
    r = _get_rr(db, rid)
    if r.state != "pending":
        raise HTTPException(409, f"仅 pending 可审批，当前 {r.state}")
    actor = user.get("username", "system")
    # 职责分离仅在真实鉴权（可区分身份）时强制；开发态单一 dev 身份不自我锁定。
    if auth_enforced_now() and actor == r.requested_by:
        raise HTTPException(403, "职责分离：申请人不能审批自己的发布申请")
    r.state = "approved"
    r.approved_by = actor
    from ..models import utcnow
    r.approved_at = utcnow()
    audit(db, actor, "release.approve", r.resource_type, r.resource_id,
          {"releaseRequestId": r.id, "toVersionNo": r.to_version_no})
    db.commit()
    return _rr_json(r)


@router.post("/api/governance/release-requests/{rid}/reject")
def reject_release_request(rid: str, payload: dict | None = None, db: Session = Depends(get_db),
                           user: dict = Depends(require_admin)):
    r = _get_rr(db, rid)
    if r.state != "pending":
        raise HTTPException(409, f"仅 pending 可驳回，当前 {r.state}")
    actor = user.get("username", "system")
    r.state = "rejected"
    r.rejected_reason = str((payload or {}).get("reason") or "")
    audit(db, actor, "release.reject", r.resource_type, r.resource_id,
          {"releaseRequestId": r.id, "reason": r.rejected_reason})
    db.commit()
    return _rr_json(r)


@router.post("/api/governance/release-requests/{rid}/release")
def release_release_request(rid: str, db: Session = Depends(get_db),
                            user: dict = Depends(require_operator)):
    """09 P2-08：发布（须先审批）。切换当前生效版本指针；canary 仅灰度标记。"""
    r = _get_rr(db, rid)
    if r.state != "approved":
        raise HTTPException(409, f"仅 approved 可发布，当前 {r.state}")
    actor = user.get("username", "system")
    _apply_pointer(db, r.resource_type, r.resource_id, r.to_version_no)
    r.state = "released"
    from ..models import utcnow
    r.released_at = utcnow()
    audit(db, actor, "release.release", r.resource_type, r.resource_id,
          {"releaseRequestId": r.id, "toVersionNo": r.to_version_no, "canary": r.canary,
           "canaryScope": r.canary_scope})
    db.commit()
    return _rr_json(r)


@router.post("/api/governance/release-requests/{rid}/promote")
def promote_release_request(rid: str, db: Session = Depends(get_db),
                            user: dict = Depends(require_operator)):
    """09 P2-08：Canary 转全量。"""
    r = _get_rr(db, rid)
    if r.state != "released":
        raise HTTPException(409, f"仅 released 可转全量，当前 {r.state}")
    if not r.canary:
        raise HTTPException(422, "非 Canary 发布无需转全量")
    if r.canary_promoted:
        raise HTTPException(409, "已转全量")
    actor = user.get("username", "system")
    r.canary_promoted = True
    audit(db, actor, "release.promote", r.resource_type, r.resource_id,
          {"releaseRequestId": r.id, "toVersionNo": r.to_version_no})
    db.commit()
    return _rr_json(r)


@router.post("/api/governance/release-requests/{rid}/rollback")
def rollback_release_request(rid: str, db: Session = Depends(get_db),
                             user: dict = Depends(require_operator)):
    """09 P2-08：回滚到申请时的生效版本 from_version_no。"""
    r = _get_rr(db, rid)
    if r.state != "released":
        raise HTTPException(409, f"仅 released 可回滚，当前 {r.state}")
    if r.from_version_no is None:
        raise HTTPException(422, "首次发布无前置版本，无法回滚")
    actor = user.get("username", "system")
    _apply_pointer(db, r.resource_type, r.resource_id, r.from_version_no)
    r.state = "rolled_back"
    from ..models import utcnow
    r.rolled_back_at = utcnow()
    audit(db, actor, "release.rollback", r.resource_type, r.resource_id,
          {"releaseRequestId": r.id, "toVersionNo": r.from_version_no})
    db.commit()
    return _rr_json(r)
