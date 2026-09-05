"""MTC-002A：/api/automations canonical API（自主任务兼容层）。

约束（验收声明）：
- 本模块不修改数据库表名与外键，不新增 Task 表，不做迁移；
- 不删除 /api/tasks；新旧接口操作同一条 analysis_task 数据；
- 写路径直接复用 routers/business.py 的端点函数（同一代码路径），
  因此不会重复写入、不会返回不同版本的数据；
- 读路径以同一 ORM 行构建 AutomationDefinitionDTO。
"""
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..auth import apply_data_scope, assert_task_readable, require_operator, require_role
from ..automation_dtos import automation_definition_dto
from ..db import get_db
from ..models import AnalysisTask
from . import business as biz

router = APIRouter(tags=["automations"])


@router.get("/api/automations")
def list_automations(page: int = 1, pageSize: int = 50,
                     db: Session = Depends(get_db),
                     user: dict = Depends(require_role())):
    """自主任务列表。与 /api/tasks 同表同数据范围（apply_data_scope），同排序。"""
    q = apply_data_scope(db, db.query(AnalysisTask), user, AnalysisTask.created_by) \
        .order_by(AnalysisTask.created_at.desc())
    total = q.count()
    rows = q.offset((page - 1) * pageSize).limit(pageSize).all()
    return {"items": [automation_definition_dto(db, t) for t in rows],
            "total": total, "page": page, "pageSize": pageSize}


@router.post("/api/automations", status_code=201)
def create_automation(payload: dict, db: Session = Depends(get_db),
                      user: dict = Depends(require_operator)):
    """创建自主任务。复用 /api/tasks 创建逻辑（创建即生成 TaskVersion v1）。"""
    created = biz.create_task(payload, db=db, user=user)
    t = db.get(AnalysisTask, created["id"])
    return automation_definition_dto(db, t)


@router.get("/api/automations/{aid}")
def get_automation(aid: str, db: Session = Depends(get_db),
                   user: dict = Depends(require_role())):
    t = db.get(AnalysisTask, aid)
    if not t:
        raise HTTPException(404, "自主任务不存在")
    assert_task_readable(db, user, t)
    return automation_definition_dto(db, t)


@router.put("/api/automations/{aid}")
def update_automation(aid: str, payload: dict, db: Session = Depends(get_db),
                      user: dict = Depends(require_operator)):
    """编辑自主任务。复用 /api/tasks 编辑逻辑（生成新的不可变 TaskVersion）。"""
    biz.update_task(aid, payload, db=db, user=user)
    t = db.get(AnalysisTask, aid)
    if not t:
        raise HTTPException(404, "自主任务不存在")
    return automation_definition_dto(db, t)


@router.post("/api/automations/{aid}/runs", status_code=202)
def start_automation_run(aid: str, payload: dict | None = None,
                         idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
                         db: Session = Depends(get_db),
                         user: dict = Depends(require_operator)):
    """启动一次批次（TaskRun）。与 /api/tasks/{id}/runs 同入口，Idempotency-Key 语义不变。"""
    return biz.start_task_run_api(tid=aid, payload=payload, idempotency_key=idempotency_key,
                                  db=db, user=user)


@router.get("/api/automations/{aid}/runs")
def list_automation_runs(aid: str, page: int = 1, pageSize: int = 50,
                         db: Session = Depends(get_db),
                         user: dict = Depends(require_role())):
    """MTC-002A-R：门禁在共享读取函数内（_load_task_scoped），与 legacy 同一路径。"""
    return biz.list_task_runs(tid=aid, page=page, pageSize=pageSize, db=db, user=user)


@router.get("/api/automations/{aid}/schedules")
def list_automation_schedules(aid: str, db: Session = Depends(get_db),
                              user: dict = Depends(require_role())):
    return biz.list_task_schedules(tid=aid, db=db, user=user)
