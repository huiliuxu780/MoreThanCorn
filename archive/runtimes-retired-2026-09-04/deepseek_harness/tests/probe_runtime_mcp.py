"""Start the bundled DSH runtime and require the MCP plugin to initialize."""

import tempfile
from pathlib import Path

from deepseek_harness import DeepSeekHarness, DeepSeekHarnessConfig

from app.adapter import configured_dsh_home, supports_profile_runtime


def _config(*, native: bool, workspace: Path, sessions: Path) -> DeepSeekHarnessConfig:
    runtime_root = Path(__file__).resolve().parents[1]
    common = {
        "model": "probe-model-not-called",
        "cwd": str(workspace),
        "runtime_cwd": str(workspace),
        "api_key": "probe-key-not-used",
        "env": {
            "QUALITY_TOOL_MCP_URL": "http://127.0.0.1:8200/mcp/",
            "DSH_TELEMETRY_DISABLED": "1",
        },
        "request_timeout_seconds": 15,
    }
    if supports_profile_runtime(DeepSeekHarnessConfig):
        common.update(
            dsh_home=str(configured_dsh_home()),
            profile="sdk",
            patches=()
            if native
            else (str(runtime_root / "config" / "disable_native_workflow.patch.yml"),),
        )
    else:
        cordis_name = "native_quality.cordis.yml" if native else "quality.cordis.yml"
        common.update(
            session_root=str(sessions),
            cordis=str(runtime_root / "config" / cordis_name),
        )
        if native:
            common["env"]["QUALITY_DSH_NATIVE_PLUGIN"] = str(
                runtime_root / "plugins" / "native_quality_workflow.mjs"
            )
    return DeepSeekHarnessConfig(**common)


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="quality-dsh-probe-") as root:
        workspace = Path(root) / "workspace"
        sessions = Path(root) / "sessions"
        workspace.mkdir()
        sessions.mkdir()
        config = _config(native=False, workspace=workspace, sessions=sessions)
        with DeepSeekHarness(config) as harness:
            harness.start()
            print("dsh runtime initialized with quality MCP composition")


def probe_native_workflow() -> None:
    with tempfile.TemporaryDirectory(prefix="quality-dsh-native-probe-") as root:
        workspace = Path(root) / "workspace"
        sessions = Path(root) / "sessions"
        workspace.mkdir()
        sessions.mkdir()
        config = _config(native=True, workspace=workspace, sessions=sessions)
        with DeepSeekHarness(config) as harness:
            harness.start()
            print("dsh runtime initialized with native Cordis workflow plugin")


if __name__ == "__main__":
    import sys

    probe_native_workflow() if "--native" in sys.argv else main()
