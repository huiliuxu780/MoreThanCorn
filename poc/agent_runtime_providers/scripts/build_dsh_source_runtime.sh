#!/usr/bin/env bash
set -euo pipefail

POC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACT_ROOT="${DSH_ARTIFACT_ROOT:-${POC_ROOT}/.artifacts/dsh-source}"
SOURCE_DIR="${DSH_SOURCE_DIR:-${ARTIFACT_ROOT}/checkout}"
DIST_DIR="${ARTIFACT_ROOT}/wheels"
DSH_SOURCE_REF="${DSH_SOURCE_REF:-dsh-v0.1.2-alpha.1}"

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

find_node() {
  local candidate
  for candidate in \
    "${DSH_NODE_BIN:-}" \
    "${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" \
    /opt/homebrew/opt/node@24/bin/node \
    /opt/homebrew/bin/node \
    node; do
    if [[ -n "${candidate}" ]] && command -v "${candidate}" >/dev/null 2>&1; then
      if "${candidate}" -e '
        const [major, minor] = process.versions.node.split(".").map(Number)
        process.exit(major < 22 || (major === 22 && minor < 19) ? 1 : 0)
      '; then
        command -v "${candidate}"
        return 0
      fi
    fi
  done
  echo "Node >=22.19 is required" >&2
  return 1
}

PYTHON_BIN="$(find_python)"
NODE_BIN="$(find_node)"
NODE_VERSION="$("${NODE_BIN}" -p 'process.versions.node')"
export PATH="$(dirname "${NODE_BIN}"):${PATH}"

mkdir -p "${ARTIFACT_ROOT}" "${DIST_DIR}"
if [[ ! -d "${SOURCE_DIR}/.git" ]]; then
  git clone https://github.com/deepseek-ai/deepseek-harness.git "${SOURCE_DIR}"
fi

git -C "${SOURCE_DIR}" fetch --tags origin
git -C "${SOURCE_DIR}" checkout --detach "${DSH_SOURCE_REF}"

(
  cd "${SOURCE_DIR}"
  pnpm install --frozen-lockfile
  pnpm exec tsx scripts/build-exe-for-python-sdk.ts --targets=node24-macos-arm64
  UV_CACHE_DIR="${ARTIFACT_ROOT}/uv-cache" "${PYTHON_BIN}" \
    scripts/build-python-release.py --package sdk --output-dir "${DIST_DIR}"
  UV_CACHE_DIR="${ARTIFACT_ROOT}/uv-cache" "${PYTHON_BIN}" \
    scripts/build-python-release.py \
    --package runtime \
    --platform macos-arm64 \
    --runtime-exe dist-exe/deepseek-harness-sdk-runtime-macos-arm64 \
    --output-dir "${DIST_DIR}"
)

echo "DSH source ref: ${DSH_SOURCE_REF}"
echo "Node: ${NODE_VERSION}"
echo "Wheels: ${DIST_DIR}"
