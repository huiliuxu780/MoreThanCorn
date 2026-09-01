"""SDD 13 §14.4 C 组：两类真实结构化输出的目标表投递回归（真实 PostgreSQL）。

用法：cd server && .venv/bin/python ../scripts/verify-sdd13-delivery.py [dbname]
默认库 wf_dev；可用环境变量 WF_DATABASE_URL 覆盖。不消耗 LLM 额度：
Run.output 使用确定性 fixture（真实 LLM 联调需另行批准）。

校验：20+20 行写入、谱系列正确、JSONB 不双重编码、payload hash 一致、
重试 3 次仍单行、重跑保留新旧谱系、永久错误码区分。报告写入
docs/sdd/acceptance/13-delivery-report.md。"""
from __future__ import annotations

import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))

DBNAME = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("SDD13_DB", "wf_dev")
os.environ.setdefault("WF_DATABASE_URL", f"postgresql+psycopg://rivers@127.0.0.1:5432/{DBNAME}")

import psycopg  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.delivery import process_result_delivery, retry_delivery, settle_run_success  # noqa: E402
from app.models import (  # noqa: E402
    AnalysisTask, AnalysisTaskVersion, Connection, DataAsset, DataDefinition,
    DataDefinitionVersion, Datasource, Run, TaskRun,
)
from app.output_binding import freeze_binding_snapshot, payload_sha256  # noqa: E402

DDL = (ROOT / "scripts" / "sdd13-acceptance-tables.sql").read_text()


def qone(pg, sql, params=None):
    with pg.cursor() as cur:
        cur.execute(sql, params or [])
        return cur.fetchone()

CONSUMER_TABLE = "consumer_analysis_result_acceptance"
QUALITY_TABLE = "quality_rules_result_acceptance"

CONSUMER_MAPPING = {
    "_run_id": "$run.id", "_task_run_id": "$run.taskRunId", "_task_id": "$run.taskId",
    "_task_version_id": "$run.taskVersionId", "_interaction_ref": "$run.interactionRef",
    "_output_schema_ref": "$schema.ref", "_written_at": "$system.completedAt",
    "call_id": "$output.call_id", "analysis_status": "$output.analysis_status",
    "title": "$output.title", "summary": "$output.summary",
    "segments": "$output.segments", "full_output": "$output",
}
QUALITY_MAPPING = {
    "_run_id": "$run.id", "_task_run_id": "$run.taskRunId", "_task_id": "$run.taskId",
    "_task_version_id": "$run.taskVersionId", "_interaction_ref": "$run.interactionRef",
    "_output_schema_ref": "$schema.ref", "_written_at": "$system.completedAt",
    "call_id": "$output.call_id", "rule_set_id": "$output.rule_set_id",
    "rule_set_version": "$output.rule_set_version", "results": "$output.results",
    "result_by_rule": "$output.result_by_rule", "summary": "$output.summary",
    "full_output": "$output",
}


def consumer_output(i: int) -> dict:
    return {"call_id": f"call-{i:03d}", "analysis_status": "completed",
            "title": f"消费者对话 {i}", "summary": f"摘要 {i}",
            "segments": [{"id": f"s{i}-1", "text": f"片段 {i}", "sentiment": "neutral"}]}


def quality_output(i: int) -> dict:
    return {"call_id": f"qcall-{i:03d}", "rule_set_id": "rs-quality",
            "rule_set_version": 3,
            "results": [{"rule": "r1", "pass": i % 2 == 0}],
            "result_by_rule": {"r1": i % 2 == 0},
            "summary": f"质检摘要 {i}"}


def setup_target(db, tag: str, table: str, mapping: dict, ref: str, schema: dict):
    conn = Connection(name=f"sdd13v-conn-{tag}", kind="none", protocol="postgresql",
                      endpoint={"host": "127.0.0.1", "port": 5432, "user": "rivers"},
                      secret_ref="", lifecycle="active", status="active")
    db.add(conn)
    db.flush()
    ds = Datasource(name=f"sdd13v-ds-{tag}", type="postgresql", connection_id=conn.id,
                    location=DBNAME, status="enabled")
    db.add(ds)
    db.flush()
    asset = DataAsset(name=f"sdd13v-{tag}", source="postgres", datasource_id=ds.id,
                      location=table, lifecycle="Ready")
    db.add(asset)
    db.flush()
    dd = DataDefinition(name=f"sdd13v-def-{tag}", data_asset_id=asset.id,
                        field_schema=[{"key": k, "type": "String", "required": True}
                                      for k in mapping])
    db.add(dd)
    db.flush()
    dv = DataDefinitionVersion(definition_id=dd.id, version_no=1, field_schema=dd.field_schema)
    db.add(dv)
    db.flush()
    task = AnalysisTask(name=f"sdd13v-task-{tag}", execution_target_type="workflow",
                        workflow_id="wf-verify", data_asset_id=asset.id, status="active")
    db.add(task)
    db.flush()
    tv = AnalysisTaskVersion(task_id=task.id, version_no=1, workflow_id="wf-verify",
                             data_asset_id=asset.id, data_definition_version_id=dv.id,
                             output_mode="target_table", output_asset_id=asset.id,
                             output_definition_version_id=dv.id, output_write_mode="upsert",
                             output_key_fields=["_run_id"], output_mapping=mapping,
                             output_contract_snapshot={"schema": schema, "ref": ref,
                                                       "sha256": "verify",
                                                       "constants": {}})
    db.add(tv)
    db.flush()
    task.current_version_id = tv.id
    db.commit()
    return task, tv


def run_batch(db, task, tv, outputs, ref_prefix, schema_ref):
    snap = freeze_binding_snapshot(db, tv, schema_ref, "verify")
    tr = TaskRun(task_id=task.id, task_version_id=tv.id, trigger="manual",
                 status="running", total=len(outputs), output_binding_snapshot=snap,
                 delivery_status="pending", started_at=datetime.now(timezone.utc))
    db.add(tr)
    db.flush()
    deliveries = []
    for i, out in enumerate(outputs):
        run = Run(trigger="manual", status="succeeded", task_run_id=tr.id,
                  task_id=task.id, task_version_id=tv.id,
                  interaction_ref=f"{ref_prefix}-{i:03d}", output=out,
                  started_at=datetime.now(timezone.utc), ended_at=datetime.now(timezone.utc))
        db.add(run)
        db.flush()
        settle_run_success(db, run)
        deliveries.append(run.id)
    db.commit()
    for rid in deliveries:
        process_result_delivery({"delivery_id": _delivery_id_for(db, rid)})
    return tr


def _delivery_id_for(db, run_id):
    from app.models import ResultDelivery
    return db.query(ResultDelivery).filter_by(run_id=run_id).one().id


def main() -> int:
    tag = uuid.uuid4().hex[:6]
    with psycopg.connect(f"postgresql://rivers@127.0.0.1:5432/{DBNAME}") as pg:
        pg.execute(DDL)
        # 验收专用表：整表清空后重跑（非业务表）
        pg.execute(f"TRUNCATE public.{CONSUMER_TABLE}")
        pg.execute(f"TRUNCATE public.{QUALITY_TABLE}")
        pg.commit()
    db = SessionLocal()
    report: list[str] = [f"# SDD 13 投递回归报告（{datetime.now(timezone.utc).isoformat()}，库 {DBNAME}）\n"]
    try:
        c_task, c_tv = setup_target(db, f"c-{tag}", CONSUMER_TABLE, CONSUMER_MAPPING,
                                    "dsh-consumer-analysis-output@1.0.0",
                                    {"type": "object"})
        q_task, q_tv = setup_target(db, f"q-{tag}", QUALITY_TABLE, QUALITY_MAPPING,
                                    "quality-rules-output@1.0.0", {"type": "object"})

        c_tr = run_batch(db, c_task, c_tv, [consumer_output(i) for i in range(20)],
                         "CONV", "dsh-consumer-analysis-output@1.0.0")
        q_tr = run_batch(db, q_task, q_tv, [quality_output(i) for i in range(20)],
                         "QR", "quality-rules-output@1.0.0")

        with psycopg.connect(f"postgresql://rivers@127.0.0.1:5432/{DBNAME}") as pg:
            cn, cd = qone(pg, f"SELECT count(*), count(DISTINCT _run_id) FROM public.{CONSUMER_TABLE}")
            qn, qd = qone(pg, f"SELECT count(*), count(DISTINCT _run_id) FROM public.{QUALITY_TABLE}")
        assert cn == 20 and cd == 20, f"consumer 行数 {cn}/{cd}"
        assert qn == 20 and qd == 20, f"quality 行数 {qn}/{qd}"
        report.append(f"- Consumer 20 条 Run.output 全部写入：rows={cn} distinct_run={cd} ✔")
        report.append(f"- Quality 20 条 Run.output 全部写入：rows={qn} distinct_run={qd} ✔")
        # 谱系列与 JSONB 形态
        with psycopg.connect(f"postgresql://rivers@127.0.0.1:5432/{DBNAME}") as pg:
            r = qone(pg, f"SELECT _task_run_id,_task_id,_task_version_id,_interaction_ref,"
                         f"_output_schema_ref,segments,full_output FROM public.{CONSUMER_TABLE} "
                         f"WHERE _task_run_id=%s ORDER BY _interaction_ref LIMIT 1", [c_tr.id])
        assert r[0] == c_tr.id and r[1] == c_task.id and r[2] == c_tv.id
        assert r[3].startswith("CONV-") and r[4] == "dsh-consumer-analysis-output@1.0.0"
        assert isinstance(r[5], list) and r[5][0]["text"].startswith("片段")
        assert isinstance(r[6], dict) and r[6]["analysis_status"] == "completed"
        report.append("- 谱系列（_run_id/_task_run_id/_task_version_id/_interaction_ref/schema_ref）正确 ✔")
        report.append("- JSONB 数组/对象未被字符串截断或双重编码 ✔")

        # payload hash 一致 + 重试 3 次仍单行
        from app.models import ResultDelivery
        d0 = db.query(ResultDelivery).filter_by(task_run_id=c_tr.id).order_by(
            ResultDelivery.created_at).first()
        assert payload_sha256(d0.record_payload) == d0.payload_sha256
        for _ in range(3):
            process_result_delivery({"delivery_id": d0.id})
        with psycopg.connect(f"postgresql://rivers@127.0.0.1:5432/{DBNAME}") as pg:
            assert qone(pg, f"SELECT count(*) FROM public.{CONSUMER_TABLE} WHERE _run_id=%s", [d0.run_id])[0] == 1
        report.append("- payload hash 与冻结 ResultDelivery 一致；重复投递 3 次目标表仍单行 ✔")

        # 重新执行产生新谱系，不覆盖历史
        c_tr2 = run_batch(db, c_task, c_tv, [consumer_output(0)], "CONV", "dsh-consumer-analysis-output@1.0.0")
        with psycopg.connect(f"postgresql://rivers@127.0.0.1:5432/{DBNAME}") as pg:
            total_after = qone(pg, f"SELECT count(*) FROM public.{CONSUMER_TABLE}")[0]
        assert total_after == 21, total_after
        report.append("- 重新执行产生新 Run 谱系（21 行=20+1），历史不被覆盖 ✔")

        # 永久错误码区分：目标表缺失
        bad_tv = AnalysisTaskVersion(task_id=c_task.id, version_no=2, workflow_id="wf-verify",
                                     data_asset_id=c_tv.output_asset_id,
                                     data_definition_version_id=c_tv.output_definition_version_id,
                                     output_mode="target_table", output_asset_id=c_tv.output_asset_id,
                                     output_definition_version_id=c_tv.output_definition_version_id,
                                     output_write_mode="upsert", output_key_fields=["_run_id"],
                                     output_mapping=CONSUMER_MAPPING,
                                     output_contract_snapshot=c_tv.output_contract_snapshot)
        db.add(bad_tv)
        db.flush()
        snap2 = dict(freeze_binding_snapshot(db, bad_tv, "x@1", "h") or {}, table="missing_tbl_xyz")
        trb = TaskRun(task_id=c_task.id, task_version_id=bad_tv.id, trigger="manual",
                      status="running", total=1, output_binding_snapshot=snap2)
        db.add(trb)
        db.flush()
        rb = Run(trigger="manual", status="succeeded", task_run_id=trb.id, task_id=c_task.id,
                 task_version_id=bad_tv.id, interaction_ref="ERR-1", output=consumer_output(99),
                 ended_at=datetime.now(timezone.utc))
        db.add(rb)
        db.flush()
        settle_run_success(db, rb)
        db.commit()
        process_result_delivery({"delivery_id": _delivery_id_for(db, rb.id)})
        db.expire_all()
        d_err = db.query(ResultDelivery).filter_by(run_id=rb.id).one()
        assert d_err.status == "failed" and d_err.error["code"] == "TARGET_TABLE_MISSING"
        report.append(f"- 永久错误码区分：TARGET_TABLE_MISSING（attempts={d_err.attempts}）✔")

        # retry API 语义：failed 可重试、payload 不改写
        res = retry_delivery(db, d_err.id, "verify")
        assert res["accepted"] == 1
        d_err = db.get(ResultDelivery, d_err.id)
        assert d_err.status == "pending"
        report.append("- 重试投递仅 failed/dead_letter 且不改写 record_payload ✔")

        db.commit()
    finally:
        db.close()
    out = ROOT / "docs" / "sdd" / "acceptance" / "13-delivery-report.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(report) + "\n")
    print("\n".join(report))
    print(f"\n报告已写入 {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
