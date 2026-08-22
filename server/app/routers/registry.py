from fastapi import APIRouter

from ..registry import node_definition_list

router = APIRouter(prefix="/api/registry", tags=["registry"])


@router.get("/node-definitions")
def node_definitions():
    return node_definition_list()
