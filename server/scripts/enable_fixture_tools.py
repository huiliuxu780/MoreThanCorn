"""09-18 端到端补全：把 quality-analysis 四个只读工具接到 dev fixture 后端并启用。

幂等：Connection fixture-tools-dev + 四工具 connection_id/status=ready +
ToolVersion spec.request 配方（body=$args）。生产禁用（fixture 路由自身 404 兜底）。
用法：server/.venv/bin/python scripts/enable_fixture_tools.py
"""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.db import SessionLocal  # noqa: E402
from app.models import Connection, Tool, ToolVersion  # noqa: E402

TOOLS = ["knowledge_search", "ticket_query", "sms_query", "appointment_query"]
BASE = "http://127.0.0.1:8120/api/fixture-tools"


def main() -> None:
    db = SessionLocal()
    try:
        conn = db.query(Connection).filter_by(name="fixture-tools-dev").first()
        if not conn:
            conn = Connection(name="fixture-tools-dev", kind="none",
                              protocol="http-api",
                              endpoint={"base_url": BASE}, secret_ref="")
            db.add(conn)
            db.flush()
        for name in TOOLS:
            tool = db.query(Tool).filter_by(name=name).first()
            if tool is None:
                print("skip missing tool:", name)
                continue
            tool.connection_id = conn.id
            tool.status = "ready"
            tv = (db.query(ToolVersion).filter_by(tool_id=tool.id)
                  .order_by(ToolVersion.version_no.desc()).first())
            if tv is None:
                tv = ToolVersion(tool_id=tool.id, version_no=1,
                                 input_schema={}, output_schema={})
                db.add(tv)
                db.flush()
            tv.spec = {"request": {"method": "POST",
                                   "url": f"{BASE}/{name}",
                                   "body": "$args"}}
            tv.status = "ready"
        db.commit()
        print("fixture tools enabled:", TOOLS)
    finally:
        db.close()


if __name__ == "__main__":
    main()
