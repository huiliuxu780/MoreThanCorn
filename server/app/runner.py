"""Runner — DAG 状态机 + executors + 事件（09-runner-scheduler-worker-design.md，P1）。

设计取舍：
- Queue=PG job_queue（SKIP LOCKED），Worker=后台线程（V1 同进程）。
- 事件落 run_event（sequence 单调）；SSE 以 DB 轮询重放（Last-Event-ID）。
- LLM 默认 mock（model id 任意），真实 provider 经 Model/Provider 表配置后走 OpenAI 兼容协议（P2）。
"""
from __future__ import annotations

import json
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .db import SessionLocal
from .models import (Connection, JobQueue, Model, ModelProvider, NodeRun, Run, RunEvent,
                     Schedule, ToolVersion, Workflow, WorkflowVersion)
from .schemas import WorkflowDefinition
from .validator import validate

REF = re.compile(r"\{\{\s*([A-Za-z0-9_-]+)\.(outputs|error)\.([A-Za-z0-9_.-]+)\s*\}\}")

TERMINAL = {"end", "create-record"}


class _Paused(Exception):
    """07-SDD：wait-review 节点挂起 Run（非失败）。"""


class RunError(Exception):
    pass


# ---------- events ----------

# SDD C-5：平台系统变量（调研 11 §6 实测 14 项）
SYSTEM_VARIABLES = [
    {"name": "tenantId", "label": "租户 ID"}, {"name": "userId", "label": "用户 ID"},
    {"name": "userName", "label": "用户账号名称"}, {"name": "sysTime", "label": "系统时间"},
    {"name": "language", "label": "多语言标识"}, {"name": "memberId", "label": "进线会员账号 ID"},
    {"name": "formId", "label": "网页渠道 ID"}, {"name": "robotCode", "label": "机器人 code"},
    {"name": "nick", "label": "昵称"}, {"name": "serviceId", "label": "服务 ID"},
    {"name": "serviceName", "label": "服务名称"}, {"name": "phoneNum", "label": "电话"},
    {"name": "onlineChannelSource", "label": "在线渠道来源"}, {"name": "initContext", "label": "初始化上下文"},
]

# CONTENT 通道事件（用户可见内容流；其余为 CONTROL 控制面）——SDD C-1
CONTENT_EVENTS = {"llm_delta", "reply_sent"}


_EMIT_LOCK = threading.Lock()  # 08-26 并发执行：sequence 分配串行化


def emit(db: Session, run_id: str, type_: str, node_id: str | None = None,
         node_run_id: str | None = None, payload: dict | None = None,
         channel: str | None = None, span_id: str | None = None,
         parent_span_id: str | None = None, duration_ms: int | None = None,
         tokens: dict | None = None) -> RunEvent:
    with _EMIT_LOCK:
        seq = (db.execute(text("SELECT coalesce(max(sequence),0)+1 FROM run_event WHERE run_id=:r"),
                          {"r": run_id}).scalar())
        ev = RunEvent(run_id=run_id, sequence=int(seq), type=type_, node_id=node_id,
                      node_run_id=node_run_id, payload=payload or {},
                      channel=channel or ("CONTENT" if type_ in CONTENT_EVENTS else "CONTROL"),
                      trace_id=run_id, span_id=span_id or node_run_id,
                      parent_span_id=parent_span_id or run_id, duration_ms=duration_ms, tokens=tokens)
        db.add(ev)
        db.commit()
        return ev


# ---------- variable resolution ----------


def _dig(d: Any, path: str) -> Any:
    cur = d
    for part in path.split("."):
        if isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
    return cur


def resolve_source(src: dict, outputs: dict[str, dict], run_input: dict) -> Any:
    kind = src.get("kind")
    if kind == "fixed":
        v = src.get("value")
        # 08-26 用户反馈：固定值内 {{...}} 模板渲染引用，结果面板展示解析后的真实值
        if isinstance(v, str) and "{{" in v:
            return render_refs(v, outputs, run_input)
        return v
    if kind == "upstream":
        return _dig(outputs.get(src.get("nodeId", ""), {}), src.get("path", "").replace("outputs.", "", 1))
    if kind == "input":
        return run_input.get(src.get("path", ""))
    if kind == "system":
        path = src.get("path", "")
        if path == "now":
            return datetime.now(timezone.utc).isoformat()
        if path == "run_id":
            return ""
        # SDD C-5：14 项系统变量从运行上下文取，缺失返回空串
        return str((run_input.get("__system") or {}).get(path, ""))
    return None


def resolve_bindings(node_inputs: list[dict], outputs: dict[str, dict], run_input: dict) -> dict:
    out: dict[str, Any] = {}
    for b in node_inputs or []:
        out[b["name"]] = resolve_source(b.get("source", {}), outputs, run_input)
    return out


def render_refs(template: str, outputs: dict[str, dict], run_input: dict) -> str:
    def sub(m: re.Match) -> str:
        nid, ns, path = m.group(1), m.group(2), m.group(3)
        if nid == "system":  # SDD C-5：{{system.xxx}}
            if path == "now":
                return datetime.now(timezone.utc).isoformat()
            return str((run_input.get("__system") or {}).get(path, ""))
        if nid in ("n_start", "start"):
            v = _dig(run_input, path)
            if v is None:
                v = run_input.get(path)
        else:
            base = outputs.get(nid, {})
            # 07-SDD：{{nodeId.error.x}} 引用失败路由输出
            v = _dig(base.get("error", {}) if ns == "error" else base, path)
        return "" if v is None else str(v)
    return REF.sub(sub, template or "")


# ---------- executors ----------


def start_form_fields(db: Session, defn) -> list[dict] | None:
    """07-SDD form：开始节点字段解析 = formSnapshot（发布冻结）> formId 活引用 > None（存量回退）。"""
    from .models import Form
    start = next((n for n in defn.graph.nodes if n.type == "input"), None)
    cfg = (start.config if start else {}) or {}
    snap = cfg.get("formSnapshot")
    if isinstance(snap, list):
        return snap
    fid = cfg.get("formId")
    if fid:
        f = db.get(Form, fid)
        return (f.fields or []) if f else None
    return None


def exec_input(node, ctx) -> dict:
    out = {**ctx.run_input}
    for f in getattr(ctx, "start_fields", None) or []:
        k = f.get("key") or f.get("name")
        if out.get(k) in (None, "") and f.get("default") not in (None, ""):
            out[k] = f["default"]
    return out


def exec_llm(node, ctx) -> dict:
    cfg = node.get("config") or {}
    model = (cfg.get("modelRef") or {}).get("modelId", "mock")
    inputs = resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)
    # 07-SDD §4.3：批处理模式——遍历批量列表变量，聚合 outputList
    if cfg.get("batchMode") == "batch":
        rows = _resolve_ref(cfg.get("batchListRef") or "", ctx) or []
        if not isinstance(rows, list):
            rows = [rows]
        max_b = int(cfg.get("maxBatches") or 100)
        out_list: list[dict] = []
        for item in rows[:max_b]:
            p = render_refs(cfg.get("prompt", ""), ctx.outputs, ctx.run_input)
            p += f"\n当前批处理项（JSON）：{json.dumps(item, ensure_ascii=False)}"
            answer, _tokens = _call_model(ctx.db, model, p)
            out_list.append({"output": answer, "answer": answer})
        agg = json.dumps(out_list, ensure_ascii=False)
        return {"outputList": out_list, "output": agg, "thought": "", "answer": agg}
    prompt = render_refs(cfg.get("prompt", ""), ctx.outputs, ctx.run_input)
    # 07-SDD §4.3：systemPrompt 独立且优先级高于提示词
    if cfg.get("systemPrompt"):
        prompt = render_refs(cfg["systemPrompt"], ctx.outputs, ctx.run_input) + "\n\n" + prompt
    # R1 修复：outputFormat 真消费（此前表单配置被丢弃）
    if cfg.get("outputFormat") == "JSON":
        prompt += "\n请严格以单个 JSON 对象形式输出最终答案，不要包含其他说明文字。"
    t0 = time.time()
    answer, tokens = _call_model(ctx.db, model, prompt)
    ctx.last_tokens = tokens or {}
    latency = int((time.time() - t0) * 1000)
    ctx.call("model", model, {"prompt": prompt, "inputs": inputs},
             {"output": answer}, latency, tokens)
    out = {"output": answer, "thought": "", "answer": answer}
    # 08-26 用户反馈：JSON 模式自定义输出字段解析进输出，供下游 {{node.outputs.x}} 引用
    if cfg.get("outputFormat") == "JSON":
        try:
            parsed = json.loads(answer)
            if isinstance(parsed, dict):
                out.update(parsed)
        except Exception:  # noqa: BLE001 —— 解析失败保留原始 output
            pass
    return out


def _call_model(db: Session, model_id: str, prompt: str) -> tuple[str, dict]:
    """真实 LLM 联调：OpenAI 兼容协议。
    优先级：env WF_LLM_BASE_URL/WF_LLM_API_KEY > Model/Provider 表配置；无 http base 时 mock 回落。"""
    import os
    base = os.environ.get("WF_LLM_BASE_URL", "")
    secret = os.environ.get("WF_LLM_API_KEY", "")
    if not base:
        for m in db.execute(select(Model).where(Model.model_key == model_id)).scalars().all():
            prov = db.get(ModelProvider, m.provider_id)
            if prov and prov.base_url.startswith(("http://", "https://")):
                base = prov.base_url
                if not secret and prov.auth_connection_id:
                    conn = db.get(Connection, prov.auth_connection_id)
                    if conn:
                        secret = _decrypt(conn.secret_ref)
                break
    if not base or not base.startswith(("http://", "https://")):
        from .config import is_production
        if is_production():
            # 09 §12 / M-02：生产缺真实 Provider 必须失败，不得假成功
            raise RunError("MODEL_UNAVAILABLE：生产环境未配置真实模型 Provider（禁止 mock）")
        return f"[mock:{model_id}] 已处理：{prompt[:120]}", {
            "promptTokens": len(prompt) // 2, "completionTokens": 60}
    # 09 P0（审计反例 4）：模型调用出站统一过 Egress（生产拦截私网/元数据）
    from .egress import EgressError, enforce_egress
    try:
        enforce_egress(base)
    except EgressError as exc:
        raise RunError(str(exc))
    with httpx.Client(timeout=60) as client:
        r = client.post(f"{base.rstrip('/')}/chat/completions",
                        headers={"Authorization": f"Bearer {secret}"} if secret else {},
                        json={"model": model_id,
                              "messages": [{"role": "user", "content": prompt}]})
        r.raise_for_status()
        j = r.json()
    usage = j.get("usage", {}) or {}
    return (j["choices"][0]["message"]["content"],
            {"promptTokens": usage.get("prompt_tokens", 0),
             "completionTokens": usage.get("completion_tokens", 0)})


def _decrypt(ref: str) -> str:
    """09 P0-11：密钥解密（失败关闭，任何环境）。

    - 形如 Fernet 密文：必须有合法 WF_SECRET_KEY 成功解密，否则抛错
      （绝不回落明文/密文；无密钥或密钥非法都失败）。
    - 非密文（历史明文）：生产理论上不应存在（_encrypt 恒加密）；原样返回仅为兼容遗留。
    """
    import os
    key = os.environ.get("WF_SECRET_KEY")
    if isinstance(ref, str) and ref.startswith("gAAAAA"):  # Fernet 密文特征前缀
        if not key:
            raise RuntimeError("WF_SECRET_KEY 缺失：无法解密 Secret（禁止明文模式）")
        from cryptography.fernet import Fernet
        try:
            return Fernet(key.encode()).decrypt(ref.encode()).decode()
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"Secret 解密失败（密钥非法或密文损坏）：{exc}")
    return ref  # 非密文：历史明文（生产由 _encrypt 恒加密保证不会出现）


# ---------- schedule（P2） ----------

def compute_next(cron_expr: str, tz: str) -> datetime:
    from croniter import croniter
    from zoneinfo import ZoneInfo
    try:
        zone = ZoneInfo(tz)
    except Exception:  # noqa: BLE001
        zone = ZoneInfo("Asia/Shanghai")
    now = datetime.now(zone)
    return croniter(cron_expr, now).get_next(datetime).astimezone(timezone.utc)


def schedule_tick() -> int:
    db = SessionLocal()
    fired = 0
    try:
        now = datetime.now(timezone.utc)
        due = db.execute(select(Schedule).where(Schedule.enabled == True)).scalars().all()  # noqa: E712
        for sch in due:
            if sch.next_run_at is None:
                sch.next_run_at = compute_next(sch.cron_expr, sch.timezone)
                db.commit()
                continue
            if sch.next_run_at > now:
                continue
            if sch.valid_to and now > sch.valid_to.replace(tzinfo=timezone.utc):
                sch.enabled = False
                db.commit()
                continue
            try:
                if sch.task_id:
                    # 09 P0-B2/B3：调度→TaskRun 新链路；唯一业务键防重复触发（INV-11）；
                    # paused/不可运行任务失败关闭但不计调度故障。
                    from .task_runner import TaskStartError, start_task_run
                    fire_slot = sch.next_run_at.isoformat() if sch.next_run_at else now.isoformat()
                    try:
                        _tr, _res = start_task_run(db, sch.task_id, trigger="schedule",
                                                   schedule_fire_key=f"{sch.id}:{fire_slot}")
                        fired += 1
                    except TaskStartError as exc:
                        if exc.status_code == 409:  # paused（INV-10）：静默跳过
                            pass
                        else:
                            raise RunError(str(exc))
                else:
                    create_run(db, sch.workflow_id, "schedule",
                               {"window": {"start": (now - __import__("datetime").timedelta(minutes=5)).isoformat(),
                                          "end": now.isoformat()}},
                               pinned_version_id=sch.pinned_version_id)
                    fired += 1
                sch.last_ran_at = now
                sch.failed_count = 0
            except RunError:
                sch.failed_count = (sch.failed_count or 0) + 1
                if sch.failed_count >= 5:
                    sch.enabled = False
            sch.next_run_at = compute_next(sch.cron_expr, sch.timezone)
            db.commit()
    finally:
        db.close()
    return fired


def scheduler_loop(stop: threading.Event) -> None:
    while not stop.is_set():
        try:
            schedule_tick()
        except Exception:  # noqa: BLE001
            pass
        stop.wait(10)


def exec_condition(node, ctx) -> dict:
    """条件判断（规则构建器，SDD design-condition-rule-builder）。

    每分支含 conditions[] 与 logic(AND/OR)；自上而下命中即走，兜底 else。
    兼容旧格式：分支顶层 variable/operator/value 视为单条件。
    """
    inputs = resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)
    branches = (node.get("config") or {}).get("branches", []) or []
    selected = "else"
    for b in branches:
        conds = b.get("conditions")
        if conds is None:
            if not (b.get("variable") or b.get("operator")):
                continue  # 空分支不参与匹配
            conds = [{"variable": b.get("variable"), "operator": b.get("operator"),
                      "valueMode": "LITERAL", "value": b.get("value")}]
        if not conds:
            continue
        results = [_cond_ok(c, inputs, ctx) for c in conds]
        hit = all(results) if (b.get("logic") or "AND").upper() != "OR" else any(results)
        if hit:
            selected = b.get("handle") or "yes"
            break
    return {"selected": selected}


def _cond_ok(cond: dict, inputs: dict, ctx) -> bool:
    var = (cond.get("variable") or "").strip()
    m = REF.match(var) if var else None
    val = None
    if m:
        val = _dig(ctx.outputs.get(m.group(1), {}), m.group(3))
    elif var:
        val = inputs.get(var) or ctx.run_input.get(var)
    if (cond.get("valueMode") or "LITERAL").upper() == "VARIABLE":
        ref = (cond.get("valueRef") or "").strip()
        rm = REF.match(ref) if ref else None
        expect_raw = _dig(ctx.outputs.get(rm.group(1), {}), rm.group(3)) if rm else None
    else:
        expect_raw = cond.get("value")
    return _branch_ok(cond.get("operator"), val, expect_raw)


def _branch_ok(op: str | None, val: Any, expect_raw: Any) -> bool:
    """条件运算符（SDD A-06 + 规则构建器扩展）：
    String 八项（含 starts_with/ends_with）、数值六项（含 gte/lte）、empty/not_empty；
    数组 contains 按成员匹配；布尔 eq 大小写不敏感；无运算符时按真值。"""
    expect = str(expect_raw if expect_raw is not None else "")
    if op in (None, ""):
        return bool(val)
    if op == "empty":
        return val is None or val in ("", [], {})
    if op == "not_empty":
        return not (val is None or val in ("", [], {}))
    # 07-SDD §4.4：操作符族扩展
    if op == "in":
        return str(val if val is not None else "") in [x.strip() for x in expect.split(",") if x.strip()]
    if op == "not_in":
        return str(val if val is not None else "") not in [x.strip() for x in expect.split(",") if x.strip()]
    if op in ("exists", "not_exists"):
        exists = val is not None
        return exists if op == "exists" else not exists
    if op in ("is_null", "is_not_null"):
        is_null = val is None or val == ""
        return is_null if op == "is_null" else not is_null
    if op in ("gt", "lt", "gte", "lte"):
        try:
            lv, rv = float(val), float(expect_raw)
        except (TypeError, ValueError):
            return False
        return {"gt": lv > rv, "lt": lv < rv, "gte": lv >= rv, "lte": lv <= rv}[op]
    if op in ("contains", "not_contains") and isinstance(val, (list, tuple, set)):
        hit = any(str(x) == expect for x in val)
        return hit if op == "contains" else not hit
    sv = str(val if val is not None else "")
    if isinstance(val, bool):
        sv = sv.lower()
        expect = expect.lower()
    if op == "eq":
        return sv == expect
    if op == "neq":
        return sv != expect
    if op == "contains":
        return expect in sv
    if op == "not_contains":
        return expect not in sv
    if op == "starts_with":
        return sv.startswith(expect)
    if op == "ends_with":
        return sv.endswith(expect)
    return False


def exec_transform(node, ctx) -> dict:
    cfg = node.get("config", {})
    rendered = render_refs(cfg.get("template", "") or "{{n_start.outputs.userQuery}}", ctx.outputs, ctx.run_input)
    return {"output": rendered}


def exec_tool(node, ctx) -> dict:
    cfg = node.get("config", {})
    tv_id = cfg.get("toolVersionId")
    if not tv_id:
        raise RunError("toolVersionId missing")
    tv = ctx.db.get(ToolVersion, tv_id)
    if not tv:
        raise RunError(f"tool version {tv_id} not found")
    inputs = resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)
    spec = tv.spec or {}
    t0 = time.time()
    if spec.get("kind") == "echo" or not spec.get("request"):
        out = {"result": json.dumps(inputs, ensure_ascii=False)[:500]}
    else:
        req = spec["request"]
        url = render_refs(req.get("url", ""), ctx.outputs, ctx.run_input)
        # 09 P0-11：统一 Egress Policy（DNS/IPv6/元数据/私网全拦；禁自动重定向）
        from .egress import EgressError, assert_safe_url
        try:
            assert_safe_url(url)
        except EgressError as exc:
            raise RunError(str(exc)) from exc
        with httpx.Client(timeout=10, follow_redirects=False) as client:
            r = client.request(req.get("method", "GET"), url, json=inputs if req.get("method", "GET") != "GET" else None)
        out = {"status": r.status_code, "body": r.text[:2000]}
    ctx.call("tool", tv.tool_id, {"toolVersionId": tv_id, "inputs": inputs}, out, int((time.time() - t0) * 1000), {})
    return out


def exec_end(node, ctx) -> dict:
    return resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)


def exec_create_record(node, ctx) -> dict:
    from .models import Evidence, QualityResult
    inputs = resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)
    out = inputs or dict(ctx.outputs)
    # 09 P0-06/INV-06：任务主链的输出必须通过 QualityEvaluation Schema 本地校验；
    # 非法输出 → Run 失败，不得创建正式 QualityResult（repair 走节点重试策略）。
    if getattr(ctx.run, "task_run_id", None):
        # 09 P0-08（修复轮）：任务主链结果追踪字段必须非空（失败关闭，纵深防御）
        if not getattr(ctx.run, "rule_version_id", None):
            raise RunError("MISSING_RULE_VERSION：任务主链 Run 缺少冻结规则版本")
        if not getattr(ctx.run, "definition_version_id", None):
            raise RunError("MISSING_DEFINITION_VERSION：任务主链 Run 缺少数据定义版本")
        from .output_schema import validate_evaluation
        from .models import QualityOutputSchema
        os_id = ctx.run_input.get("__outputSchemaVersionId")
        schema_row = ctx.db.get(QualityOutputSchema, os_id) if os_id else None
        ok, errs = validate_evaluation(out if isinstance(out, dict) else {"value": out},
                                       schema_row.schema_ if schema_row else None)
        if not ok:
            raise RunError("OUTPUT_SCHEMA_INVALID: " + "; ".join(errs[:3]))
    qr = QualityResult(run_id=ctx.run.id, interaction_ref=str(ctx.run_input.get("interactionId", "")),
                       structured_output=out if isinstance(out, dict) else {"value": out},
                       transcript=out.get("transcript") if isinstance(out, dict) and isinstance(out.get("transcript"), list) else [],
                       score=out.get("score") if isinstance(out, dict) else None,
                       risk=out.get("risk") if isinstance(out, dict) else None,
                       critical=bool(out.get("critical")) if isinstance(out, dict) else False,
                       issue_count=int(out.get("issueCount") or 0) if isinstance(out, dict) else 0,
                       issue_summary=out.get("issueSummary") if isinstance(out, dict) else None,
                       # 09 §9.6/P0-08：追踪链（版本/批次字段由 TaskRunner 在 Run 上冻结后继承）
                       workflow_version_id=ctx.run.workflow_version_id,
                       task_run_id=ctx.run.task_run_id, task_id=ctx.run.task_id,
                       task_version_id=ctx.run.task_version_id,
                       output_schema_version_id=(ctx.run_input.get("__outputSchemaVersionId") or None))
    ctx.db.add(qr)
    ctx.db.commit()
    # 07-SDD V1.5：config.formId 存在 → 写 FormRecord（mapping 优先，field.binding.workflow_output 兜底）
    cfg = node.get("config") or {}
    fid = cfg.get("formId")
    if fid:
        from .models import Form, FormRecord, FormVersion
        form = ctx.db.get(Form, fid)
        if form:
            ver_no = cfg.get("formVersion")
            fields = form.fields or []
            if ver_no:
                ver = ctx.db.query(FormVersion).filter_by(form_id=fid, version_no=int(ver_no)).first()
                if ver:
                    fields = ver.fields or []
            else:
                lv = ctx.db.query(FormVersion).filter_by(form_id=fid).order_by(FormVersion.version_no.desc()).first()
                ver_no = lv.version_no if lv else 0
            values = {}
            mapping = cfg.get("mapping") or {}
            for f in fields:
                key = f.get("key")
                ref = mapping.get(key)
                if not ref and (f.get("binding") or {}).get("type") == "workflow_output":
                    ref = (f.get("binding") or {}).get("path")
                if ref:
                    m = re.match(r"\{\{\s*([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_.-]+)\s*\}\}$", str(ref).strip())
                    values[key] = _dig(ctx.outputs.get(m.group(1), {}), m.group(2)) if m else ref
                elif isinstance(out, dict) and key in out:
                    values[key] = out[key]
            ctx.db.add(FormRecord(form_id=fid, form_version=int(ver_no or 0), values=values,
                                  created_by="workflow", run_id=ctx.run.id))
            ctx.db.commit()
    from .routers.business import apply_rules_to_result
    # 09 P0-07：Run 携带冻结 RuleVersion 时用它；否则取最近发布版本
    apply_rules_to_result(ctx.db, qr, getattr(ctx.run, "rule_version_id", None))
    # 09 INV-08：冻结 AI 原始结果（结构化输出+派生值），人工复核不得改写
    qr.ai_result = {"structuredOutput": qr.structured_output, "score": qr.score,
                    "risk": qr.risk, "critical": qr.critical,
                    "issueCount": qr.issue_count, "issueSummary": qr.issue_summary,
                    "ruleVersionId": qr.rule_version_id}
    ctx.db.commit()
    evs = out.get("evidence", []) if isinstance(out, dict) else []
    for e in evs if isinstance(evs, list) else []:
        if isinstance(e, dict):
            ctx.db.add(Evidence(result_id=qr.id, kind=str(e.get("kind", "field")),
                                locator=e.get("locator") if isinstance(e.get("locator"), dict) else {},
                                text=str(e.get("text", "")), source_ref=str(e.get("sourceRef", ""))))
    ctx.db.commit()
    return {"qualityResultId": qr.id, "evidenceCount": len(evs) if isinstance(evs, list) else 0}


def exec_workflow_exec(node, ctx) -> dict:
    cfg = node.get("config") or {}
    code = cfg.get("workflowCode")
    # 07-SDD §4.12：动态模式——workflowCode 来自输入绑定（接路由输出）
    if (cfg.get("mode") or "fixed") == "dynamic":
        inputs = resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)
        code = inputs.get("workflowCode") or code
    if not code:
        raise RunError("workflowCode missing")
    sub = create_run(ctx.db, code, "manual", ctx.run_input, enqueue=False)
    execute_run(sub.id, call_chain=list(ctx.call_chain))
    from .db import SessionLocal as _SL
    fresh = _SL()
    try:
        r = fresh.get(Run, sub.id)
        status = r.status
        err = r.error
    finally:
        fresh.close()
    class _R:  # 轻量包装
        pass
    r = _R(); r.status = status; r.error = err; r.output = None
    if status == "succeeded":
        fresh = _SL()
        try:
            r.output = fresh.get(Run, sub.id).output
        finally:
            fresh.close()
    if r.status != "succeeded":
        raise RunError(f"sub workflow failed: {(r.error or {}).get('message', r.status)}")
    return r.output or {}


def exec_knowledge_retrieval(node, ctx) -> dict:
    from .resource_tests import search_knowledge
    cfg = node.get("config", {})
    query = render_refs(cfg.get("query", ""), ctx.outputs, ctx.run_input)
    top_k = int(cfg.get("topK", 5) or 5)
    t0 = time.time()
    slices = search_knowledge(ctx.db, cfg.get("knowledgeSourceId"), query, top_k)
    latency = int((time.time() - t0) * 1000)
    ctx.call("knowledge", cfg.get("knowledgeSourceId"), {"query": query, "topK": top_k},
             {"slices": len(slices)}, latency, {})
    return {"slices": json.dumps(slices, ensure_ascii=False),
            "sources": json.dumps([s.get("text", "")[:80] for s in slices], ensure_ascii=False)}


def exec_mcp_call(node, ctx) -> dict:
    from .resource_tests import mcp_call_tool
    cfg = node.get("config", {})
    inputs = resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)
    args = {**(cfg.get("args") or {}), **inputs}
    t0 = time.time()
    out = mcp_call_tool(ctx.db, cfg.get("mcpServerId"), cfg.get("toolName"), args)
    ctx.call("mcp", cfg.get("mcpServerId"), {"tool": cfg.get("toolName"), "args": args},
             out, int((time.time() - t0) * 1000), {})
    return {"result": json.dumps(out, ensure_ascii=False)[:2000]}


def exec_notification(node, ctx) -> dict:
    """通知/中途回复节点（SDD A-05）：发事件但不终止流程——区别于 end。"""
    cfg = node.get("config") or {}
    message = render_refs(cfg.get("message", ""), ctx.outputs, ctx.run_input)
    emit(ctx.db, ctx.run.id, "notification_sent", node_id=node.get("id"),
         payload={"message": (message or "")[:2000]})
    return {"sent": True}


# ---------- Phase C 新增节点（SDD 03 §C-4） ----------

def exec_reply(node, ctx) -> dict:
    """对话回复：CONTENT 通道发事件，不终止流程（调研 11 §3.17）。"""
    cfg = node.get("config") or {}
    content = render_refs(cfg.get("content", ""), ctx.outputs, ctx.run_input)
    emit(ctx.db, ctx.run.id, "reply_sent", node_id=node.get("id"),
         payload={"content": (content or "")[:2000]})
    return {"sent": True}


def exec_memory_variable(node, ctx) -> dict:
    """记忆变量节点：读写持久化记忆（键空间=agent 或 workflow；写入校验已声明键）。"""
    from .models import Agent, MemoryRecord
    cfg = node.get("config") or {}
    mode = cfg.get("mode", "read")
    scope = f"agent:{ctx.run.agent_id}" if ctx.run.agent_id else f"wf:{ctx.run.workflow_id}"
    declared = None
    if ctx.run.agent_id:
        a = ctx.db.get(Agent, ctx.run.agent_id)
        if a:
            declared = {m.get("name") for m in ((a.config or {}).get("memoriesSchema") or [])}
    if mode == "write":
        inputs = resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)
        for key, val in inputs.items():
            if declared is not None and key not in declared:
                raise RunError(f"记忆变量 {key} 未在记忆 Schema 中声明")
            rec = ctx.db.execute(select(MemoryRecord).where(
                MemoryRecord.scope == scope, MemoryRecord.key == key)).scalars().first()
            if rec:
                rec.value = "" if val is None else str(val)
            else:
                ctx.db.add(MemoryRecord(scope=scope, key=key, value="" if val is None else str(val)))
        ctx.db.commit()
        emit(ctx.db, ctx.run.id, "memory_write", node_id=node.get("id"),
             payload={"scope": scope, "keys": list(inputs.keys())})
        return {"isSuccess": True}
    keys = cfg.get("keys") or []
    out: dict[str, Any] = {}
    for key in keys:
        rec = ctx.db.execute(select(MemoryRecord).where(
            MemoryRecord.scope == scope, MemoryRecord.key == key)).scalars().first()
        out[key] = rec.value if rec else ""
    emit(ctx.db, ctx.run.id, "memory_read", node_id=node.get("id"),
         payload={"scope": scope, "keys": keys})
    return out


def _route_workflow(db: Session, flows: list, query: str, model: str = "qwen-plus"):
    try:
        from .agent_runtime import _resolve_base_secret
        base, _s = _resolve_base_secret(db, model)
    except Exception:  # noqa: BLE001
        base = ""
    if not base or not base.startswith(("http://", "https://")):
        from .config import is_production
        if is_production():
            raise RunError("MODEL_UNAVAILABLE：生产环境工作流路由不可用（禁止 mock 首项）")
        return flows[0]  # 非生产确定性回落：取首个候选
    listing = "\n".join(f"{i + 1}. {w.name}：{(w.description or '').strip()[:100]}" for i, w in enumerate(flows))
    try:
        answer, _t = _call_model(db, model,
                                 f"从候选工作流中为问题选择最合适的一个，只输出序号，没有合适的输出 NONE。\n{listing}\n\n问题：{query[:500]}")
    except Exception:  # noqa: BLE001
        return flows[0]
    digits = "".join(ch for ch in (answer or "") if ch.isdigit())
    if digits and 1 <= int(digits) <= len(flows):
        return flows[int(digits) - 1]
    return None


def exec_workflow_select(node, ctx) -> dict:
    """工作流选择：候选中语义路由；未命中走 miss 分支（调研 11 §3.6）。"""
    cfg = node.get("config") or {}
    candidates = cfg.get("candidates") or []
    inputs = resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)
    query = str(inputs.get("query") or ctx.run_input.get("userQuery") or "")
    flows = [w for w in (ctx.db.get(Workflow, wid) for wid in candidates) if w]
    if not flows:
        raise RunError("工作流选择节点未配置有效候选工作流")
    chosen = _route_workflow(ctx.db, flows, query, cfg.get("routingModel") or "qwen-plus")
    if chosen is None:
        return {"selected": "miss", "workflowCode": "", "workflowName": "", "workflowDesc": ""}
    return {"selected": chosen.id, "workflowCode": chosen.id,
            "workflowName": chosen.name, "workflowDesc": chosen.description or ""}


def exec_workflow_fixed(node, ctx) -> dict:
    """固定工作流节点：绑定已选工作流，子运行执行（调研 11 §3.15）。

    07-SDD §4.13：inputMapping 覆盖 run_input；versionPolicy=pinned 时钉版本。"""
    cfg = node.get("config") or {}
    wfid = cfg.get("workflowId")
    if not wfid:
        raise RunError("workflowId missing")
    run_input = dict(ctx.run_input)
    for k, ref in (cfg.get("inputMapping") or {}).items():
        if not ref:
            continue
        m = re.match(r"\{\{\s*([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_.-]+)\s*\}\}$", str(ref).strip())
        run_input[k] = _dig(ctx.outputs.get(m.group(1), {}), m.group(2)) if m else ref
    version_id = cfg.get("pinnedVersionId") if (cfg.get("versionPolicy") or "latest") == "pinned" else None
    sub = create_run(ctx.db, wfid, "manual", run_input, enqueue=False, version_id=version_id)
    execute_run(sub.id, call_chain=list(ctx.call_chain))
    # 独立会话读取，避免当前会话的过期缓存（execute_run 在自己的会话中提交）
    from .db import SessionLocal as _SL
    fresh = _SL()
    try:
        r = fresh.get(Run, sub.id)
        status, err, output = r.status, r.error, r.output
    finally:
        fresh.close()
    if status != "succeeded":
        raise RunError(f"固定工作流执行失败：{(err or {}).get('message', status)}")
    return output or {}


def exec_code_write(node, ctx) -> dict:
    """代码编写：子进程沙箱执行 Python（超时 10s；args.params 传入；调研 11 §3.18）。

    09 P0-11：Code Node 默认禁用（含生产）——真沙箱落地前仅显式
    WF_CODE_NODE=on 可开启（开发/评测用途，验收报告登记）。"""
    from .config import code_node_enabled
    if not code_node_enabled():
        raise RunError("CODE_NODE_DISABLED：Code Node 默认禁用（09-SDD P0-11）")
    import subprocess
    import tempfile
    cfg = node.get("config") or {}
    code = cfg.get("code") or "def main(args):\n    return {\"output\": args.params.get(\"input\", \"\")}\n"
    inputs = resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)
    program = ("import json, sys\n"
               "__in = json.loads(sys.stdin.read())\n"
               "class Args:\n    pass\n"
               "args = Args()\n"
               "args.params = __in.get('params', {})\n"
               + code + "\n"
               "__out = main(args)\n"
               "print(json.dumps(__out if isinstance(__out, dict) else {'result': __out}, ensure_ascii=False))\n")
    tmp = None
    t0 = time.time()
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
            f.write(program)
            tmp = f.name
        proc = subprocess.run(["python3", tmp], input=json.dumps({"params": inputs}, ensure_ascii=False),
                              capture_output=True, text=True, timeout=10)
    except subprocess.TimeoutExpired:
        raise RunError("代码执行超时（>10s）")
    finally:
        if tmp:
            try:
                import os as _os
                _os.unlink(tmp)
            except Exception:  # noqa: BLE001
                pass
    if proc.returncode != 0:
        raise RunError(f"代码执行失败：{(proc.stderr or '').strip()[:500]}")
    ctx.call("code", node.get("id"), {"inputs": inputs}, {"stdout": proc.stdout[:500]},
             int((time.time() - t0) * 1000), {})
    try:
        out = json.loads(proc.stdout.strip().splitlines()[-1]) if proc.stdout.strip() else {}
    except (json.JSONDecodeError, IndexError):
        out = {"output": proc.stdout.strip()[:2000]}
    return out if isinstance(out, dict) else {"result": out}


def _llm_base(db: Session) -> str:
    try:
        from .agent_runtime import _resolve_base_secret
        base, _s = _resolve_base_secret(db, "qwen-plus")
        return base or ""
    except Exception:  # noqa: BLE001
        return ""


def exec_decision_class(node, ctx) -> dict:
    """决策分类：LLM 分类 + 多分支（mock：第一类；调研 11 §3.10）。"""
    cfg = node.get("config") or {}
    branches = cfg.get("branches") or []
    if not branches:
        raise RunError("决策分类未配置分类项")
    inputs = resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)
    # R1 修复：query 以输入绑定为准（此前读 schema 中不存在的 cfg.query）
    query = str(inputs.get("query") or render_refs(cfg.get("query", ""), ctx.outputs, ctx.run_input)
                or ctx.run_input.get("userQuery") or "")
    listing = "\n".join(f"{i + 1}. {b.get('title', '')}：{(b.get('description') or '')[:100]}"
                        for i, b in enumerate(branches))
    chosen_idx = None
    base = _llm_base(ctx.db)
    if base.startswith(("http://", "https://")):
        try:
            answer, _t = _call_model(ctx.db, "qwen-plus",
                                     f"把问题分到最合适的类别，只输出序号，都不合适输出 0。\n{listing}\n\n问题：{query[:500]}")
            digits = "".join(ch for ch in (answer or "") if ch.isdigit())
            if digits and 1 <= int(digits) <= len(branches):
                chosen_idx = int(digits) - 1
        except Exception:  # noqa: BLE001
            chosen_idx = None
    else:
        from .config import is_production
        if is_production():
            raise RunError("MODEL_UNAVAILABLE：生产环境决策分类不可用（禁止固定第一类）")
        chosen_idx = 0  # 非生产确定性回落：第一类
    if chosen_idx is None:
        return {"selected": "else", "classificationTitle": "其他", "classificationId": "other"}
    b = branches[chosen_idx]
    handle = b.get("handle") or f"c{chosen_idx}"
    return {"selected": handle, "classificationTitle": b.get("title", ""),
            "classificationId": str(chosen_idx)}


def exec_query_rewrite(node, ctx) -> dict:
    """Query 改写：LLM 改写为查询列表（默认策略/自定义；调研 11 §3.11）。"""
    cfg = node.get("config") or {}
    inputs = resolve_bindings(node.get("inputs", []), ctx.outputs, ctx.run_input)
    query = str(render_refs(cfg.get("template", ""), ctx.outputs, ctx.run_input)
                or inputs.get("query") or ctx.run_input.get("userQuery") or "")
    chat_history = str(inputs.get("chatHistory") or ctx.run_input.get("chatHistory") or "")
    base = _llm_base(ctx.db)
    if base.startswith(("http://", "https://")) and cfg.get("strategy") == "custom":
        try:
            answer, _t = _call_model(ctx.db, "qwen-plus",
                                     f"把用户问题改写为最多3个检索查询，每行一个。\n历史：{chat_history[:300]}\n问题：{query[:500]}")
            lines = [ln.strip() for ln in (answer or "").splitlines() if ln.strip()]
            if lines:
                return {"queryList": lines[:3]}
        except Exception:  # noqa: BLE001
            pass
    return {"queryList": [query] if query else []}


# ---------- 07-SDD 控制流执行器 ----------


def _resolve_ref(ref: str, ctx) -> Any:
    m = re.match(r"\{\{\s*([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_.-]+)\s*\}\}$", (ref or "").strip())
    if not m:
        return None
    return _dig(ctx.outputs.get(m.group(1), {}), m.group(2))


def _break_hit(conds: list[dict], iter_outputs: dict[str, dict]) -> bool:
    for c in conds or []:
        v = _resolve_ref(c.get("ref") or "", _DictCtx(iter_outputs))
        expect = c.get("value")
        op = c.get("op") or "eq"
        hit = (v == expect) if op == "eq" else (v != expect) if op == "neq" else False
        if hit:
            return True
    return False


class _DictCtx:
    def __init__(self, outputs):
        self.outputs = outputs


def exec_loop(node, ctx) -> dict:
    """07-SDD §4.16：容器化循环——body 子图逐轮执行，输出聚合。"""
    cfg = node.get("config") or {}
    rows = _resolve_ref(cfg.get("iteratorRef") or "", ctx)
    if rows is None:
        rows = []
    if not isinstance(rows, list):
        rows = [rows]
    item_var = cfg.get("itemVar") or "item"
    idx_var = cfg.get("indexVar") or "index"
    max_iter = int(cfg.get("maxIterations") or 1000)
    err_mode = cfg.get("errorHandleMode") or "terminated"
    order = (ctx.loop_orders or {}).get(node["id"], [])
    loop_vars = {lv.get("name"): lv.get("initial") for lv in (cfg.get("loopVariables") or []) if lv.get("name")}
    output_list: list[Any] = []
    success = fail = 0
    for i, item in enumerate(rows[:max_iter]):
        iter_outputs = dict(ctx.outputs)
        iter_outputs[node["id"]] = {item_var: item, idx_var: i, **loop_vars}
        iter_ctx = Ctx(ctx.db, ctx.run, iter_outputs)
        iter_ctx.call_chain = getattr(ctx, "call_chain", [])
        iter_ctx.frozen_agent_versions = getattr(ctx, "frozen_agent_versions", {})
        iter_ctx.by_id = ctx.by_id
        iter_ctx.loop_bodies = {}
        iter_ctx.loop_orders = {}
        last_out: dict = {}
        try:
            for bn in order:
                bnode = ctx.by_id[bn]
                fn = EXECUTORS.get(bnode["type"]) or _agent_family_executor(bnode["type"])
                if not fn:
                    raise RunError(f"no executor for {bnode['type']}")
                last_out = fn(bnode, iter_ctx) or {}
                iter_outputs[bn] = last_out
                nr = NodeRun(run_id=ctx.run.id, node_id=bn, node_type=bnode["type"], status="success",
                             attempt=i + 1,
                             output=last_out, started_at=datetime.now(timezone.utc), ended_at=datetime.now(timezone.utc))
                ctx.db.add(nr)
                ctx.db.commit()
                emit(ctx.db, ctx.run.id, "loop_iter", bn, nr.id, {"iter": i, "output": last_out})
            success += 1
        except Exception as exc:  # noqa: BLE001
            fail += 1
            emit(ctx.db, ctx.run.id, "loop_iter_failed", node["id"], None, {"iter": i, "error": str(exc)})
            if err_mode == "terminated":
                raise
            if err_mode == "remove_abnormal":
                continue
        output_list.append(last_out)
        if _break_hit(cfg.get("breakConditions") or [], iter_outputs):
            break
    return {"outputList": output_list, "successCount": success, "failCount": fail, **loop_vars}


def exec_wait_review(node, ctx) -> dict:
    """07-SDD §4.17：暂停-恢复原语。无 resume 载荷时挂起 Run。"""
    cfg = node.get("config") or {}
    resume = getattr(ctx, "resume", None)
    if resume and resume.get("node_id") == node.get("id"):
        return {"decision": resume.get("action") or "pass", "comment": resume.get("comment") or "",
                "waitedMs": resume.get("waitedMs") or 0, **(resume.get("values") or {})}
    # 复用主遍历已建的 NodeRun 行（uq_node_run 约束），置 waiting
    cur = ctx.db.get(NodeRun, ctx.current_node_run_id) if ctx.current_node_run_id else None
    if cur:
        cur.status = "waiting"
        ctx.db.commit()
        emit(ctx.db, ctx.run.id, "node_waiting", node["id"], cur.id,
             {"mode": cfg.get("resumeMode") or "human"})
    raise _Paused()


def exec_data_read(node, ctx) -> dict:
    """07-SDD §4.18：从 DataAsset 按窗口/抽样取数。"""
    from .models import DataAsset
    cfg = node.get("config") or {}
    asset = ctx.db.get(DataAsset, cfg.get("dataAssetId") or "")
    if not asset:
        raise RunError("data-read：数据资产不存在")
    rows = [r for r in (asset.rows or []) if isinstance(r, dict)]
    window = cfg.get("window") or "all"
    if window != "all" and asset.time_field:
        days = {"last_24h": 1, "last_7d": 7, "last_30d": 30}.get(window)
        if days:
            cutoff = datetime.now(timezone.utc).timestamp() - days * 86400
            def _ts(r):
                v = str(r.get(asset.time_field) or "")
                try:
                    return datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()
                except ValueError:
                    return None
            rows = [r for r in rows if (_t := _ts(r)) is not None and _t >= cutoff]
    sampling = cfg.get("sampling") or "all"
    if sampling == "random_n":
        import random
        n = int(cfg.get("sampleN") or 10)
        rows = random.sample(rows, min(n, len(rows))) if rows else []
    filt = cfg.get("filter") or {}
    if filt.get("field"):
        op, val = filt.get("op") or "eq", str(filt.get("value") or "")

        def _fhit(r):
            rv = str(r.get(filt["field"]) or "")
            return rv == val if op == "eq" else val in rv

        rows = [r for r in rows if _fhit(r)]
    return {"rows": rows, "count": len(rows)}


EXECUTORS = {
    "loop": exec_loop, "wait-review": exec_wait_review, "data-read": exec_data_read,
    "input": exec_input, "llm": exec_llm, "condition": exec_condition,
    "transform": exec_transform, "tool": exec_tool, "end": exec_end,
    "create-record": exec_create_record, "notification": exec_notification,
    "workflow-exec": exec_workflow_exec,
    "knowledge-retrieval": exec_knowledge_retrieval, "mcp-call": exec_mcp_call,
    # Phase C（SDD 03 §C-4）
    "reply": exec_reply, "memory-variable": exec_memory_variable,
    "workflow-select": exec_workflow_select, "workflow-fixed": exec_workflow_fixed,
}


def _agent_family_executor(type_key: str):
    """画布节点族补充：Agent 系列 + Phase C 真执行器（决策分类/Query改写/代码）。"""
    from . import agent_runtime as ar
    return {
        "agent": ar.exec_agent_node,
        "agent-select": ar.exec_agent_select,
        "agent-exec": ar.exec_agent_exec,
        "decision-class": exec_decision_class,
        "query-rewrite": exec_query_rewrite,
        "code-write": exec_code_write,
    }.get(type_key)


class Ctx:
    call_chain: list[str] = []

    def __init__(self, db: Session, run: Run, outputs: dict[str, dict]):
        self.db = db
        self.run = run
        self.run_input = run.input or {}
        self.outputs = outputs
        self.current_node_run_id: str | None = None  # SDD A-07：调用记录关联节点运行
        self.last_tokens: dict = {}  # 08-26：节点级 token 供事件展示

    def call(self, kind, target, req, resp, latency, tokens):
        from .models import CallRecord
        from .pii import mask_structure
        # 09 P2-07：CallRecord 的 request/response 按数据分类脱敏后再截断落库
        self.db.add(CallRecord(node_run_id=self.current_node_run_id, kind=kind, target_id=str(target),
                               request={"summary": str(mask_structure(req))[:1000]},
                               response={"summary": str(mask_structure(resp))[:1000]},
                               status="success", latency_ms=latency, token_usage=tokens or {}))
        self.db.commit()


# ---------- runner ----------


def execute_run(run_id: str, call_chain: list[str] | None = None, resume: dict | None = None) -> None:
    db = SessionLocal()
    try:
        run = db.get(Run, run_id)
        if not run:
            return
        chain = list(call_chain or [])
        if run.workflow_id in chain:
            run.status = "failed"
            run.error = {"message": f"检测到工作流递归调用：{' -> '.join(chain + [run.workflow_id])}"}
            db.commit()
            emit(db, run_id, "workflow_failed", payload={"error": "workflow recursion detected"})
            return
        if len(chain) >= 5:
            run.status = "failed"
            run.error = {"message": "子工作流嵌套深度超过 5 层"}
            db.commit()
            emit(db, run_id, "workflow_failed", payload={"error": "workflow depth limit exceeded"})
            return
        chain.append(run.workflow_id)
        # SDD A-01/B-03：运行认版本——优先级 Agent 版本快照 > 工作流版本快照 > 草稿
        frozen_agent_versions: dict[str, str] = {}
        if run.agent_version_id:
            from .models import AgentVersion
            av = db.get(AgentVersion, run.agent_version_id)
            if not av:
                raise RunError(f"run references missing agent version {run.agent_version_id}")
            defn = WorkflowDefinition.model_validate((av.definition or {}).get("graph"))
            for item in ((av.dependency_snapshot or {}).get("items") or []):
                if item.get("type") == "AGENT" and item.get("version"):
                    frozen_agent_versions[item["ref"]] = item["version"]
        elif run.workflow_version_id:
            ver = db.get(WorkflowVersion, run.workflow_version_id)
            if not ver:
                raise RunError(f"run references missing workflow version {run.workflow_version_id}")
            defn = WorkflowDefinition.model_validate(ver.definition)
        else:
            wf = db.get(Workflow, run.workflow_id)
            defn = WorkflowDefinition.model_validate(wf.draft_definition)
        all_nodes = [n.model_dump() for n in defn.graph.nodes]
        all_edges = [e.model_dump() for e in defn.graph.edges]
        by_id = {n["id"]: n for n in all_nodes}
        # 07-SDD：loop 容器——body 节点在容器内执行，不参与主遍历
        loop_bodies, loop_orders = _loop_body_sets(all_nodes, all_edges)
        body_ids = set().union(*loop_bodies.values()) if loop_bodies else set()
        nodes = [n for n in all_nodes if n["id"] not in body_ids]
        edges = [e for e in all_edges if e["source"] not in body_ids and e["target"] not in body_ids]
        run.status = "running"
        run.started_at = datetime.now(timezone.utc)
        db.commit()
        emit(db, run_id, "workflow_started")

        outputs: dict[str, dict] = {}
        ctx = Ctx(db, run, outputs)
        ctx.call_chain = chain
        ctx.frozen_agent_versions = frozen_agent_versions  # SDD B：成员 Agent 冻结版本（可空）
        ctx.start_fields = start_form_fields(db, defn)  # 07-SDD form
        ctx.by_id = by_id
        ctx.loop_bodies = loop_bodies
        ctx.loop_orders = loop_orders
        ctx.resume = resume
        succ: dict[str, list[tuple[str, str | None]]] = {}
        indeg: dict[str, int] = {n["id"]: 0 for n in nodes}
        for e in edges:
            succ.setdefault(e["source"], []).append((e["target"], e.get("sourceHandle")))
            indeg[e["target"]] = indeg.get(e["target"], 0) + 1

        done: set[str] = set()
        skipped: set[str] = set()
        ready: list[str] = []
        if resume:
            # 07-SDD：resume——清掉挂起节点的 waiting/resumed 行（避免 uq_node_run 冲突）后重建
            for pr in db.execute(select(NodeRun).where(
                    NodeRun.run_id == run_id,
                    NodeRun.status.in_(["waiting", "resumed"]))).scalars():
                db.delete(pr)
            db.commit()
            for pr in db.execute(select(NodeRun).where(NodeRun.run_id == run_id)).scalars():
                if pr.status == "success" and pr.output is not None and pr.node_id in by_id:
                    outputs[pr.node_id] = pr.output
                    done.add(pr.node_id)
                elif pr.status == "skipped" and pr.node_id in by_id:
                    skipped.add(pr.node_id)
            for d in list(done):
                _activate_successors(by_id[d], outputs.get(d, {}), succ, indeg, ready, done, skipped, db, run_id, by_id)
            ready = [r for r in ready if r not in done and r not in skipped]
            rn = resume.get("node_id")
            if rn in by_id and rn not in ready:
                ready.append(rn)
        else:
            ready = [n["id"] for n in nodes if indeg.get(n["id"], 0) == 0]
        failed_ids: set[str] = set()
        first_error = ""
        active_handle: dict[str, str | None] = {}  # source -> selected handle (condition)
        failed = False

        # 07-SDD B6（08-26 收尾）：ready 批次并发执行——每节点独立 session，共享态加锁
        import os
        import threading as _th
        from concurrent.futures import ThreadPoolExecutor as _TPE
        _lock = _th.Lock()
        _paused = {"v": False}
        _par = max(1, int(os.environ.get("WF_PAR_RUN", "4")))

        def run_one(nid):
            nonlocal failed, first_error
            node = by_id[nid]
            db2 = SessionLocal()
            ctx2 = Ctx(db2, run, outputs)
            ctx2.call_chain = chain
            ctx2.frozen_agent_versions = frozen_agent_versions
            ctx2.by_id = by_id
            ctx2.loop_bodies = loop_bodies
            ctx2.loop_orders = loop_orders
            ctx2.resume = resume
            try:
                _resolved = resolve_bindings(node.get("inputs", []), outputs, run.input or {})
                nr = NodeRun(run_id=run_id, node_id=nid, node_type=node["type"], status="running",
                             started_at=datetime.now(timezone.utc), input=_resolved or {})
                db2.add(nr)
                db2.commit()
                emit(db2, run_id, "node_started", nid, nr.id, {"nodeType": node["type"], "name": node["name"]})
                ctx2.current_node_run_id = nr.id
                policy = node.get("execution") or {}
                max_retries = int(policy.get("retries") or 0)
                retry_interval = float(policy.get("retryIntervalMs") or 1000) / 1000.0
                on_error = policy.get("onError") or "fail"
                out, exc_final, attempt = None, None, 0
                while True:
                    try:
                        fn = EXECUTORS.get(node["type"]) or _agent_family_executor(node["type"])
                        if not fn:
                            raise RunError(f"no executor for {node['type']}")
                        out = fn(node, ctx2)
                        break
                    except _Paused:
                        raise
                    except Exception as exc:  # noqa: BLE001
                        exc_final = exc
                        attempt += 1
                        if attempt <= max_retries and _retryable(exc):
                            emit(db2, run_id, "node_retry", nid, nr.id,
                                 {"attempt": attempt, "error": str(exc), "name": node["name"]})
                            time.sleep(min(retry_interval * attempt, 10))
                            continue
                        break
                if exc_final is None:
                    with _lock:
                        outputs[nid] = out if isinstance(out, dict) else {"output": out}
                        nr.status = "success"
                        nr.output = outputs[nid]
                        nr.ended_at = datetime.now(timezone.utc)
                        nr.duration_ms = int((nr.ended_at - nr.started_at).total_seconds() * 1000) if nr.started_at else None
                        db2.commit()
                        _tok = getattr(ctx2, "last_tokens", None) or {}
                        ctx2.last_tokens = {}
                        emit(db2, run_id, "node_completed", nid, nr.id,
                             {"output": outputs[nid], "input": nr.input, "nodeType": node["type"], "name": node["name"],
                              "tokens": _tok.get("totalTokens") or _tok.get("total_tokens") or 0},
                             duration_ms=nr.duration_ms)
                        done.add(nid)
                        _activate_successors(node, outputs[nid], succ, indeg, ready, done, skipped, db2, run_id, by_id)
                elif on_error == "skip":
                    with _lock:
                        nr.status = "skipped"
                        nr.error = {"message": str(exc_final)}
                        nr.ended_at = datetime.now(timezone.utc)
                        db2.commit()
                        emit(db2, run_id, "node_skipped", nid, nr.id, {"error": str(exc_final), "name": node["name"]})
                        skipped.add(nid)
                        outputs[nid] = {}
                        _activate_successors(node, {}, succ, indeg, ready, done, skipped, db2, run_id, by_id)
                elif on_error == "branch":
                    err = {"code": type(exc_final).__name__, "message": str(exc_final),
                           "retryable": _retryable(exc_final)}
                    with _lock:
                        nr.status = "failed"
                        nr.error = err
                        nr.ended_at = datetime.now(timezone.utc)
                        db2.commit()
                        emit(db2, run_id, "node_failed", nid, nr.id,
                             {"error": err["message"], "name": node["name"], "routed": True})
                        outputs[nid] = {"error": err}
                        done.add(nid)
                        for tgt, handle in succ.get(nid, []):
                            if handle == "error":
                                indeg[tgt] -= 1
                                if indeg[tgt] <= 0 and tgt not in done and tgt not in skipped:
                                    ready.append(tgt)
                            else:
                                _skip_downstream(tgt, succ, skipped, db2, run_id, by_id)
                else:
                    with _lock:
                        nr.status = "failed"
                        nr.error = {"message": str(exc_final)}
                        nr.ended_at = datetime.now(timezone.utc)
                        db2.commit()
                        emit(db2, run_id, "node_failed", nid, nr.id, {"error": str(exc_final), "name": node["name"]})
                        failed_ids.add(nid)
                        if not first_error:
                            first_error = str(exc_final)
                        failed = True
            except _Paused:
                _paused["v"] = True
            finally:
                db2.close()

        while True:
            # 09 P1-05：协作取消——每批执行前检查 DB 取消标志，命中即终态退出
            cur_status = db.execute(select(Run.status).where(Run.id == run_id)).scalar()
            if cur_status == "cancelled":
                run.ended_at = datetime.now(timezone.utc)
                db.commit()
                emit(db, run_id, "run_cancelled", payload={"run_id": run_id})
                return
            with _lock:
                if failed or _paused["v"] or not ready:
                    break
                batch = ready[:]
                ready.clear()
            if len(batch) == 1:
                run_one(batch[0])
            else:
                with _TPE(max_workers=min(_par, len(batch))) as ex:
                    list(ex.map(run_one, batch))

        if _paused["v"]:
            run.status = "paused"
            db.commit()
            waiting = db.execute(select(NodeRun).where(
                NodeRun.run_id == run_id, NodeRun.status == "waiting")).scalars().first()
            emit(db, run_id, "run_paused", waiting.node_id if waiting else None, None, {"run_id": run_id})
            return


        for nid in [n["id"] for n in nodes if nid_not_done(n["id"], done, skipped, ready)]:
            if nid in failed_ids:
                continue
            nr = NodeRun(run_id=run_id, node_id=nid, node_type=by_id[nid]["type"], status="skipped")
            db.add(nr)
            db.commit()
            emit(db, run_id, "node_skipped", nid, nr.id, {})

        end_nodes = [n for n in nodes if n["type"] in TERMINAL and n["id"] in done]
        if failed:
            run.status = "failed"
            run.error = {"message": first_error or "node failed"}
            emit(db, run_id, "workflow_failed", payload={"error": "node failed"})
        elif end_nodes:
            run.status = "succeeded"
            run.output = outputs.get(end_nodes[0]["id"], {})
            emit(db, run_id, "workflow_completed", payload={"output": run.output})
        else:
            run.status = "failed"
            run.error = {"message": "no terminal node executed"}
            emit(db, run_id, "workflow_failed", payload={"error": "no terminal executed"})
        run.ended_at = datetime.now(timezone.utc)
        if run.started_at:
            run.duration_ms = int((run.ended_at - run.started_at).total_seconds() * 1000)
        db.commit()
    except _Paused:
        # 07-SDD：wait-review 挂起——Run 置 paused，等待 resume 端点续跑
        run = db.get(Run, run_id)
        if run:
            run.status = "paused"
            db.commit()
            waiting = db.execute(select(NodeRun).where(
                NodeRun.run_id == run_id, NodeRun.status == "waiting")).scalars().first()
            emit(db, run_id, "run_paused", waiting.node_id if waiting else None, None, {"run_id": run_id})
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        run = db.get(Run, run_id)
        if run:
            run.status = "failed"
            run.error = {"message": str(exc)}
            db.commit()
            emit(db, run_id, "workflow_failed", payload={"error": str(exc)})
    finally:
        db.close()


def nid_not_done(nid, done, skipped, ready):
    return nid not in done and nid not in skipped and nid not in ready


def _skip_downstream(nid, succ, skipped, db, run_id, by_id):
    if nid in skipped:
        return
    skipped.add(nid)
    nr = NodeRun(run_id=run_id, node_id=nid, node_type=by_id[nid]["type"], status="skipped")
    db.add(nr)
    db.commit()
    emit(db, run_id, "node_skipped", nid, nr.id, {})
    for tgt, _h in succ.get(nid, []):
        _skip_downstream(tgt, succ, skipped, db, run_id, by_id)


def _retryable(exc: Exception) -> bool:
    """07-SDD：仅 retryable 错误重试（5xx/timeout/连接错误）。"""
    if isinstance(exc, (httpx.TimeoutException, httpx.ConnectError)):
        return True
    s = str(exc).lower()
    return any(k in s for k in ("timeout", "timed out", "connection", "500", "502", "503", "504"))


def _activate_successors(node, out, succ, indeg, ready, done, skipped, db, run_id, by_id):
    """successors 激活：condition/decision-class/workflow-select 走分支语义（07-SDD 提取自原内联逻辑）。"""
    for tgt, handle in succ.get(node["id"], []):
        if node["type"] in ("condition", "decision-class", "workflow-select"):
            sel = out.get("selected")
            want = handle or "yes"
            if sel == "else":
                want_ok = want not in [b.get("handle") for b in (node["config"] or {}).get("branches", [])]
                if not want_ok and want != "else":
                    _skip_downstream(tgt, succ, skipped, db, run_id, by_id)
                    continue
            elif want != sel:
                _skip_downstream(tgt, succ, skipped, db, run_id, by_id)
                continue
        indeg[tgt] -= 1
        if indeg[tgt] <= 0 and tgt not in done and tgt not in skipped:
            ready.append(tgt)


def _loop_body_sets(nodes, edges) -> tuple[dict[str, set[str]], dict[str, list[str]]]:
    """07-SDD：loop 容器体 = 经 body handle 可达的节点集；返回 {loopId: body集合} 与拓扑序。"""
    by_id = {n["id"]: n for n in nodes}
    body_succ: dict[str, list[str]] = {}
    for e in edges:
        if e.get("sourceHandle") == "body":
            body_succ.setdefault(e["source"], []).append(e["target"])
    # 体内节点间的边（用于拓扑序）
    inner: dict[str, list[str]] = {n["id"]: [] for n in nodes}
    for e in edges:
        inner.setdefault(e["source"], []).append(e["target"])
    bodies: dict[str, set[str]] = {}
    orders: dict[str, list[str]] = {}
    for n in nodes:
        if n["type"] != "loop":
            continue
        seen: set[str] = set()
        stack = list(body_succ.get(n["id"], []))
        while stack:
            cur = stack.pop()
            if cur in seen or cur == n["id"]:
                continue
            seen.add(cur)
            stack.extend(inner.get(cur, []))
        bodies[n["id"]] = seen
        # 拓扑序（Kahn，体内）
        indeg = {x: 0 for x in seen}
        for s in seen:
            for t in inner.get(s, []):
                if t in seen:
                    indeg[t] += 1
        q = [x for x in seen if indeg[x] == 0]
        order: list[str] = []
        while q:
            x = q.pop(0)
            order.append(x)
            for t in inner.get(x, []):
                if t in seen:
                    indeg[t] -= 1
                    if indeg[t] <= 0:
                        q.append(t)
        orders[n["id"]] = order
    return bodies, orders


def migrate_definition(db: Session, defn: dict) -> tuple[dict, bool]:
    """07-SDD §5/§6：旧图 agent 三键 → workflow 三连一次性改写（GET/保存时）。

    agent→workflow-fixed（成员底层 workflow）；agent-select→workflow-select（候选映射）；
    agent-exec→workflow-exec 固定模式。映射缺失字段留空 → 校验器标 unconfigured 引导重选。"""
    from .models import Agent
    changed = False

    def _wf(aid):
        a = db.get(Agent, aid or "")
        return a.workflow_id if a else None

    for n in (defn or {}).get("graph", {}).get("nodes", []) or []:
        t = n.get("type")
        if t not in ("agent", "agent-select", "agent-exec"):
            continue
        cfg = n.get("config") or {}
        if t == "agent":
            n["type"] = "workflow-fixed"
            n["config"] = {"workflowId": _wf(cfg.get("agentCode")) or "", "versionPolicy": "latest"}
        elif t == "agent-select":
            cands = [w for w in (_wf(a) for a in (cfg.get("primaryAgents") or [])) if w]
            n["type"] = "workflow-select"
            n["config"] = {"candidates": cands, "routingModel": "qwen-plus"}
        else:
            n["type"] = "workflow-exec"
            n["config"] = {"mode": "fixed", "workflowCode": _wf(cfg.get("agentCode")) or ""}
        changed = True
    return defn, changed


# ---------- worker ----------


import uuid as _uuid
# 09 P1-05（审计：Worker ID 固定 w1）：每进程唯一 Worker ID
WORKER_ID = f"w-{_uuid.uuid4().hex[:8]}"
LEASE_SECONDS_DEFAULT = 300          # 09 P1-05：认领租约（秒），超期视为 worker 崩溃
HEARTBEAT_SECONDS = 60               # 09 P1-05：心跳续租间隔（< 租约，防长任务被误回收）
BACKOFF_BASE_SECONDS = 2             # 重试退避基数（指数，封顶 300s）


def _heartbeat(job_id: str, stop_evt: threading.Event) -> None:
    """09 P1-05：长任务心跳——周期性续租 locked_at，防止被租约回收误判为崩溃。"""
    while not stop_evt.wait(HEARTBEAT_SECONDS):
        hb = SessionLocal()
        try:
            hb.execute(text("UPDATE job_queue SET locked_at=now() "
                            "WHERE id=:i AND status='processing'"), {"i": job_id})
            hb.commit()
        except Exception:  # noqa: BLE001
            hb.rollback()
        finally:
            hb.close()


def claim_job(db: Session, include_future: bool = False):
    """09 P1-05：认领下一个到期 pending 任务（SKIP LOCKED，多 worker 安全）。

    include_future=True 时忽略 run_at（供测试/补偿立即取回退避中的任务）。"""
    due = "" if include_future else " AND run_at <= now() "
    row = db.execute(text(
        "UPDATE job_queue SET status='processing', locked_at=now(), locked_by=:w "
        f"WHERE id=(SELECT id FROM job_queue WHERE status='pending' {due} "
        "ORDER BY run_at LIMIT 1 FOR UPDATE SKIP LOCKED) "
        "RETURNING id, type, payload, attempts, max_attempts"), {"w": WORKER_ID}).fetchone()
    db.commit()
    return row


def complete_job(db: Session, job_id: str, success: bool, error: Exception | str | None = None) -> None:
    """09 P1-05：完成/失败结算。成功→done；失败→按 attempts 重试退避或入死信。"""
    j = db.get(JobQueue, job_id)
    if not j:
        return
    # claim 用原生 SQL 改状态（绕过 ORM），此处先 refresh 同步，避免变更不被检测
    db.refresh(j)
    j.attempts = (j.attempts or 0) + 1
    if success:
        j.status = "done"
        j.error = None
    else:
        j.error = {"message": str(error) if error else "job failed"}
        if j.attempts >= (j.max_attempts or 3):
            j.status = "dead"  # 死信：重试用尽，运维可见/可重放
        else:
            j.status = "pending"
            backoff = min(BACKOFF_BASE_SECONDS * (2 ** (j.attempts - 1)), 300)
            j.run_at = datetime.now(timezone.utc) + timedelta(seconds=backoff)


def recover_stale_jobs(db: Session, lease_seconds: int = LEASE_SECONDS_DEFAULT) -> int:
    """09 P1-05：租约回收——locked_at 超期仍 processing 的任务视为 worker 崩溃，
    有剩余重试次数→回 pending；重试用尽→死信。返回处理条数。"""
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=lease_seconds)
    stale = db.execute(select(JobQueue).where(
        JobQueue.status == "processing",
        JobQueue.locked_at.isnot(None),
        JobQueue.locked_at < cutoff)).scalars().all()
    for j in stale:
        if (j.attempts or 0) >= (j.max_attempts or 3):
            j.status = "dead"
            j.error = {**(j.error or {}), "message": (j.error or {}).get("message", "lease expired (worker crashed)")}
        else:
            j.status = "pending"
            j.locked_by = None
            j.locked_at = None
    if stale:
        db.commit()
    return len(stale)


def _dispatch_job(jtype: str, payload: dict) -> None:
    if jtype == "agent-execution":  # SDD A-03：Agent 顶层运行
        from .agent_runtime import execute_agent_job
        execute_agent_job(payload["run_id"])
    elif jtype == "task-run":  # 09 P0-B2：任务批次（per-interaction）
        from .task_runner import execute_task_run
        execute_task_run(payload["task_run_id"])
    elif jtype == "task-run-retry":  # 09 P1-06：失败交互重试 + 重汇父批次
        from .task_runner import retry_failed_in_taskrun
        retry_failed_in_taskrun(payload["task_run_id"])
    else:
        execute_run(payload["run_id"], resume=payload.get("resume"))


def claim_and_run(db: Session) -> bool:
    """兼容入口：认领并执行一个到期任务（含重试/死信结算 + 心跳续租）。"""
    row = claim_job(db)
    if not row:
        return False
    payload = row.payload if isinstance(row.payload, dict) else json.loads(row.payload)
    hb_stop = threading.Event()
    hb = threading.Thread(target=_heartbeat, args=(row.id, hb_stop), daemon=True)
    hb.start()
    try:
        _dispatch_job(row.type, payload)
        complete_job(db, row.id, success=True)
    except Exception as exc:  # noqa: BLE001
        complete_job(db, row.id, success=False, error=exc)
    finally:
        hb_stop.set()
    db.commit()
    return True


def worker_loop(stop: threading.Event) -> None:
    tick = 0
    while not stop.is_set():
        db = SessionLocal()
        busy = False
        try:
            # 09 P1-05：周期性租约回收（约每 10s），崩溃 worker 的任务重新可认领
            if tick % 20 == 0:
                try:
                    recover_stale_jobs(db)
                except Exception:  # noqa: BLE001
                    db.rollback()
            busy = claim_and_run(db)
        finally:
            db.close()
        if not busy:
            stop.wait(0.5)
        tick += 1


_WORKER_STOP: threading.Event | None = None


def start_worker_only() -> threading.Event:
    """09 P1（审计：进程拆分）：仅启动 worker 循环（独立进程用）。"""
    stop = threading.Event()
    threading.Thread(target=worker_loop, args=(stop,), daemon=True, name="wf-worker").start()
    return stop


def start_scheduler_only() -> threading.Event:
    """09 P1（审计：进程拆分）：仅启动 scheduler 循环（独立进程/选主用）。"""
    stop = threading.Event()
    threading.Thread(target=scheduler_loop, args=(stop,), daemon=True, name="wf-scheduler").start()
    return stop


def start_worker() -> threading.Event:
    """幂等单例（09 P0-B4）：全进程仅一组 worker+scheduler 线程。

    多个测试模块各自调用时若重复起线程，会出现多 scheduler 互相触发
    对方调度、多 worker 争抢同一 job_queue 的串扰（全量套件偶发超时）。
    若先前已停止（如进程内重启），则重新拉起。"""
    global _WORKER_STOP
    if _WORKER_STOP is not None and not _WORKER_STOP.is_set():
        return _WORKER_STOP
    stop = threading.Event()
    t = threading.Thread(target=worker_loop, args=(stop,), daemon=True, name="wf-worker")
    t.start()
    s = threading.Thread(target=scheduler_loop, args=(stop,), daemon=True, name="wf-scheduler")
    s.start()
    _WORKER_STOP = stop
    return stop


def create_run(db: Session, workflow_id: str, trigger: str, run_input: dict,
               idempotency_key: str | None = None, enqueue: bool = True,
               version_id: str | None = None, pinned_version_id: str | None = None) -> Run:
    """创建运行（SDD A-01 运行认版本）。

    解析顺序：
    - 显式 version_id → 执行该不可变版本；
    - trigger=schedule → pinned_version_id → 工作流 current_version_id → 两者皆无则
      RunError("NO_PUBLISHED_VERSION")（定时任务不允许跑未发布草稿）;
    - 其余（manual/test/agent…）→ 草稿。
    """
    wf = db.get(Workflow, workflow_id)
    if not wf:
        raise RunError("workflow not found")
    chosen: WorkflowVersion | None = None
    if version_id:
        chosen = db.get(WorkflowVersion, version_id)
        if not chosen or chosen.workflow_id != workflow_id:
            raise RunError(f"version {version_id} not found for workflow {workflow_id}")
    elif trigger == "schedule":
        vid = pinned_version_id or wf.current_version_id
        if not vid:
            raise RunError("NO_PUBLISHED_VERSION：定时任务没有可运行的已发布版本，请先发布")
        chosen = db.get(WorkflowVersion, vid)
        if not chosen:
            raise RunError(f"NO_PUBLISHED_VERSION：版本 {vid} 不存在")
    raw = chosen.definition if chosen else wf.draft_definition
    defn = WorkflowDefinition.model_validate(raw)
    rep = validate(defn)
    if not rep.ok:
        raise RunError("validation failed: " + "; ".join(i.message for i in rep.issues[:3]))
    # 07-SDD V1.5：运行时校验引擎（required/length/min-max/pattern/selections；default 兜底）
    fields = start_form_fields(db, defn)
    if fields:
        from .routers.forms import validate_form_input
        errs = validate_form_input(fields, run_input or {})
        if errs:
            raise RunError("输入校验失败：" + "；".join(errs[:3]))
    run = Run(workflow_id=workflow_id, trigger=trigger, status="queued", input=run_input or {},
              idempotency_key=idempotency_key,
              workflow_version_id=chosen.id if chosen else None,
              definition_source="version" if chosen else "draft")
    db.add(run)
    db.commit()
    if enqueue:
        db.add(JobQueue(type="workflow-execution", payload={"run_id": run.id}))
        db.commit()
    return run
