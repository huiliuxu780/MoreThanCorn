from quality_runtime_service import create_runtime_app

from .adapter import DeepSeekHarnessAdapter

app = create_runtime_app(DeepSeekHarnessAdapter())
