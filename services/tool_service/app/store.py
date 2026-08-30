"""Single deterministic implementation shared by HTTP and MCP transports."""

from __future__ import annotations

import json
import os
from copy import deepcopy
from pathlib import Path
from typing import Any

FIXTURE_DATASET = "quality-runtime-smoke-v0.1"
TOOL_VERSIONS = {
    "knowledge_search": "1.0.0",
    "ticket_query": "1.0.0",
    "sms_query": "1.0.0",
    "appointment_query": "1.0.0",
}


def default_fixture_path() -> Path:
    project_root = Path(__file__).resolve().parents[3]
    return (
        project_root
        / "poc"
        / "agent_runtime_providers"
        / "datasets"
        / "smoke"
        / "tool_fixtures_v0.1.json"
    )


class FixtureStore:
    def __init__(self, path: Path | None = None):
        configured = os.environ.get("QUALITY_TOOL_FIXTURES")
        self.path = Path(configured).resolve() if configured else (path or default_fixture_path())
        self.data: dict[str, Any] = json.loads(self.path.read_text(encoding="utf-8"))

    @property
    def dataset_id(self) -> str:
        return str(self.data.get("dataset_id") or FIXTURE_DATASET)

    def envelope(self, tool: str, output: dict[str, Any]) -> dict[str, Any]:
        return {
            "tool": tool,
            "version": TOOL_VERSIONS[tool],
            "fixture_dataset": self.dataset_id,
            "output": output,
        }

    def knowledge_search(self, query: str, limit: int = 3) -> dict[str, Any]:
        normalized = query.casefold()
        ranked: list[tuple[int, str, dict[str, Any]]] = []
        for article in self.data["knowledge_search"]["articles"]:
            required_terms = [
                str(term).casefold()
                for term in article.get("required_query_terms", [])
            ]
            if required_terms and not all(term in normalized for term in required_terms):
                continue
            score = sum(1 for keyword in article["keywords"] if keyword.casefold() in normalized)
            if score:
                ranked.append((score, article["id"], article))
        ranked.sort(key=lambda item: (-item[0], item[1]))
        items = [
            {
                "evidence_ref": article["id"],
                "title": article["title"],
                "content": article["content"],
                "match_score": score,
                "decisive": bool(article.get("decisive", True)),
                "refinement_hints": list(article.get("refinement_hints", [])),
            }
            for score, _article_id, article in ranked[:limit]
        ]
        return self.envelope(
            "knowledge_search",
            {"query": query, "items": items, "count": len(items)},
        )

    def _case_query(self, tool: str, case_id: str) -> dict[str, Any]:
        records = self.data[tool]
        known = case_id in records
        output = deepcopy(records.get(case_id, {}))
        output.update({"case_id": case_id, "case_known": known})
        if not known:
            if tool == "ticket_query":
                output.update({"exists": False, "tickets": []})
            elif tool == "sms_query":
                output.update({"sent": False, "messages": []})
            elif tool == "appointment_query":
                output.update({"exists": False, "appointments": []})
        return self.envelope(tool, output)

    def ticket_query(self, case_id: str) -> dict[str, Any]:
        return self._case_query("ticket_query", case_id)

    def sms_query(self, case_id: str) -> dict[str, Any]:
        return self._case_query("sms_query", case_id)

    def appointment_query(self, case_id: str) -> dict[str, Any]:
        return self._case_query("appointment_query", case_id)
