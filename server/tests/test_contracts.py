"""契约测试：Validator 七规则 + API 行为 + quickservice 黄金 fixture 兼容。"""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas import WorkflowDefinition
from app.validator import validate

FIXTURE = Path(__file__).resolve().parents[2] / (
    "docs/research/lightweight-workflow-system/evidence/network/flow-detail-decoded-dsl.json")

client = TestClient(app)


def make_defn(**over) -> WorkflowDefinition:
    base = {
        "schemaVersion": "1.0",
        "workflow": {"id": "wf1", "name": "t", "status": "draft"},
        "graph": {
            "nodes": [
                {"id": "s", "type": "input", "name": "开始"},
                {"id": "e", "type": "end", "name": "结束",
                 "config": {"outputKey": "quality_result"},
                 "inputs": [{"name": "output", "type": "string",
                             "source": {"kind": "fixed", "value": "x"}}]},
            ],
            "edges": [{"id": "e1", "source": "s", "target": "e"}],
        },
        "io": {"structuredOutputs": [{"key": "quality_result", "schema": {}}]},
    }
    base.update(over)
    return WorkflowDefinition.model_validate(base)


def test_valid_minimal():
    r = validate(make_defn())
    assert r.ok, r.issues


def test_orphan_node_flagged():
    d = make_defn()
    d.graph.nodes.append(WorkflowDefinition.model_validate({
        "schemaVersion": "1.0", "workflow": {"id": "x", "name": "x"},
        "graph": {"nodes": [{"id": "lonely", "type": "llm", "name": "大模型",
                             "config": {"modelRef": {"modelId": "m"}, "prompt": "p"}},
                            {"id": "a", "type": "input", "name": "s"},
                            {"id": "b", "type": "end", "name": "e"}],
                  "edges": [{"id": "e", "source": "a", "target": "b"}]}}).graph.nodes[0])
    r = validate(d)
    assert any(i.nodeId == "lonely" and i.kind == "unconnected" for i in r.issues)


def test_cycle_detected():
    d = make_defn()
    d.graph.edges.append(type(d.graph.edges[0])(id="e2", source="e", target="s"))
    r = validate(d)
    assert any(i.kind == "graph" and "循环" in i.message for i in r.issues)


def test_llm_missing_prompt_unconfigured():
    d = make_defn()
    d.graph.nodes.insert(1, type(d.graph.nodes[0]).model_validate({
        "id": "l", "type": "llm", "name": "大模型",
        "config": {"modelRef": {"modelId": "m"}}}))
    r = validate(d)
    assert any(i.nodeId == "l" and i.kind == "unconfigured" for i in r.issues)


def test_upstream_unreachable_flagged():
    d = make_defn()
    from app.schemas import InputBinding
    d.graph.nodes[1].inputs[0] = InputBinding.model_validate(
        {"name": "output", "type": "string",
         "source": {"kind": "upstream", "nodeId": "ghost", "path": "outputs.x"}})
    r = validate(d)
    assert any(i.kind == "unconfigured" for i in r.issues)


def test_condition_branch_edge_mismatch():
    d = make_defn()
    d.graph.nodes.insert(1, type(d.graph.nodes[0]).model_validate({
        "id": "c", "type": "condition", "name": "条件",
        "branches": ["yes", "no"],
        "config": {"branches": [{"handle": "yes"}]}}))
    d.graph.edges = [
        type(d.graph.edges[0])(id="e1", source="s", target="c"),
        type(d.graph.edges[0])(id="e2", source="c", sourceHandle="yes", target="e"),
    ]
    r = validate(d)
    assert any(i.nodeId == "c" for i in r.issues)


# ---------- API ----------

def test_create_save_validate_flow():
    cr = client.post("/api/workflows", json={"name": "TEST-contract"})
    assert cr.status_code == 201
    wid = cr.json()["id"]
    g = client.get(f"/api/workflows/{wid}")
    assert g.status_code == 200
    rev = g.json()["draftRevision"]
    defn = g.json()["definition"]
    put = client.put(f"/api/workflows/{wid}/draft",
                     json={"definition": defn, "baseRevision": rev})
    assert put.status_code == 200
    # 冲突
    put2 = client.put(f"/api/workflows/{wid}/draft",
                      json={"definition": defn, "baseRevision": rev})
    assert put2.status_code == 409
    v = client.get(f"/api/workflows/{wid}/validation")
    assert v.status_code == 200


def test_registry_endpoint():
    r = client.get("/api/registry/node-definitions")
    assert r.status_code == 200
    types = {d["type_key"] for d in r.json()}
    assert {"input", "llm", "tool", "condition", "transform", "end"} <= types


# ---------- quickservice 黄金 fixture 兼容 ----------

QS_TYPE_MAP = {"start": "input", "end": "end", "llm": "llm", "plugin-tool": "tool",
               "code": "transform", "question-classifier": "condition",
               "variable-handle": "transform", "execution_workflow": "tool"}


def adapt_quickservice(raw: dict) -> WorkflowDefinition:
    nodes, edges = [], []
    for n in raw["nodes"]:
        d = n["data"]
        t = QS_TYPE_MAP.get(d.get("nodeType"), "transform")
        cfg: dict = {}
        if t == "llm":
            cfg = {"modelRef": {"modelId": "deepseek"}, "prompt": "x"}
        if t == "tool":
            cfg = {"toolVersionId": "tv1"}
        if t == "condition":
            cfg = {"branches": [{"handle": "yes"}]}
            nodes.append(None)  # placeholder removed below
        nodes.append({"id": n["id"], "type": t, "name": d.get("nodeName", t), "config": cfg})
    nodes = [n for n in nodes if n]
    for e in raw["edges"]:
        edges.append({"id": e["id"], "source": e["source"], "target": e["target"],
                      "sourceHandle": e.get("sourceHandle")})
    return WorkflowDefinition.model_validate({
        "schemaVersion": "1.0",
        "workflow": {"id": "qs", "name": "qs", "status": "draft"},
        "graph": {"nodes": nodes, "edges": edges},
        "io": {"structuredOutputs": [{"key": "quality_result", "schema": {}}]},
    })


@pytest.mark.skipif(not FIXTURE.exists(), reason="golden fixture missing")
def test_quickservice_fixture_flags_unconnected_like_product():
    raw = json.loads(FIXTURE.read_text())
    defn = adapt_quickservice(raw)
    report = validate(defn)
    flagged = {i.nodeId for i in report.issues if i.kind == "unconnected"}
    # 产品 checkList 标记的未连接节点（来自 17-badge 截图时代采集）应被我们同样标记
    product_unconnected = {"3b773218-5b5e-4889-8166-305d53260ca4",
                           "c1a3a6ae-27ee-42a9-836d-ff9bc689e3c6",
                           "e5b72e1a-9d03-4285-959d-5261d1b64ee6"}
    assert product_unconnected <= flagged, flagged
