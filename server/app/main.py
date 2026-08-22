from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .runner import start_worker
from .routers import admin, agents, registry, runs, workflows


@asynccontextmanager
async def lifespan(_app: FastAPI):
    from .db import SessionLocal
    from .models import Model, ModelProvider
    db = SessionLocal()
    try:
        if db.query(Model).count() == 0:
            prov = ModelProvider(name="platform", base_url="mock://")
            db.add(prov)
            db.commit()
            for key, caps in [("deepseek-r1-distill-qwen-14b", ["text"]), ("qwen-max", ["text"]), ("qwen-plus", ["text", "thinking"])]:
                db.add(Model(provider_id=prov.id, model_key=key, display_name=key, capabilities=caps))
            db.commit()
    finally:
        db.close()
    stop = start_worker()
    yield
    stop.set()


app = FastAPI(title="Lightweight Workflow Kernel", version="0.1.0", lifespan=lifespan)


@app.middleware("http")
async def auth_middleware(request, call_next):
    """RBAC 真鉴权（可选）：WF_API_TOKEN 设置后 /api/* 需 Bearer token。"""
    import os
    from fastapi.responses import JSONResponse
    token = os.environ.get("WF_API_TOKEN", "")
    if token and request.url.path.startswith("/api/"):
        auth = request.headers.get("authorization", "")
        if auth != f"Bearer {token}":
            return JSONResponse({"detail": "未授权：缺少有效 Bearer token"}, status_code=401)
    return await call_next(request)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(workflows.router)
app.include_router(registry.router)
app.include_router(runs.router)
app.include_router(admin.router)
app.include_router(agents.router)


@app.get("/healthz")
def healthz():
    return {"ok": True}
