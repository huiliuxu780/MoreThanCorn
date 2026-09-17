"""09-18 端到端补全：模块 logical tools 的 dev fixture 后端。

金样本/开发环境把 quality-analysis 的四个只读工具（knowledge_search/ticket_query/
sms_query/appointment_query）接到 datasets/smoke/tool_fixtures_v0.1.json，
使「模型真调工具取事实」的端到端链路成立（此前工具全 disabled，模型只能裸判）。
生产环境（is_production）或 MTC_FIXTURE_TOOLS=off 时全部 404——生产工具必须接真实连接。
"""
from __future__ import annotations

import json
import pathlib
import threading

from fastapi import APIRouter, HTTPException

from ..config import is_production

router = APIRouter(prefix="/api/fixture-tools", tags=["fixture-tools"])

_LOCK = threading.Lock()
_CACHE: dict | None = None


def _fixtures() -> dict:
    global _CACHE
    with _LOCK:
        if _CACHE is None:
            from ..agent_modules.quality_analysis.evaluators import DATASETS_DIR
            path = DATASETS_DIR / "smoke" / "tool_fixtures_v0.1.json"
            _CACHE = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        return _CACHE


@router.post("/{tool_name}")
def fixture_tool(tool_name: str, payload: dict | None = None) -> dict:
    if is_production() or __import__("os").environ.get("MTC_FIXTURE_TOOLS", "on") != "on":
        raise HTTPException(404, "fixture tools 仅限开发环境（MTC_FIXTURE_TOOLS=on 且非生产）")
    data = _fixtures()
    if tool_name not in data:
        raise HTTPException(404, f"无 fixture：{tool_name}")
    body = payload or {}
    if tool_name == "knowledge_search":
        q = str(body.get("query") or "")
        arts = [a for a in data["knowledge_search"].get("articles", [])
                if any(k and k in q for k in a.get("keywords", []))]
        return {"articles": arts}
    recs = data[tool_name]
    for v in body.values():
        if isinstance(v, str) and v in recs:
            return recs[v]
    return {"exists": False, "sent": False,
            "tickets": [], "messages": [], "appointments": []}
