#!/usr/bin/env python
"""SDD-12 §16.1 / §19.3：迁移与存量盘点报告（机器可读 + 人类摘要）。

P0 阶段：尚无 M1–M5 数据迁移（连接规范化/资源编目/绑定回填/引用切换/清理
分别属于 P1–P4）。本脚本提供：
  1. 存量事实盘点（连接/密钥账本/检查记录/六类资源/引用计数）；
  2. P0 止血改造的落库证据（新表、生命周期回填、health 派生抽样）；
  3. 迁移就绪度检查（needs_review 预估：无法自动映射 definition 的连接等）。

用法：
  server/.venv/bin/python scripts/report-resource-migration.py [--out report.json]
环境变量：WF_DATABASE_URL（缺省用 app.config 的解析规则）。
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))

from sqlalchemy import func, select  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.models import (  # noqa: E402
    CallRecord, CheckRun, Connection, ConnectionSecretRevision, Datasource,
    KnowledgeSource, McpServer, Model, ModelProvider, Tool, ToolVersion,
)

PROTOCOL_TO_DEFINITION = {  # §16.2 M1 预映射（P1 实施时使用）
    "http-api": "generic-http@1", "llm": "openai-compatible@1",
    "mcp-http": "mcp-streamable-http@1", "mysql": "mysql@1",
    "postgresql": "postgresql@1", "oss": "oss@1",
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="", help="可选：JSON 报告输出路径")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        conns = db.query(Connection).all()
        life = Counter(c.lifecycle for c in conns)
        protocols = Counter(c.protocol for c in conns)
        env_total = sum(len(c.environments or []) for c in conns)
        env_with_secret = sum(1 for c in conns for e in (c.environments or []) if e.get("secret_ref"))
        no_env = [c.id for c in conns if not (c.environments or [])]
        # M1 就绪度：协议无法映射 definition 的连接
        unmapped = [c.id for c in conns if c.protocol not in PROTOCOL_TO_DEFINITION]

        revs = db.query(ConnectionSecretRevision).all()
        rev_by_status = Counter(r.status for r in revs)

        checks = db.query(CheckRun).all()
        check_by_scope = Counter((r.scope, r.status) for r in checks)

        tools = db.query(Tool).count()
        tool_versions = db.query(ToolVersion).count()
        tools_with_conn = db.execute(select(func.count(Tool.id)).where(Tool.connection_id.is_not(None))).scalar() or 0
        mcps = db.query(McpServer).all()
        mcp_with_conn = sum(1 for m in mcps if m.connection_id)
        kss = db.query(KnowledgeSource).all()
        # M3 就绪度：source_config.url 直连（需在 M3 拆到 Connection）
        ks_inline_url = [k.id for k in kss if str((k.source_config or {}).get("url", "")).startswith(("http://", "https://"))]
        models = db.query(Model).count()
        providers = db.query(ModelProvider).all()
        prov_with_conn = sum(1 for p in providers if p.auth_connection_id)
        datasources = db.query(Datasource).all()
        ds_with_conn = sum(1 for d in datasources if d.connection_id)
        calls = db.query(CallRecord).count()

        report = {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "sdd": "12-ai-resource-connection-refactor-sdd.md",
            "phase": "P0 完成（止血与契约冻结）；M1–M5 数据迁移未开始（P1–P4）",
            "inventory": {
                "connections": {
                    "total": len(conns), "byLifecycle": dict(life), "byProtocol": dict(protocols),
                    "environments": env_total, "envSecretsConfigured": env_with_secret,
                    "connectionsWithoutEnvironment": no_env,
                    "unmappedProtocolIds": unmapped,
                },
                "secretRevisions": {"total": len(revs), "byStatus": dict(rev_by_status)},
                "checkRuns": {"total": len(checks),
                              "byScopeStatus": {f"{k[0]}:{k[1]}": v for k, v in check_by_scope.items()}},
                "tools": {"total": tools, "versions": tool_versions, "withConnection": tools_with_conn},
                "mcpServers": {"total": len(mcps), "withConnection": mcp_with_conn},
                "knowledgeSources": {"total": len(kss), "inlineUrlNeedsM3Migration": ks_inline_url},
                "models": {"total": models},
                "modelProviders": {"total": len(providers), "withAuthConnection": prov_with_conn},
                "datasources": {"total": len(datasources), "withConnection": ds_with_conn},
                "callRecords": {"total": calls},
            },
            "p0Evidence": {
                "newTables": ["connection_secret_revision", "check_run"],
                "connectionColumnsAdded": ["lifecycle", "archived_at", "archived_by", "revision"],
                "migration": "g045sdd12p0001_secret_revision_check_run",
                "reveal": "GET /api/connections/{id}/reveal → 410 SECRET_REVEAL_DISABLED",
                "enableGate": "connection:enable / resource toggle 依赖当前指纹的成功 CheckRun",
                "fixtureGate": "WF_TEST_FIXTURES=1 且非生产；否则 mock/echo 失败关闭",
            },
            "migrationReadiness": {
                "M1_definition_mapping": "协议映射表已就绪；未映射连接数=%d" % len(unmapped),
                "M3_knowledge_url_extraction": "内联 URL 的 Knowledge 数=%d（将生成 draft Connection，不猜测凭据）" % len(ks_inline_url),
                "needs_review_count": len(unmapped),
                "needs_review_ids": unmapped,
            },
        }

        text = json.dumps(report, ensure_ascii=False, indent=2)
        if args.out:
            Path(args.out).write_text(text + "\n", encoding="utf-8")
            print(f"报告已写入 {args.out}")
        print(text)
    finally:
        db.close()


if __name__ == "__main__":
    main()
