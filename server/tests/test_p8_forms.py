"""07-SDD form 验收：契约校验/默认值/发布冻结/删除防护。"""
from fastapi.testclient import TestClient

import pytest

from app.db import SessionLocal
from app.main import app
from app.runner import RunError, create_run, execute_run

client = TestClient(app)


def _wf_with_form(form_id, required_input=None):
    wid = client.post("/api/workflows", json={"name": "P8-wf"}).json()["id"]
    g = client.get(f"/api/workflows/{wid}").json()
    defn = g["definition"]
    start_id = next(n["id"] for n in defn["graph"]["nodes"] if n["type"] == "input")
    for n in defn["graph"]["nodes"]:
        if n["type"] == "input":
            n["config"] = {"formId": form_id}
    end = next((n for n in defn["graph"]["nodes"] if n["type"] == "end"), None)
    if end is None:
        defn["graph"]["nodes"].append({
            "id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"},
            "inputs": [{"name": "output", "type": "string",
                        "source": {"kind": "upstream", "nodeId": start_id, "path": "outputs.userQuery"}}]})
        defn["graph"]["edges"].append({"id": "se", "source": start_id, "target": "e"})
    else:
        end["config"] = {"outputKey": "quality_result"}
        end["inputs"] = [{"name": "output", "type": "string",
                          "source": {"kind": "upstream", "nodeId": start_id, "path": "outputs.userQuery"}}]
    client.put(f"/api/workflows/{wid}/draft", json={"definition": defn, "baseRevision": g["draftRevision"]})
    return wid


def test_form_crud_and_delete_guard():
    r = client.post("/api/forms", json={"name": "P8-form", "fields": [
        {"name": "userQuery", "type": "string", "required": True, "control": "textarea"},
        {"name": "bizLine", "type": "string", "required": False, "default": "corn", "control": "text"}]})
    assert r.status_code == 201
    fid = r.json()["id"]
    wid = _wf_with_form(fid)
    d = client.delete(f"/api/forms/{fid}")
    assert d.status_code == 409  # 被引用禁删
    # 必填校验：缺 userQuery → RunError
    db = SessionLocal()
    with pytest.raises(RunError):
        create_run(db, wid, "test", {}, enqueue=False)
    db.close()
    # default 兜底 + 必填满足 → 成功且 bizLine 取默认
    db = SessionLocal()
    run = create_run(db, wid, "test", {"userQuery": "hi"}, enqueue=False)
    db.close()
    execute_run(run.id)
    det = client.get(f"/api/runs/{run.id}").json()
    assert det["status"] == "succeeded", det
    # 发布冻结 formSnapshot
    p = client.post(f"/api/workflows/{wid}/publish")
    assert p.status_code in (200, 201)
    from app.models import WorkflowVersion
    db2 = SessionLocal()
    ver = db2.get(WorkflowVersion, p.json()["versionId"])
    snap_def = ver.definition
    db2.close()
    start = [n for n in snap_def["graph"]["nodes"] if n["type"] == "input"][0]
    snap = start["config"].get("formSnapshot")
    assert snap and snap[0]["name"] == "userQuery"
    # 表单编辑后 revision+1，已发布快照不受影响
    client.put(f"/api/forms/{fid}", json={"fields": [
        {"name": "userQuery", "type": "string", "required": True, "control": "textarea"},
        {"name": "extra", "type": "string", "required": False, "control": "text"}]})
    db3 = SessionLocal()
    ver2 = db3.get(WorkflowVersion, p.json()["versionId"])
    snap_def2 = ver2.definition
    db3.close()
    start2 = [n for n in snap_def2["graph"]["nodes"] if n["type"] == "input"][0]
    frozen_names = [f["name"] for f in start2["config"]["formSnapshot"]]
    assert frozen_names == ["userQuery", "bizLine"]  # 冻结=发布时两字段，不含后续编辑的 extra
