#!/usr/bin/env bash
# 仓库级一键门禁 battery（09-13 审计 eng#20）。
#
# 为什么是本地脚本而不是仓库 CI：GitHub 网络不稳（历史多次不可达）且提交
# 长期本地未推——远端 Actions 保护不了任何真实合并流。规约：**任何交付提交前
# 必须本机跑绿本脚本**；.github/workflows/gates.yml 已写好，推送常态化后启用。
#
# 用法：
#   scripts/gate.sh            # 核心门禁（无需活体服务）
#   scripts/gate.sh --live     # 追加层3/层4（需 8120+5199 在线）
set -uo pipefail
cd "$(dirname "$0")/.."
FAIL=0
LIVE=0
[ "${1:-}" = "--live" ] && LIVE=1

run() {
  local name="$1"; local cmd="$2"
  echo "=== ${name} ==="
  if bash -c "$cmd" > /tmp/gate-last.log 2>&1; then
    echo "  OK"
  else
    echo "  FAIL（末尾输出如下，全量 /tmp/gate-last.log）"
    tail -6 /tmp/gate-last.log
    FAIL=1
  fi
}

run "前端 typecheck (tsc -p)"        "npx tsc --noEmit -p tsconfig.json"
run "前端 lint (eslint, 0 警告口径)" "npm run lint --silent -- --max-warnings=0"
run "前端单测 (vitest)"              "npx vitest run --silent"
run "前端构建 (tsc -b + vite)"       "npm run build --silent"
run "后端全量 (pytest)"              "cd server && .venv/bin/python -m pytest tests/ -q"
run "层1 假控件扫荡(基线只减不增)"   "python3 scripts/audit_layer1_fake_controls.py"
run "层2 契约扫荡(P0=0)"             "cd server && WF_DATABASE_URL='postgresql+psycopg://rivers@127.0.0.1:5432/wf_dev' .venv/bin/python ../scripts/audit_layer2_contract.py"
run "迁移单 head"                    "cd server && [ \"\$(.venv/bin/alembic heads 2>/dev/null | wc -l | tr -d ' ')\" = '1' ]"
run "secret 泄漏扫荡"                "node scripts/check-no-secret-leak.mjs"
run "npm audit (prod, high+)"        "npm audit --omit=dev --registry=https://registry.npmjs.org --audit-level=high"

if [ "$LIVE" = "1" ]; then
  run "层3 活体冒烟(8120, P0=0)"    "python3 scripts/audit_layer3_runtime.py --interval 5"
  run "层4 浏览器审计(5199)"         "node scripts/audit_layer4_ui.mjs"
  run "返工实证(5199)"               "node scripts/check-audit-rework-0913.mjs"
fi

echo
if [ "$FAIL" = "0" ]; then
  echo "ALL GATES GREEN$([ "$LIVE" = 1 ] && echo ' (含活体)')"
else
  echo "GATES FAILED —— 禁止交付提交"
fi
exit "$FAIL"
