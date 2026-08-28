#!/usr/bin/env bash
set -euo pipefail

POC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${POC_ROOT}/../.." && pwd)"
ARTIFACT_ROOT="${DSH_ARTIFACT_ROOT:-${POC_ROOT}/.artifacts/dsh-source}"
WHEEL_DIR="${ARTIFACT_ROOT}/wheels"
VENV_DIR="${DSH_VENV_DIR:-${ARTIFACT_ROOT}/venv}"
DSH_HOME_DIR="${QUALITY_DSH_HOME:-${ARTIFACT_ROOT}/home}"
PLUGIN_DIR="${REPO_ROOT}/runtimes/deepseek_harness/plugins"

find_python() {
  local candidate
  for candidate in "${DSH_PYTHON:-}" python3.12 python3.11 python3.10 python3; do
    if [[ -n "${candidate}" ]] && command -v "${candidate}" >/dev/null 2>&1; then
      if "${candidate}" -c 'import sys; raise SystemExit(sys.version_info < (3, 10))'; then
        command -v "${candidate}"
        return 0
      fi
    fi
  done
  echo "Python >=3.10 is required" >&2
  return 1
}

SDK_WHEEL="$(find "${WHEEL_DIR}" -maxdepth 1 -name 'deepseek_harness_sdk-0.1.2a1-*.whl' -print -quit)"
RUNTIME_WHEEL="$(find "${WHEEL_DIR}" -maxdepth 1 -name 'deepseek_harness_runtime_bin-0.1.2a1-*.whl' -print -quit)"
if [[ -z "${SDK_WHEEL}" || -z "${RUNTIME_WHEEL}" ]]; then
  echo "Build the DSH source wheels first: ${POC_ROOT}/scripts/build_dsh_source_runtime.sh" >&2
  exit 1
fi

PYTHON_BIN="$(find_python)"
"${PYTHON_BIN}" -m venv "${VENV_DIR}"
"${VENV_DIR}/bin/python" -m pip install "${RUNTIME_WHEEL}" "${SDK_WHEEL}"
"${VENV_DIR}/bin/python" -m pip install \
  -e "${REPO_ROOT}/packages/runtime_contract" \
  -e "${REPO_ROOT}/packages/runtime_service" \
  -e "${REPO_ROOT}/runtimes/deepseek_harness[test]"

mkdir -p "${DSH_HOME_DIR}"
DSH_HOME="${DSH_HOME_DIR}" "${VENV_DIR}/bin/dsh" --profile sdk --dump-default-config >/dev/null
DSH_HOME="${DSH_HOME_DIR}" "${VENV_DIR}/bin/dsh" \
  plugin --profile sdk add "file:${PLUGIN_DIR}"

echo "DSH Python: ${VENV_DIR}/bin/python"
echo "DSH home: ${DSH_HOME_DIR}"
echo "Runtime service:"
echo "  QUALITY_DSH_HOME=${DSH_HOME_DIR} ${VENV_DIR}/bin/python -m uvicorn app.main:app --app-dir ${REPO_ROOT}/runtimes/deepseek_harness --host 127.0.0.1 --port 8302"
