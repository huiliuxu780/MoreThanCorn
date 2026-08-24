from fastapi import APIRouter

from ..registry import node_definition_list
from ..runner import SYSTEM_VARIABLES

router = APIRouter(prefix="/api/registry", tags=["registry"])


@router.get("/node-definitions")
def node_definitions():
    return node_definition_list()


@router.get("/system-variables")
def system_variables():
    """SDD C-5：平台系统变量目录（调研 11 §6 实测 14 项）。"""
    return {"items": SYSTEM_VARIABLES}
