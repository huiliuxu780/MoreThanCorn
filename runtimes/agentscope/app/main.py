from quality_runtime_service import create_runtime_app

from .adapter import AgentScopeAdapter

app = create_runtime_app(AgentScopeAdapter())
