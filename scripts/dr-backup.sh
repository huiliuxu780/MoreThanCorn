#!/usr/bin/env bash
# P2-05 DR 备份：pg_dump custom format。用法：dr-backup.sh [db] [out.dump]
set -euo pipefail
DB="${1:-wf_dev}"
OUT="${2:-/tmp/dr-$(date +%Y%m%d-%H%M%S)-${DB}.dump}"
pg_dump -h 127.0.0.1 -Fc -f "$OUT" "$DB"
echo "backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
