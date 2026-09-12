"""四层审计·层3：四执行体运行时行为审计（2026-09-13）。

对活体 8120（验收栈，wf_dev）只读审计：不触发执行、不写数据、不耗 LLM 额度。

A. 双快照（默认间隔 5s）禁止转移检查：
   - 终态行状态回退（terminal → 任何其他状态）= P0；
   - 活跃态逆向（running→queued 等）= P0。
B. 单快照不变量：
   B1 status ∈ 各执行体 canonical 枚举（P0）；
   B2 终态 ⇒ endedAt 非空（F0 真实性；Run 列表无 endedAt，抽样详情 ≤20）（P1）；
   B3 Invocation target XOR：kind 与 ref 一致、至多一个 target（P0）；
      终态 COMPLETED 必须有 target（P1）；
   B4 TaskRun Recovery 血缘：retryOfTaskRunId ⇒ 原批次已终态（AC-035A）（P0）；
   B5 TaskRun 计数一致性：succeeded+failed+skipped+cancelled ≤ total；
      totalState=exact ⇒ processedCount ≤ total（P1）；
   B6 work-item 统一状态 ∈ 5 态；needs_action ⇒ attention.required（P0）；
   B7 AgentFlowRun 终态 ⇒ 无 running 节点行（P1）。

覆盖率诚实上报：每执行体采样行数随结果输出（0 行 = 未覆盖，不算通过）。
退出码：有 P0 → 1。
用法：python3 scripts/audit_layer3_runtime.py [--base URL] [--interval S] [--json-out PATH]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

# ---------- canonical 状态机（以运行代码为准，2026-09-13 核对） ----------

RUN_ENUM = {"queued", "running", "paused", "succeeded", "failed", "cancelled"}
RUN_TERMINAL = {"succeeded", "failed", "cancelled"}
TASKRUN_ENUM = {"queued", "running", "partial", "succeeded", "failed", "cancelled"}
TASKRUN_TERMINAL = {"partial", "succeeded", "failed", "cancelled"}
FLOWRUN_ENUM = {"queued", "running", "succeeded", "failed", "cancelled"}
FLOWRUN_TERMINAL = {"succeeded", "failed", "cancelled"}
NODE_ACTIVE = {"running", "queued", "pending"}
INV_ENUM = {"RECEIVED", "ACCEPTED", "QUEUED", "RUNNING", "COMPLETED",
            "FAILED", "CANCELLED", "DEDUPED", "REJECTED"}
INV_TERMINAL = {"COMPLETED", "FAILED", "CANCELLED", "DEDUPED", "REJECTED"}
WI_ENUM = {"needs_action", "running", "completed", "queued", "failed_cancelled"}

# 禁止的逆向边（snapshot1 → snapshot2）
BACKWARD = {
    "run": {("running", "queued"), ("paused", "queued")},
    "taskrun": {("running", "queued")},
    "agentflow_run": {("running", "queued")},
    "invocation": {("RUNNING", "QUEUED"), ("RUNNING", "ACCEPTED"),
                   ("RUNNING", "RECEIVED"), ("QUEUED", "ACCEPTED"),
                   ("QUEUED", "RECEIVED"), ("ACCEPTED", "RECEIVED")},
}
TERMINALS = {"run": RUN_TERMINAL, "taskrun": TASKRUN_TERMINAL,
             "agentflow_run": FLOWRUN_TERMINAL, "invocation": INV_TERMINAL}
ENUMS = {"run": RUN_ENUM, "taskrun": TASKRUN_ENUM,
         "agentflow_run": FLOWRUN_ENUM, "invocation": INV_ENUM}


class Audit:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.findings: list[dict] = []
        self.coverage: dict[str, int] = {}

    def get(self, path: str):
        req = urllib.request.Request(self.base + path)
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode())

    def add(self, sev: str, body: str, rid: str, msg: str):
        self.findings.append({"sev": sev, "body": body, "id": rid, "msg": msg})

    # ---------- 快照（id → status，四执行体） ----------

    def snapshot(self) -> dict[str, dict[str, str]]:
        snap: dict[str, dict[str, str]] = {
            "run": {}, "taskrun": {}, "agentflow_run": {}, "invocation": {}}
        for r in self.get("/api/runs"):
            snap["run"][r["runId"]] = r["status"]
        wi = self._work_items()
        for w in wi["items"]:
            if w.get("taskRunId"):
                snap["taskrun"].setdefault(w["taskRunId"], w.get("rawStatus") or "")
        for f in self.get("/api/v2/agentflows")["items"]:
            for rr in self.get(f"/api/v2/agentflows/{f['id']}/runs")["items"]:
                snap["agentflow_run"][rr["id"]] = rr["status"]
        for a in self.get("/api/v2/automations")["items"][:10]:
            inv = self.get(f"/api/v2/automations/{a['id']}/invocations?pageSize=50")
            for it in inv["items"]:
                snap["invocation"][it["id"]] = it["status"]
        return snap

    def _work_items(self) -> dict:
        tz = ZoneInfo("Asia/Shanghai")
        today = datetime.now(tz).date()
        d0 = (today - timedelta(days=7)).isoformat()
        d1 = (today + timedelta(days=1)).isoformat()
        return self.get(f"/api/work-items?dateFrom={d0}&dateTo={d1}&pageSize=200")

    # ---------- A. 禁止转移 ----------

    def check_transitions(self, s1, s2):
        for body, term in TERMINALS.items():
            back = BACKWARD[body]
            for rid, st1 in s1.get(body, {}).items():
                st2 = s2.get(body, {}).get(rid)
                if st2 is None or st2 == st1:
                    continue
                if st1 in term:
                    self.add("P0", body, rid,
                             f"终态回退：{st1} → {st2}（禁止：终态不可变）")
                elif (st1, st2) in back:
                    self.add("P0", body, rid, f"逆向转移：{st1} → {st2}")

    # ---------- B. 不变量 ----------

    def check_enums(self, snap):
        for body, rows in snap.items():
            for rid, st in rows.items():
                if body == "taskrun" and st == "":
                    continue  # work-item 卡未带 rawStatus 时跳过（B5 走详情核）
                if st not in ENUMS[body]:
                    self.add("P0", body, rid, f"status 越出 canonical 枚举：{st!r}")

    def check_runs_terminal_ended(self, snap):
        """B2（Run）：终态 Run 抽样详情，endedAt 必须非空。"""
        terminal_ids = [rid for rid, st in snap["run"].items()
                        if st in RUN_TERMINAL][:20]
        self.coverage["run_terminal_detail"] = len(terminal_ids)
        for rid in terminal_ids:
            d = self.get(f"/api/runs/{rid}")
            if not d.get("endedAt"):
                self.add("P1", "run", rid,
                         f"终态 {d.get('status')} 但 endedAt 为空（F0 真实性缺口）")

    def check_taskruns(self, snap):
        """B2/B4/B5（TaskRun）：work-item 发现 → 详情核时间/血缘/计数。"""
        ids = list(snap["taskrun"])[:30]
        self.coverage["taskrun_detail"] = len(ids)
        seen_retry = 0
        for rid in ids:
            d = self.get(f"/api/analysis-task-runs/{rid}")
            st = d.get("status", "")
            if st not in TASKRUN_ENUM:
                self.add("P0", "taskrun", rid, f"status 越出枚举：{st!r}")
            if st in TASKRUN_TERMINAL and not d.get("endedAt"):
                self.add("P1", "taskrun", rid, f"终态 {st} 但 endedAt 为空")
            retry_of = d.get("retryOfTaskRunId")
            if retry_of:
                seen_retry += 1
                orig = self.get(f"/api/analysis-task-runs/{retry_of}")
                if orig.get("status") not in TASKRUN_TERMINAL:
                    self.add("P0", "taskrun", rid,
                             f"AC-035A 违例：Recovery 指向的原批次 {retry_of} "
                             f"非终态（{orig.get('status')}）")
            total = d.get("total") or 0
            parts = sum(d.get(k) or 0 for k in
                        ("succeeded", "failed", "skipped", "cancelled"))
            if total and parts > total:
                self.add("P1", "taskrun", rid,
                         f"计数越界：分项和 {parts} > total {total}")
            if d.get("totalState") == "exact" and (d.get("processedCount") or 0) > total:
                self.add("P1", "taskrun", rid,
                         f"processedCount {d.get('processedCount')} > total {total}"
                         "（totalState=exact）")
        self.coverage["taskrun_retry_chains"] = seen_retry

    def check_agentflow_runs(self, snap):
        """B7（AgentFlowRun）：终态 run 不得残留活跃节点行。"""
        checked = 0
        for f in self.get("/api/v2/agentflows")["items"]:
            for rr in self.get(f"/api/v2/agentflows/{f['id']}/runs")["items"]:
                if rr["status"] in FLOWRUN_TERMINAL:
                    checked += 1
                    act = [n for n in rr.get("nodes", [])
                           if n.get("status") in NODE_ACTIVE]
                    if act:
                        self.add("P1", "agentflow_run", rr["id"],
                                 f"终态 {rr['status']} 但残留 {len(act)} 个活跃节点行")
                    if not rr.get("ended_at"):
                        self.add("P1", "agentflow_run", rr["id"],
                                 f"终态 {rr['status']} 但 ended_at 为空")
        self.coverage["agentflow_run_terminal"] = checked

    def check_invocations(self, snap):
        """B2/B3（Invocation）：target XOR + 终态时间。"""
        rows = 0
        for a in self.get("/api/v2/automations")["items"][:10]:
            for it in self.get(
                    f"/api/v2/automations/{a['id']}/invocations?pageSize=50")["items"]:
                rows += 1
                st = it["status"]
                tgt = it.get("target")
                if tgt and not (tgt.get("kind") and tgt.get("id")):
                    self.add("P0", "invocation", it["id"],
                             f"target 形状残缺：{tgt}")
                if st in INV_TERMINAL and st == "COMPLETED" and not tgt:
                    self.add("P1", "invocation", it["id"],
                             "COMPLETED 但无 target（执行体反链缺失）")
                if st in ("QUEUED", "RUNNING") or st in INV_TERMINAL:
                    if st not in ("DEDUPED", "REJECTED") and not tgt:
                        self.add("P1", "invocation", it["id"],
                                 f"{st} 但无 target")
                if st in INV_TERMINAL and st not in ("DEDUPED", "REJECTED") \
                        and not it.get("endedAt"):
                    self.add("P1", "invocation", it["id"],
                             f"终态 {st} 但 endedAt 为空")
        self.coverage["invocation"] = rows

    def check_work_items(self):
        """B6：统一状态枚举 + needs_action ⇒ attention.required。"""
        wi = self._work_items()
        items = wi["items"]
        self.coverage["work_item"] = len(items)
        for w in items:
            if w["status"] not in WI_ENUM:
                self.add("P0", "work_item", w["id"],
                         f"统一状态越出 5 态：{w['status']!r}")
            if w["status"] == "needs_action" and not (w.get("attention") or {}).get("required"):
                self.add("P0", "work_item", w["id"],
                         "needs_action 但 attention.required 为假")
            # 可导航性：旧卡 links.primary；新源卡 links.detail 或 automationId/taskRunId
            links = w.get("links") or {}
            navigable = bool(links.get("primary") or links.get("detail")
                             or w.get("taskRunId") or w.get("automationId"))
            if not navigable:
                self.add("P1", "work_item", w["id"], "卡片不可导航（无任何有效链接）")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8120")
    ap.add_argument("--interval", type=float, default=5.0)
    ap.add_argument("--json-out", default="")
    args = ap.parse_args()

    a = Audit(args.base)
    try:
        s1 = a.snapshot()
    except Exception as e:  # noqa: BLE001
        print(f"FATAL: 8120 不可达或响应异常：{e}")
        return 2
    print("快照1 行数：" + json.dumps({k: len(v) for k, v in s1.items()}))
    if args.interval > 0:
        time.sleep(args.interval)
        s2 = a.snapshot()
        a.check_transitions(s1, s2)
    else:
        s2 = s1

    a.check_enums(s2)
    a.check_runs_terminal_ended(s2)
    a.check_taskruns(s2)
    a.check_agentflow_runs(s2)
    a.check_invocations(s2)
    a.check_work_items()

    p0 = [f for f in a.findings if f["sev"] == "P0"]
    p1 = [f for f in a.findings if f["sev"] == "P1"]
    print("\n=== 层3 覆盖率（采样行数） ===")
    for k, v in sorted(a.coverage.items()):
        print(f"  {k}: {v}")
    for body in ("run", "taskrun", "agentflow_run", "invocation"):
        print(f"  snapshot[{body}]: {len(s2.get(body, {}))}")
    print(f"\n=== 层3 发现项：P0={len(p0)} P1={len(p1)} ===")
    for f in a.findings[:60]:
        print(f"  [{f['sev']}][{f['body']}] {f['id'][:12]}… {f['msg']}")
    if len(a.findings) > 60:
        print(f"  …另有 {len(a.findings) - 60} 条")
    if args.json_out:
        with open(args.json_out, "w") as fh:
            json.dump({"coverage": a.coverage,
                       "snapshot_sizes": {k: len(v) for k, v in s2.items()},
                       "findings": a.findings}, fh,
                      ensure_ascii=False, indent=2)
        print(f"\nJSON 已写 {args.json_out}")
    return 1 if p0 else 0


if __name__ == "__main__":
    sys.exit(main())
