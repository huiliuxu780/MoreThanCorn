#!/usr/bin/env bash
# 停止 start-dev-stack.sh 起的进程（按 pidfile；pidfile 缺失时按端口兜底）。
set -uo pipefail
for p in 8120 8301 8302 5173; do
  f=/tmp/devstack-$p.pid
  if [ -f "$f" ]; then
    kill "$(cat "$f")" >/dev/null 2>&1 && echo "stopped $p"
    rm -f "$f"
  else
    pid=$(lsof -nP -iTCP:$p -sTCP:LISTEN -t 2>/dev/null | head -1)
    if [ -n "$pid" ]; then
      echo "port $p held by pid $pid（非本脚本所起，未杀；如确认要杀：kill $pid）"
    fi
  fi
done
