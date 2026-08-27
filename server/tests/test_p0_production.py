"""09-SDD P0-B3：Production Profile 与 mock 隔离（P0-01）。

要求（09 §12）：
- WF_ENV=production 下：禁止注册 mock:// Provider；模型/路由/资源测试缺真实配置即失败关闭；
  缺 WF_SECRET_KEY 拒绝启动；Code Node 默认禁用；/healthz 与 /readyz 分离。
- 测试环境可用确定性 fake，但生产配置静态+运行检查均阻止。

先红后绿。所有用例通过 monkeypatch 切 WF_ENV，不污染其他测试。
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


@pytest.fixture
def prod(monkeypatch):
    monkeypatch.setenv("WF_ENV", "production")
    monkeypatch.setenv("WF_SECRET_KEY", "p0-prod-key")
    monkeypatch.delenv("WF_LLM_BASE_URL", raising=False)
    monkeypatch.delenv("WF_LLM_API_KEY", raising=False)
    yield


def test_production_refuses_model_mock(prod):
    from app.runner import RunError, _call_model
    from app.db import SessionLocal
    db = SessionLocal()
    try:
        with pytest.raises(RunError, match="MODEL_UNAVAILABLE|生产"):
            _call_model(db, "no-such-model", "hello")
    finally:
        db.close()


def test_dev_still_allows_deterministic_fake(monkeypatch):
    """非生产保留确定性 fake（带 [mock: 标记），生产路径不引用。"""
    monkeypatch.setenv("WF_ENV", "development")
    monkeypatch.delenv("WF_LLM_BASE_URL", raising=False)
    from app.runner import _call_model
    from app.db import SessionLocal
    db = SessionLocal()
    try:
        answer, tokens = _call_model(db, "m-x", "hi")
        assert answer.startswith("[mock:")
        assert tokens["promptTokens"] >= 0
    finally:
        db.close()


def test_production_lifespan_skips_mock_provider_seed(prod):
    from app.main import bootstrap_models
    from app.db import SessionLocal
    from app.models import ModelProvider
    db = SessionLocal()
    try:
        n_before = db.query(ModelProvider).count()
        bootstrap_models(db)
        assert db.query(ModelProvider).count() == n_before  # 生产不自动建 mock://
        assert not any(p.base_url == "mock://"
                       for p in db.query(ModelProvider).all()
                       if p.name == "platform")
    finally:
        db.close()


def test_production_requires_secret_key(monkeypatch):
    from app.main import check_production_ready
    monkeypatch.setenv("WF_ENV", "production")
    monkeypatch.delenv("WF_SECRET_KEY", raising=False)
    with pytest.raises(RuntimeError, match="WF_SECRET_KEY"):
        check_production_ready()
    monkeypatch.setenv("WF_SECRET_KEY", "x")
    check_production_ready()  # 有密钥则通过


def test_production_resource_tests_fail_closed(prod):
    from app.resource_tests import search_knowledge, mcp_call_tool
    from app.runner import RunError
    from app.db import SessionLocal
    from app.models import KnowledgeSource, McpServer
    db = SessionLocal()
    try:
        ks = KnowledgeSource(name="p0-ks", kind="vector", source_config={})
        db.add(ks)
        db.flush()
        with pytest.raises(RunError):
            search_knowledge(db, ks.id, "q")
        ms = McpServer(name="p0-mcp", transport="http")  # 无 connection/endpoint
        db.add(ms)
        db.flush()
        with pytest.raises(RunError):
            mcp_call_tool(db, ms.id, "t", {})
    finally:
        db.rollback()
        db.close()


def test_production_routing_fails_closed(prod):
    from app.runner import RunError, _route_workflow
    from app.db import SessionLocal
    from app.models import Workflow
    db = SessionLocal()
    try:
        wf = Workflow(name="route-probe", description="x")
        db.add(wf)
        db.flush()
        with pytest.raises(RunError):
            _route_workflow(db, [wf], "任意问题")
    finally:
        db.rollback()
        db.close()


def test_readyz_and_healthz():
    assert client.get("/healthz").json()["ok"] is True
    r = client.get("/readyz")
    assert r.status_code in (200, 503)
    body = r.json()
    assert body["database"] is True  # 测试库可达
    assert "migrations" in body
