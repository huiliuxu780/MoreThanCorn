#!/usr/bin/env bash
# 一键起本地验收栈（dev，wf_dev 库）：backend 8120 + fake providers 8301/8302 + vite 5173。
# 诚实标注：8301/8302 是 fake provider（固定输出，仅打通链路/验收用，非真实业务判断）。
# 真实 Agent 运行需真实模型 Key（见 REAL RUNTIME 段注释）——占位 key 下真路径恒 401。
# 已占用的端口自动跳过；停止用 scripts/stop-dev-stack.sh。
set -euo pipefail
cd "$(dirname "$0")/.."

port_free() { ! lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

if port_free 8120; then
  (cd server && nohup .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8120 > /tmp/devstack-8120.log 2>&1 & echo $! > /tmp/devstack-8120.pid)
  echo "backend  -> http://127.0.0.1:8120 (wf_dev)"
else
  echo "backend 8120 已在运行，跳过"
fi

if port_free 8301; then
  (cd server && FAKE_PROVIDER_KIND=agentscope nohup .venv/bin/python -m uvicorn --app-dir tools fake_provider_8301:app --host 127.0.0.1 --port 8301 > /tmp/devstack-8301.log 2>&1 & echo $! > /tmp/devstack-8301.pid)
  echo "fake AgentScope provider -> 8301（固定输出，非真判断）"
else
  echo "8301 已在运行，跳过"
fi

if port_free 8302; then
  (cd server && FAKE_PROVIDER_KIND=deepseek-harness nohup .venv/bin/python -m uvicorn --app-dir tools fake_provider_8301:app --host 127.0.0.1 --port 8302 > /tmp/devstack-8302.log 2>&1 & echo $! > /tmp/devstack-8302.pid)
  echo "fake DSH provider -> 8302（固定输出，非真判断）"
else
  echo "8302 已在运行，跳过"
fi

if port_free 5173; then
  (VITE_WF_API_BASE=http://127.0.0.1:8120 nohup npm run dev > /tmp/devstack-5173.log 2>&1 & echo $! > /tmp/devstack-5173.pid)
  echo "frontend -> http://localhost:5173（Vite 只绑 ::1，用 localhost）"
else
  echo "5173 已在运行，跳过"
fi

cat <<'EOF'

REAL RUNTIME（真实 Agent 运行）缺什么：
  1. 真实模型 Key：连接页轮换 LLM-DashScope 的占位 key（或 export QUALITY_MODEL_API_KEY 后起真 AgentScope runtime：
     cd runtimes/agentscope && .venv/bin/python -m uvicorn app.main:app --port 8301 —— 需先停 fake 8301）
  2. DSH 真路径另需 provisioned DSH home + bundle（见 runtimes/deepseek_harness）
EOF
