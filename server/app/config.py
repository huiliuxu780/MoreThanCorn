import os

import sys as _sys

DATABASE_URL = os.environ.get(
    "WF_DATABASE_URL",
    "postgresql+psycopg://rivers@127.0.0.1:5432/wf_test" if "pytest" in _sys.modules
    else "postgresql+psycopg://rivers@127.0.0.1:5432/wf_dev",
)


# ---------- 09-SDD P0-01：Production Profile ----------
# 环境取值：production / development（默认）/ test。动态读取，支持测试内切换。

def wf_env() -> str:
    return os.environ.get("WF_ENV", "development")


def is_production() -> bool:
    return wf_env() == "production"


def auth_enforced() -> bool:
    """鉴权强制：生产恒开；其余环境由 WF_AUTH=on 显式开启。"""
    return is_production() or os.environ.get("WF_AUTH") == "on"


def code_node_enabled() -> bool:
    """09 P0-11：Code Node 默认禁用（含生产）；显式 WF_CODE_NODE=on 才放行。"""
    return os.environ.get("WF_CODE_NODE") == "on"
