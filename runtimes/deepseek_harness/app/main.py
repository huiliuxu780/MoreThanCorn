from quality_runtime_service import create_runtime_app

from .adapter import DeepSeekHarnessAdapter
from .dashscope_compat import install_dashscope_compat_route

app = create_runtime_app(DeepSeekHarnessAdapter())
install_dashscope_compat_route(app)
