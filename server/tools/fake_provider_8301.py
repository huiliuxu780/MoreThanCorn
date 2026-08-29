"""本地验收用 fake Runtime Provider（8301），实现 Contract v1，供人工验收 Agent 闭环。
仅 dev 使用：对任意 run 返回符合 quality_output Schema 的成功结果（不伪造真实业务判断，
仅用于打通 Data→Task→Agent→Run→Result 链路）。真实 Provider 以 AgentScope/DSH 为准。"""
import json
from datetime import datetime, timezone

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()
RUNS = {}


def now():
    return datetime.now(timezone.utc)


def quality_output(sid):
    return {"sample_id": sid, "call_id": sid, "conversation": "ok",
            "findings": [{"criterion": "promise_fulfillment", "status": "passed",
                          "confidence": 0.9, "reason": "已履约（验收 fake）",
                          "evidence": [{"source": "tool", "reference": "ticket:T-1:event:3",
                                        "summary": "工单已创建"}]}],
            "labels": {"service_type_code": "consult", "issue_codes": []},
            "summary": "验收 fake 输出"}


RUNTIME = {"provider": "agentscope", "runtime_version": "2.0.7", "adapter_version": "0.1.0"}
CAPS = {"tools": True, "skills": True, "structured_output": True, "trace": True,
        "session": True, "cancel": True, "streaming": True, "sandbox": False}


@app.post("/v1/runs", status_code=202)
def submit(payload: dict):
    rid = payload["run_id"]
    sid = str((payload.get("input") or {}).get("sample_id") or rid)
    RUNS[rid] = {"status": "succeeded", "input": payload.get("input") or {}, "sid": sid}
    return {"schema_version": "1.0", "run_id": rid, "status": "queued", "runtime": RUNTIME}


@app.get("/v1/runs/{rid}")
def get_run(rid: str):
    r = RUNS.get(rid)
    if not r:
        return {"schema_version": "1.0", "run_id": rid, "status": "failed",
                "error": {"code": "internal_error", "message": "unknown run"},
                "runtime": RUNTIME, "finished_at": now().isoformat()}
    return {"schema_version": "1.0", "run_id": rid, "status": "succeeded",
            "output": quality_output(r["sid"]),
            "usage": {"input_tokens": 5, "output_tokens": 3, "total_tokens": 8,
                      "model_calls": 1, "tool_calls": 1},
            "trace": [], "runtime": RUNTIME,
            "started_at": now().isoformat(), "finished_at": now().isoformat()}


@app.post("/v1/runs/{rid}/cancel")
def cancel(rid: str):
    return {"schema_version": "1.0", "run_id": rid, "status": "cancelled",
            "runtime": RUNTIME, "finished_at": now().isoformat()}


@app.get("/health")
def health():
    return {"status": "ok", "runtime": RUNTIME, "capabilities": CAPS,
            "checks": {"adapter": "ok", "runtime_package": "ok", "model_credential": "ok"}}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8301)
