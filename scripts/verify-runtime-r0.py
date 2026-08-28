"""Mechanical Phase R0 boundary checks.

This is intentionally dependency-free so it can run with the system Python.
It verifies repository structure and import/security boundaries; provider
behavior remains covered by each package's locked pytest suite.
"""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def require(path: str) -> Path:
    candidate = ROOT / path
    assert candidate.exists(), f"missing R0 artifact: {path}"
    return candidate


def python_sources(root: Path) -> list[Path]:
    return [
        path
        for path in root.rglob("*.py")
        if not any(part in {".venv", ".pytest_cache", "__pycache__"} for part in path.parts)
    ]


def main() -> None:
    projects = [
        "packages/runtime_contract",
        "packages/runtime_service",
        "runtimes/agentscope",
        "runtimes/deepseek_harness",
        "poc/agent_runtime_providers/evaluation",
    ]
    for project in projects:
        require(f"{project}/pyproject.toml")
        require(f"{project}/uv.lock")

    contract = require(
        "packages/runtime_contract/src/quality_runtime_contract/models.py"
    ).read_text(encoding="utf-8")
    assert "extra=\"forbid\"" in contract
    assert "server.app" not in contract
    for forbidden_domain in ("QualityResult", "AnalysisTask", "Scorecard", "ReviewRevision"):
        assert f"class {forbidden_domain}" not in contract

    server_text = "\n".join(
        path.read_text(encoding="utf-8")
        for path in python_sources(require("server/app"))
    )
    assert "import agentscope" not in server_text
    assert "from agentscope" not in server_text
    assert "import deepseek_harness" not in server_text
    assert "from deepseek_harness" not in server_text

    production_roots = [
        require("packages"),
        require("runtimes"),
    ]
    production_text = "\n".join(
        path.read_text(encoding="utf-8", errors="replace")
        for root in production_roots
        for path in root.rglob("*")
        if path.is_file()
        and not any(
            part in {".venv", ".pytest_cache", "__pycache__"}
            for part in path.parts
        )
    )
    assert "/Users/rivers/MoreThanCorn-agent-runtime-poc" not in production_text
    assert '"DSH_PERMISSION_MODE": "danger-full-access"' not in production_text

    for forbidden_name in (".env.local",):
        found = [
            path
            for root in production_roots
            for path in root.rglob(forbidden_name)
        ]
        assert not found, f"forbidden local secret file: {found}"

    require("runtimes/agentscope/Dockerfile")
    require("runtimes/deepseek_harness/Dockerfile")
    require("docs/poc/runtime-contract-v0.1.md")
    require("poc/agent_runtime_providers/.env.example")

    print("R0 boundary verification PASS")


if __name__ == "__main__":
    main()
