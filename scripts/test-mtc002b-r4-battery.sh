#!/usr/bin/env bash
# MTC-002B-R4 回归电池（R4-Battery-R 返工：受版本控制 + 固定 test manifest + 输出 collected/passed）。
#
# Manifest（94 collected，与 docs/acceptance 交付文档一致）：
#   MTC-002A/002B 全系列 67：
#     tests/test_mtc002a_automations.py    8
#     tests/test_mtc002a_r_contracts.py   10
#     tests/test_mtc002b_work_items.py    23
#     tests/test_mtc002b_r_fixes.py        8
#     tests/test_mtc002b_r2.py            11
#     tests/test_mtc002b_r3.py             7
#   相邻回归 27：
#     tests/test_p0_schedule.py            4
#     tests/test_p0_taskrun.py             9
#     tests/test_p1_task.py                2
#     tests/test_sdd13_delivery.py         9
#     tests/test_p2_data_scope.py          3
#
# 用法：
#   scripts/test-mtc002b-r4-battery.sh        # 跑 1 次
#   scripts/test-mtc002b-r4-battery.sh 3      # 验收口径：连续 3 次全绿
#
# 失败语义：任一 run 非全绿 → 非零退出；collected 数漂移（增删用例未同步本脚本）→ exit 2。
set -euo pipefail
cd "$(dirname "$0")/../server"

RUNS="${1:-1}"
EXPECTED_COLLECTED=94
TESTS=(
  tests/test_mtc002a_automations.py
  tests/test_mtc002a_r_contracts.py
  tests/test_mtc002b_work_items.py
  tests/test_mtc002b_r_fixes.py
  tests/test_mtc002b_r2.py
  tests/test_mtc002b_r3.py
  tests/test_p0_schedule.py
  tests/test_p0_taskrun.py
  tests/test_p1_task.py
  tests/test_sdd13_delivery.py
  tests/test_p2_data_scope.py
)

PY=.venv/bin/python
[ -x "$PY" ] || { echo "缺少 server/.venv（先 uv sync）" >&2; exit 3; }

collected=$("$PY" -m pytest "${TESTS[@]}" --collect-only -q 2>/dev/null | tail -1 | grep -oE '^[0-9]+' || true)
echo "collected: ${collected:-0} (expected ${EXPECTED_COLLECTED})"
if [ "${collected:-0}" != "$EXPECTED_COLLECTED" ]; then
  echo "MANIFEST DRIFT: collected=${collected:-0} expected=${EXPECTED_COLLECTED}" >&2
  echo "电池文件增删用例后，请同步本脚本 EXPECTED_COLLECTED 与头部 manifest 注释。" >&2
  exit 2
fi

for i in $(seq 1 "$RUNS"); do
  echo "== battery run ${i}/${RUNS} =="
  "$PY" -m pytest "${TESTS[@]}" -q --tb=short -rf | tail -2
done
echo "battery OK: ${RUNS} run(s) x ${EXPECTED_COLLECTED} passed"
