import logging

from agents import set_tracing_disabled
from quality_runtime_service import create_runtime_app

from .adapter import OpenAIAgentsRuntimeAdapter, remote_tracing_enabled

# 阶段进度/失败留痕进入运行日志（本地审计用；平台 Trace 仍是唯一业务审计事实）。
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

# SDD 14 §25.1/§61.2：OpenAI SDK remote tracing 默认关闭（进程级）；
# 显式 OPENAI_AGENTS_REMOTE_TRACING=true 才允许启用（开发调试用途）。
set_tracing_disabled(not remote_tracing_enabled())

adapter = OpenAIAgentsRuntimeAdapter()

app = create_runtime_app(adapter)
