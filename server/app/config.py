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


def fixtures_enabled() -> bool:
    """SDD-12 AR-09 / P0-05：测试 fixture 显式门控。

    只有显式 `WF_TEST_FIXTURES=1` 且非生产时才允许 mock/echo/示例发现路径；
    普通 dev 与 production 一律失败关闭（不得自动回退假成功）。"""
    if is_production():
        return False
    return os.environ.get("WF_TEST_FIXTURES") == "1"


def code_node_enabled() -> bool:
    """09 P0-11：Code Node 生产**永久禁用**（当前为宿主机子进程，非真沙箱；
    真沙箱落地前生产不可经任何环境变量开启）。非生产默认禁用，可经 WF_CODE_NODE=on
    显式开启（开发/评测用）。"""
    if is_production():
        return False
    return os.environ.get("WF_CODE_NODE") == "on"
