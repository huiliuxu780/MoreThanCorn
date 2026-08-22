"""Agent 层 API（三型）。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Agent
from ..routers.workflows import _default_definition
from ..models import Workflow

router = APIRouter(prefix="/api/agents", tags=["agents"])

TYPE_LABEL = {"autonomous": "自主规划", "dialogue": "对话编排", "expert-group": "编排Agent专家组"}


@router.post("", status_code=201)
def create_agent(payload: dict, db: Session = Depends(get_db)):
    t = payload.get("type", "dialogue")
    if t not in TYPE_LABEL:
        raise HTTPException(422, "unknown agent type")
    wf_id = None
    if t == "dialogue":
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
    return {"id": agent.id, "name": agent.name, "type": agent.type, "workflowId": wf_id}


def default_config(t: str) -> dict:
    if t == "autonomous":
        return {"rolePrompt": "# 角色：\n## 目标：\n## 技能：\n## 限制：", "modelRef": {"modelId": ""},
                "skills": [], "tools": [], "workflows": [], "knowledges": [], "memories": []}
    if t == "expert-group":
        return {"members": [], "routing": []}
    return {"dialogue": {"autoAsk": False, "chitchat": True}, "knowledges": [], "terms": [],
            "experiences": [], "memories": []}


@router.get("")
def list_agents(db: Session = Depends(get_db)):
    return [{"id": a.id, "name": a.name, "type": a.type, "typeLabel": TYPE_LABEL[a.type],
             "status": a.status, "workflowId": a.workflow_id, "avatar": a.avatar,
             "updatedAt": a.updated_at.isoformat()} for a in db.query(Agent).all()]


@router.get("/{aid}")
def get_agent(aid: str, db: Session = Depends(get_db)):
    a = db.get(Agent, aid)
    if not a:
        raise HTTPException(404, "agent not found")
    return {"id": a.id, "name": a.name, "type": a.type, "typeLabel": TYPE_LABEL[a.type],
            "status": a.status, "workflowId": a.workflow_id, "config": a.config,
            "description": a.description, "avatar": a.avatar}


@router.put("/{aid}")
def update_agent(aid: str, payload: dict, db: Session = Depends(get_db)):
    a = db.get(Agent, aid)
    if not a:
        raise HTTPException(404, "agent not found")
    if "config" in payload:
        a.config = payload["config"]
    if "name" in payload:
        a.name = payload["name"]
    if "workflowId" in payload:
        a.workflow_id = payload["workflowId"]
    if "avatar" in payload:
        a.avatar = payload["avatar"]
    if "description" in payload:
        a.description = payload["description"]
    db.commit()
    return {"id": a.id, "config": a.config}
