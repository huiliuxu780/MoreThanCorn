"""quality-analysis 评测套件（SDD 10 §9.1）：Ground Truth 对比评分。

Ground Truth 数据源自 POC（poc/agent_runtime_providers/datasets），按 criterion status 对比；
insufficient_evidence 与 not_applicable 属业务结论而非系统错误（§12.2）。
"""
from __future__ import annotations

import json
from pathlib import Path

_MODULE_DIR = Path(__file__).resolve().parent.parent  # quality_analysis/
# 仓库内 POC 数据集（评估迁移白名单内，非结果数据）
DATASETS_DIR = Path(__file__).resolve().parents[4] / "poc" / "agent_runtime_providers" / "datasets"


def load_ground_truth(name: str = "native_workflow/ground_truth_v0.2.jsonl") -> list[dict]:
    path = DATASETS_DIR / name
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()]


def evaluate(output: dict, expected: dict) -> dict:
    """按 criterion id 对比 status；全部一致=passed。"""
    got = {c.get("id"): c.get("status") for c in (output.get("criteria") or [])}
    want = {c.get("id"): c.get("status") for c in (expected.get("criteria") or [])}
    matched = sum(1 for k, v in want.items() if got.get(k) == v)
    return {"passed": bool(want) and matched == len(want),
            "matched": matched, "total": len(want),
            "detail": [{"id": k, "expected": v, "actual": got.get(k)} for k, v in want.items()]}


def default_suite(output: dict, sample: dict) -> dict:
    """evaluator 入口：output + 样本（含 expected）→ 判定。"""
    return evaluate(output, sample.get("expected") or {})
