"""测试环境确定性 + 临时测试库（最终清零轮 §三.5/6）。

1. 节点并发度固定 1（生产默认并行，见 runner WF_PAR_RUN）；
   WF_TEST_FIXTURES=1 显式 fixture profile（SDD-12 AR-09 / P0-05），
   生产（WF_ENV=production）下恒失效。
2. 每次 pytest 会话创建独立临时库 ``wf_pytest_<rand>``：alembic 全量迁移 +
   基线种子（连接/Provider/模型行），会话结束自动 DROP——不再共享/污染
   长期 wf_test 库（任务书 §三：测试结束自动清理临时数据库）。
3. 安全门：只创建/删除 ``wf_pytest_`` 前缀库；``WF_TEST_REUSE_DB=<name>``
   可显式复用既有库（开发调试用，此时不自动删除）。

需要直连测试库的用例请使用 ``tests.conftest.pg_dsn()`` /
``TEST_DB_NAME``，不得再硬编码 wf_test。
"""
import os
import uuid

import pytest

os.environ.setdefault("WF_PAR_RUN", "1")
os.environ.setdefault("MTC_WATCHER", "off")
os.environ.setdefault("WF_TEST_FIXTURES", "1")

_PG_USER = os.environ.get("WF_TEST_PG_USER", "rivers")
_PG_HOST = os.environ.get("WF_TEST_PG_HOST", "127.0.0.1")
_PG_PORT = os.environ.get("WF_TEST_PG_PORT", "5432")
_PG_ADMIN_DSN = f"postgresql://{_PG_USER}@{_PG_HOST}:{_PG_PORT}/postgres"

_REUSE = os.environ.get("WF_TEST_REUSE_DB", "")
TEST_DB_NAME = _REUSE or f"wf_pytest_{uuid.uuid4().hex[:10]}"
_TEST_DATABASE_URL = (
    f"postgresql+psycopg://{_PG_USER}@{_PG_HOST}:{_PG_PORT}/{TEST_DB_NAME}"
)

# 必须在任何 app.* 导入之前生效（app.config 在 import 时读取 env）
os.environ["WF_DATABASE_URL"] = _TEST_DATABASE_URL
os.environ["WF_TEST_DB_NAME"] = TEST_DB_NAME


def pg_dsn(db_name: str | None = None) -> str:
    """psycopg 直连 DSN（供需要绕过 SQLAlchemy 的用例）。"""
    return f"postgresql://{_PG_USER}@{_PG_HOST}:{_PG_PORT}/{db_name or TEST_DB_NAME}"


def _assert_safe_name(name: str) -> None:
    """种子/清理安全门：精确 marker，绝不触碰非 wf_pytest_ 库。"""
    if not name.startswith("wf_pytest_"):
        raise RuntimeError(
            f"测试库安全门：拒绝操作非 wf_pytest_ 前缀数据库 {name!r}"
        )


def _create_test_database() -> None:
    import psycopg

    _assert_safe_name(TEST_DB_NAME)
    with psycopg.connect(_PG_ADMIN_DSN, autocommit=True) as conn:
        exists = conn.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (TEST_DB_NAME,)
        ).fetchone()
        if not exists:
            conn.execute(f'CREATE DATABASE "{TEST_DB_NAME}"')


def _upgrade_schema() -> None:
    from alembic import command
    from alembic.config import Config

    here = os.path.dirname(os.path.abspath(__file__))
    server_root = os.path.abspath(os.path.join(here, ".."))
    cfg = Config(os.path.join(server_root, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(server_root, "alembic"))
    cfg.set_main_option(
        "sqlalchemy.url",
        _TEST_DATABASE_URL.replace("postgresql+psycopg://", "postgresql://"),
    )
    command.upgrade(cfg, "head")


def _seed_baseline() -> None:
    """基线种子：发布校验/模型解析所需的真实 Connection/Provider/Model 行。

    与历史 wf_test 基线同语义：provider base_url='mock://'（非 http → 非生产
    测试走确定性 mock 回落），基线模型不带鉴权连接——需要真实凭据解析的用例
    自行注入带连接的模型；真 LLM 链路走 live-stack E2E（8120/8301 + wf_dev）。
    """
    import psycopg

    with psycopg.connect(pg_dsn()) as conn:
        conn.execute(
            """
            INSERT INTO connection (id, name, kind, protocol, endpoint, secret_ref,
                                    provider_hint, status, lifecycle, created_at)
            VALUES ('pytest-conn-base', 'pytest-base-conn', 'api_key', 'http-api',
                    '{}'::jsonb,
                    'sk-pytest-baseline-0000000000000000000', '', 'active',
                    'active', NOW())
            ON CONFLICT (id) DO NOTHING
            """
        )
        conn.execute(
            """
            INSERT INTO model_provider (id, name, base_url, auth_connection_id,
                                        status)
            VALUES ('pytest-prov-base', 'pytest-base-provider',
                    'mock://', 'pytest-conn-base', 'active')
            ON CONFLICT (id) DO NOTHING
            """
        )
        for model_id, key, params in [
            ("pytest-model-qmax", "qwen-max", '{"temperature": 0.2}'),
            ("pytest-model-qplus", "qwen-plus", "{}"),
            ("pytest-model-emb", "text-embedding-v3", '{"dimensions": 1024}'),
        ]:
            conn.execute(
                """
                INSERT INTO model (id, provider_id, model_key, display_name,
                                   capabilities, default_params, version, enabled)
                VALUES (%s, 'pytest-prov-base', %s, %s, '["text"]'::jsonb,
                        %s::jsonb, 1, TRUE)
                ON CONFLICT (id) DO NOTHING
                """,
                (model_id, key, key, params),
            )
        # Module Agent 发布冻结依赖的逻辑工具（registry 全量声明 → 平台 Tool）
        from app.agent_modules import registry as _module_registry

        tool_names = sorted({
            t["name"]
            for m in _module_registry.all_modules()
            for t in m.logical_tools
        })
        for tool_name in tool_names:
            conn.execute(
                """
                INSERT INTO tool (id, name, description, kind, status, created_at)
                VALUES (%s, %s, 'pytest baseline module tool', 'builtin', 'ready',
                        NOW())
                ON CONFLICT (id) DO NOTHING
                """,
                (f"pytest-tool-{tool_name}", tool_name),
            )
            conn.execute(
                """
                INSERT INTO tool_version (id, tool_id, version_no, input_schema,
                                          output_schema, spec, status)
                VALUES (%s, %s, 1, '{"type":"object","properties":{}}'::jsonb,
                        '{"type":"object","properties":{}}'::jsonb,
                        '{"kind":"echo"}'::jsonb, 'ready')
                ON CONFLICT (id) DO NOTHING
                """,
                (f"pytest-tv-{tool_name}", f"pytest-tool-{tool_name}"),
            )
        conn.commit()


def _drop_test_database() -> None:
    import psycopg

    db = os.environ.get("WF_TEST_DB_NAME", "")
    if not db.startswith("wf_pytest_"):
        return
    try:
        with psycopg.connect(_PG_ADMIN_DSN, autocommit=True) as conn:
            conn.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = %s AND pid <> pg_backend_pid()",
                (db,),
            )
            conn.execute(f'DROP DATABASE IF EXISTS "{db}"')
    except Exception as exc:  # noqa: BLE001 —— 清理失败不掩盖测试结果
        print(f"[conftest] WARNING: failed to drop test database {db}: {exc!r}")




def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "live_runtime: 允许打真实 8301/8120 运行时（豁免默认 hermetic 拦截）",
    )


@pytest.fixture(autouse=True)
def _hermetic_runtime(request, monkeypatch):
    """P0-09：默认拦截 AgentScope 运行时 HTTP 边界（单元/集成测试 hermetic）。

    此前批测/发布物化直打 live 8301，每轮在 wf_agentscope 制造垃圾
    AgentRecord/Session/凭据（现场 338 agents / 1600+ sessions 的来源之一）。
    真实跨栈链路只由标记 ``live_runtime`` 的套件覆盖
    （test_p0_e2e_live_stack / test_cutover_p0）。
    用例自带 monkeypatch 会覆盖本默认值（后设置者优先）。
    """
    if request.node.get_closest_marker("live_runtime"):
        return
    import uuid as _uuid

    from app import agentscope_client as _rt

    monkeypatch.setattr(
        _rt, "create_agent",
        lambda user_id, name, system_prompt, **cfg:
            f"rt-agent-{_uuid.uuid4().hex[:12]}")

    def _get_agent(user_id, agent_id):
        raise _rt.RuntimeError_(404, f"hermetic: agent {agent_id} not found")

    monkeypatch.setattr(_rt, "get_agent", _get_agent)
    monkeypatch.setattr(
        _rt, "update_agent",
        lambda user_id, agent_id, **patch: {"id": agent_id})
    monkeypatch.setattr(
        _rt, "ensure_credential",
        lambda *a, **k: f"rt-cred-{_uuid.uuid4().hex[:8]}")
    monkeypatch.setattr(
        _rt, "create_session",
        lambda user_id, agent_id, cfg, kb_ids=None, internal_token=None:
            f"rt-sess-{_uuid.uuid4().hex[:12]}")
    monkeypatch.setattr(_rt, "upload_workspace_skill", lambda *a, **k: None)
    monkeypatch.setattr(_rt, "add_workspace_mcp", lambda *a, **k: None)
    monkeypatch.setattr(_rt, "workspace_skills", lambda *a, **k: [])
    monkeypatch.setattr(_rt, "workspace_mcps", lambda *a, **k: [])
    monkeypatch.setattr(_rt, "chat_trigger", lambda *a, **k: {"status": "started"})
    monkeypatch.setattr(
        _rt, "structured_run",
        lambda *a, **k: {"structured_output": {"content": "hermetic"},
                         "text": "hermetic"})
    monkeypatch.setattr(
        _rt, "create_schedule",
        lambda user_id, **body: f"rt-sched-{_uuid.uuid4().hex[:8]}")
    monkeypatch.setattr(_rt, "patch_schedule", lambda *a, **k: {"ok": True})
    monkeypatch.setattr(_rt, "delete_schedule", lambda *a, **k: None)
    monkeypatch.setattr(_rt, "schedule_sessions", lambda *a, **k: [])
    monkeypatch.setattr(_rt, "list_knowledge_bases", lambda *a, **k: [])
    monkeypatch.setattr(
        _rt, "create_knowledge_base",
        lambda *a, **k: f"rt-kb-{_uuid.uuid4().hex[:12]}")
    monkeypatch.setattr(
        _rt, "interrupt_session", lambda *a, **k: {"status": "interrupted"})
    monkeypatch.setattr(_rt, "session_messages", lambda *a, **k: {"messages": []})
    monkeypatch.setattr(_rt, "session_status", lambda *a, **k: {"status": "idle"})
    monkeypatch.setattr(_rt, "sessions_status", lambda *a, **k: [])
    monkeypatch.setattr(_rt, "flow_run", lambda body, timeout=600.0: {
        "status": "succeeded", "output": {}, "nodes": [], "events": []})


if not _REUSE:
    _create_test_database()
    _upgrade_schema()
    _seed_baseline()


def pytest_sessionfinish(session, exitstatus):  # noqa: ARG001
    if not _REUSE:
        _drop_test_database()
