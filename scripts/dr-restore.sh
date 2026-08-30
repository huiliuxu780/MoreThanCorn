#!/usr/bin/env bash
# P2-05 DR 恢复：恢复到目标库（存在则重建）+ 核心表计数校验。用法：dr-restore.sh <dump> [target_db]
set -euo pipefail
DUMP="$1"
TARGET="${2:-wf_dr_drill}"
if psql -h 127.0.0.1 -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='$TARGET'" | grep -q 1; then
  psql -h 127.0.0.1 -d postgres -c "DROP DATABASE $TARGET"
fi
psql -h 127.0.0.1 -d postgres -c "CREATE DATABASE $TARGET"
pg_restore -h 127.0.0.1 -d "$TARGET" --no-owner --no-acl "$DUMP"
echo "restore ok: $TARGET"
for t in run quality_result agent analysis_task app_user; do
  psql -h 127.0.0.1 -d "$TARGET" -tAc "select '$t='||count(*) from $t"
done
