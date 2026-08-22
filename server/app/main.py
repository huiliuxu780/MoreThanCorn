from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .runner import start_worker
from .routers import admin, agents, registry, runs, workflows


@asynccontextmanager
async def lifespan(_app: FastAPI):
    stop = start_worker()
    yield
    stop.set()


app = FastAPI(title="Lightweight Workflow Kernel", version="0.1.0", lifespan=lifespan)

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
