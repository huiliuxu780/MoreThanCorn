"""09-18 TrueAsk 场景：注册飞书包装层工具 + submit 工具（幂等）。

Connection platform-local-dev（kind=none，base_url=本机 8120）+ 三工具 ready +
ToolVersion spec 配方（body=$args，相对 URL 拼 connection base）。
飞书两工具 dev-only（包装层自身 404 兜底）；submit 端点生产可用但飞书写回 dev-only。
用法：server/.venv/bin/python scripts/register_trueask_tools.py
"""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.db import SessionLocal  # noqa: E402
from app.models import Connection, Tool, ToolVersion  # noqa: E402

BASE = "http://127.0.0.1:8120"

TOOLS = [
    {
        "name": "feishu_record_list",
        "description": "飞书多维表格记录读取（lark-cli 包装层，dev-only；分页 offset/limit≤200）",
        "input_schema": {
            "type": "object",
            "required": ["base_token", "table_id"],
            "properties": {
                "base_token": {"type": "string"},
                "table_id": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 200},
                "offset": {"type": "integer", "minimum": 0},
                "field_ids": {"type": "array", "items": {"type": "string"}},
            },
        },
        "url": "/api/feishu-tools/record_list",
    },
    {
        "name": "feishu_record_batch_create",
        "description": "飞书多维表格批量写记录（lark-cli 包装层，dev-only；rows 跟随 fields 序）",
        "input_schema": {
            "type": "object",
            "required": ["base_token", "table_id", "fields", "rows"],
            "properties": {
                "base_token": {"type": "string"},
                "table_id": {"type": "string"},
                "fields": {"type": "array", "items": {"type": "string"}},
                "rows": {"type": "array", "items": {"type": "array"}},
            },
        },
        "url": "/api/feishu-tools/record_batch_create",
    },
    {
        "name": "submit_trueask_analysis_result",
        "description": "提交 trueask-profile-v4 语义分析结果（硬校验；成功回执=任务终态；"
                       "落 acceptance 镜像并按配置写回飞书目标表）",
        "input_schema": {
            "type": "object",
            "required": ["analysis_status", "title", "summary", "segments"],
            "properties": {
                "call_id": {"type": "string"},
                "analysis_status": {"type": "string",
                                    "enum": ["in-scope", "partially-in-scope",
                                             "out-of-scope", "insufficient-content"]},
                "title": {"type": "string"},
                "summary": {"type": "string"},
                "segments": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["start_index", "end_index", "scenario_id",
                                     "intention", "quality_id", "quality_reason"],
                        "properties": {
                            "start_index": {"type": "integer"},
                            "end_index": {"type": "integer"},
                            "scenario_id": {"type": "string"},
                            "intention": {"type": "string"},
                            "quality_id": {"type": "string"},
                            "quality_reason": {"type": "string"},
                            "entities": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "required": ["type_id", "subtype_id", "value"],
                                    "properties": {
                                        "type_id": {"type": "string"},
                                        "subtype_id": {"type": "string"},
                                        "value": {"type": "string"},
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        "url": "/api/v2/trueask/submit",
    },
]


def main() -> None:
    db = SessionLocal()
    try:
        conn = db.query(Connection).filter_by(name="platform-local-dev").first()
        if not conn:
            conn = Connection(name="platform-local-dev", kind="none",
                              protocol="http-api",
                              endpoint={"base_url": BASE}, secret_ref="")
            db.add(conn)
            db.flush()
        for spec in TOOLS:
            tool = db.query(Tool).filter_by(name=spec["name"]).first()
            if tool is None:
                tool = Tool(name=spec["name"], description=spec["description"],
                            kind="http", status="draft")
                db.add(tool)
                db.flush()
            tool.connection_id = conn.id
            tool.status = "ready"
            tool.description = spec["description"]
            tv = (db.query(ToolVersion).filter_by(tool_id=tool.id)
                  .order_by(ToolVersion.version_no.desc()).first())
            if tv is None:
                tv = ToolVersion(tool_id=tool.id, version_no=1)
                db.add(tv)
                db.flush()
            tv.input_schema = spec["input_schema"]
            tv.output_schema = {}
            tv.spec = {"request": {"method": "POST", "url": spec["url"],
                                   "body": "$args"}}
            tv.status = "ready"
            print("ready:", spec["name"], tool.id)
        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    main()
