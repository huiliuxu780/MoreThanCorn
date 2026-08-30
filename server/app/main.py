from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .config import auth_enforced, is_production
from .legacy_agent_archive import LegacyAgentArchivedError
from .runner import start_worker
from .routers import (admin, agents, alerts, analytics, auth_routes, business,
                      forms, governance, registry, resources, runs, runtime_providers, workflows)

# 鉴权白名单：登录与探活不需要身份
_PUBLIC_PATHS = ("/api/auth/login", "/healthz", "/readyz", "/openapi.json", "/docs")


def check_production_ready() -> None:
    """09 §12：生产启动门。缺关键配置拒绝启动（fail closed）。"""
    import os
    if not is_production():
        return
    key = os.environ.get("WF_SECRET_KEY")
    if not key:
        raise RuntimeError("WF_SECRET_KEY 未配置：生产环境禁止明文 Secret 模式，拒绝启动")
    # 09 P0：非空 ≠ 安全——必须验证是合法 Fernet 密钥（修复审计反例）
    from cryptography.fernet import Fernet
    try:
        Fernet(key.encode())
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"WF_SECRET_KEY 不是合法 Fernet 密钥，拒绝启动：{exc}")


def bootstrap_models(db) -> str:
    """模型种子：仅非生产环境在无模型时创建确定性假提供方（mock:// 标记）。
    生产：不种子；运行期模型调用失败关闭（09 §12 / M-01）。"""
    from .models import Model, ModelProvider
    if db.query(Model).count() > 0:
        return "existing"
    if is_production():
        return "skipped-production"
    prov = ModelProvider(name="platform", base_url="mock://")
    db.add(prov)
    db.commit()
    for key, caps in [("deepseek-r1-distill-qwen-14b", ["text"]), ("qwen-max", ["text"]),
                      ("qwen-plus", ["text", "thinking"])]:
        db.add(Model(provider_id=prov.id, model_key=key, display_name=key, capabilities=caps))
    db.commit()
    return "seeded-dev"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    check_production_ready()
    # SDD 10 R2：Module Registry 启动 fail fast（重复版本/缺 Schema/缺实现即拒绝启动）
    from .agent_modules import registry as module_registry
    module_registry.warmup()
    from .db import SessionLocal
    db = SessionLocal()
    try:
        bootstrap_models(db)
        forms.seed_default_forms(db)
    finally:
        db.close()
    # 09 P1（审计：进程拆分）：生产环境 API 进程不内嵌 Worker/Scheduler，
    # 由独立进程（run_worker.py / run_scheduler.py）部署；
    # 开发默认内嵌（WF_EMBEDDED_WORKER=off 可关）。
    import os
    embedded = os.environ.get("WF_EMBEDDED_WORKER", "off" if is_production() else "on") == "on"
    stop = start_worker() if embedded else None
    yield
    if stop:
        stop.set()


app = FastAPI(title="Lightweight Workflow Kernel", version="0.1.0", lifespan=lifespan)


@app.exception_handler(LegacyAgentArchivedError)
async def _legacy_agent_archived_handler(_request, exc: LegacyAgentArchivedError):
    """SDD 10 R-A2：旧 Agent 写/运行操作统一 410 Gone。"""
    from fastapi.responses import JSONResponse
    return JSONResponse({"code": exc.code, "message": exc.message}, status_code=410)


@app.middleware("http")
async def auth_middleware(request, call_next):
    """09 P0-10：服务端鉴权。auth_enforced（生产恒开 / WF_AUTH=on）时
    /api/* 必须携带有效登录令牌；否则 401。开发默认匿名透传。"""
    from fastapi.responses import JSONResponse
    path = request.url.path
    if auth_enforced() and path.startswith("/api/") and path not in _PUBLIC_PATHS:
        from .auth import current_user
        if current_user(request) is None:
            return JSONResponse({"detail": "未授权：缺少有效登录凭证"}, status_code=401)
    return await call_next(request)


@app.middleware("http")
async def slo_latency_middleware(request, call_next):
    """P2-09：API 时延采样（内存环，供 /api/ops/slo p95/p99 对比冻结目标）。"""
    from .slo import latency_timer
    stop = latency_timer()
    try:
        return await call_next(request)
    finally:
        stop()


def _cors_origins() -> list[str]:
    """09 §12：CORS 白名单。WF_CORS_ORIGINS 任何环境都可显式覆盖；
    生产必须显式配置（空列表=不允许跨域），开发默认放行本机 5173。"""
    import os
    env = os.environ.get("WF_CORS_ORIGINS", "")
    if env:
        return [o.strip() for o in env.split(",") if o.strip()]
    if is_production():
        return []
    return ["http://localhost:5173", "http://127.0.0.1:5173"]


# 开发环境放行所有本机端口（5173/5175/5176/…），避免 dev/preview 多端口逐个加白名单；
# 生产不使用该正则，仍以显式 WF_CORS_ORIGINS 为准。
_DEV_CORS_REGEX = r"https?://(localhost|127\.0\.0\.1)(:\d+)?"

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_origin_regex=_DEV_CORS_REGEX if not is_production() else None,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_routes.router)
app.include_router(analytics.router)
app.include_router(alerts.router)
app.include_router(workflows.router)
app.include_router(registry.router)
app.include_router(runs.router)
app.include_router(business.router)
app.include_router(governance.router)
app.include_router(resources.router)
app.include_router(admin.router)
app.include_router(agents.router)
app.include_router(runtime_providers.router)
app.include_router(forms.router)


@app.get("/healthz")
def healthz():
    """进程存活探针（不查依赖）。"""
    return {"ok": True}


@app.get("/readyz")
def readyz():
    """09 §12：依赖就绪探针——数据库可达 + 迁移链 + 队列表可用。"""
    from .db import SessionLocal
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        head = db.execute(text("SELECT version_num FROM alembic_version")).scalar()
        db.execute(text("SELECT count(*) FROM job_queue"))
        return {"database": True, "migrations": head or "", "queue": True}
    except Exception as exc:  # noqa: BLE001
        from fastapi.responses import JSONResponse
        return JSONResponse({"database": False, "error": str(exc)[:200]}, status_code=503)
    finally:
        db.close()
