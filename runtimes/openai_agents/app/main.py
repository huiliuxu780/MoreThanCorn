from agents import set_tracing_disabled
from quality_runtime_service import create_runtime_app

from .adapter import OpenAIAgentsRuntimeAdapter, remote_tracing_enabled

# SDD 14 §25.1/§61.2：OpenAI SDK remote tracing 默认关闭（进程级）；
# 显式 OPENAI_AGENTS_REMOTE_TRACING=true 才允许启用（开发调试用途）。
set_tracing_disabled(not remote_tracing_enabled())

adapter = OpenAIAgentsRuntimeAdapter()

app = create_runtime_app(adapter)
