"""旧 Agent 数据封存工具入口（SDD 10 R-A3）。

默认 dry-run：只盘点将要封存的对象与 Workflow 引用清单，不修改任何数据。
显式 --apply 才在单事务内执行：旧 Agent archived=true、活跃 Release → offline、
引用旧 Agent 的 Schedule → enabled=false、AnalysisTask → paused，并写 AuditLog；
Workflow 图只输出引用节点清单，不自动改写。幂等可重复执行。

本地开发只跑 dry-run；对真实数据执行 --apply 需用户显式授权。
"""
import argparse
import json

from app.db import SessionLocal
from app.legacy_agent_archive import _cap, apply_archive, collect_archive_plan


def main() -> None:
    parser = argparse.ArgumentParser(description="旧三类 Agent 数据封存工具（默认 dry-run）")
    parser.add_argument("--apply", action="store_true",
                        help="实际执行封存（默认 dry-run 只读盘点）")
    parser.add_argument("--actor", default="legacy-archive-cli", help="审计日志 actor")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        if args.apply:
            summary = apply_archive(db, actor=args.actor)
            print(json.dumps(summary, ensure_ascii=False, indent=2, default=str))
        else:
            plan = collect_archive_plan(db)
            for key in ("agentsToArchive", "releasesToOffline", "schedulesToDisable",
                        "tasksToPause"):
                plan[key] = _cap(plan[key])
            print("[dry-run] 未修改任何数据；加 --apply 执行封存")
            print(json.dumps(plan, ensure_ascii=False, indent=2, default=str))
    finally:
        db.close()


if __name__ == "__main__":
    main()
