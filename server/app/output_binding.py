"""SDD 13 §4.2/§5.2：OutputBinding 规范化与受限 mapping engine。

mapping 表达式只实现受限路径语法：禁止 eval/脚本/SQL/任意模板。
允许根：$output.* / $run.<白名单> / $schema.ref|sha256 / $system.completedAt /
$constant.<name>。可选后缀：`::<cast>`（string|integer|number|boolean|timestamp）
与 `?? <JSON 字面量>` 默认值。首版禁止数组展开、聚合、join、条件、网络与动态表/列名。
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime
from typing import Any

IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

ALLOWED_CASTS = ("string", "integer", "number", "boolean", "timestamp")
RUN_PATHS = {"id", "taskRunId", "taskId", "taskVersionId", "interactionRef", "attempt"}
SCHEMA_PATHS = {"ref", "sha256"}
SYSTEM_PATHS = {"completedAt"}


class MappingExpressionError(Exception):
    """mapping 表达式非法（根/路径/转换/默认值）。code 供 issues 使用。"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _parse_default(raw: str) -> Any:
    try:
        return json.loads(raw)
    except Exception as exc:  # noqa: BLE001
        raise MappingExpressionError(
            "MAPPING_DEFAULT_INVALID", f"默认值必须是 JSON 字面量：{raw!r}") from exc


def parse_mapping_expr(expr: str) -> dict:
    """解析受限表达式 → {root, path, cast, default}。任何偏离都抛 MappingExpressionError。"""
    if not isinstance(expr, str) or not expr.strip():
        raise MappingExpressionError("MAPPING_EXPR_INVALID", "表达式必须是非空字符串")
    text = expr.strip()
    cast = None
    default = None
    if "??" in text:
        text, default_raw = text.split("??", 1)
        default = _parse_default(default_raw.strip())
        text = text.strip()
    if "::" in text:
        text, cast_raw = text.split("::", 1)
        cast = cast_raw.strip()
        if cast not in ALLOWED_CASTS:
            raise MappingExpressionError(
                "MAPPING_CAST_INVALID", f"不支持的转换 {cast!r}（允许 {','.join(ALLOWED_CASTS)}）")
        text = text.strip()
    if not text.startswith("$"):
        raise MappingExpressionError("MAPPING_EXPR_INVALID",
                                     f"表达式必须以 $ 根开头：{expr!r}")
    root, _, rest = text[1:].partition(".")
    parts = [p for p in rest.split(".") if p] if rest else []
    if rest and len(parts) != len(rest.split(".")):
        raise MappingExpressionError("MAPPING_EXPR_INVALID", f"非法路径：{expr!r}")
    for p in parts:
        if not IDENT_RE.match(p):
            raise MappingExpressionError("MAPPING_EXPR_INVALID", f"非法路径段 {p!r}")
    if root == "output":
        # 空路径=整体写入（§5.2 允许对象整体写 JSONB）
        pass
    elif root == "run":
        if not (len(parts) == 1 and parts[0] in RUN_PATHS):
            raise MappingExpressionError("MAPPING_ROOT_INVALID", f"$run 仅支持 {sorted(RUN_PATHS)}")
    elif root == "schema":
        if not (len(parts) == 1 and parts[0] in SCHEMA_PATHS):
            raise MappingExpressionError("MAPPING_ROOT_INVALID", "$schema 仅支持 ref|sha256")
    elif root == "system":
        if not (len(parts) == 1 and parts[0] in SYSTEM_PATHS):
            raise MappingExpressionError("MAPPING_ROOT_INVALID", "$system 仅支持 completedAt")
    elif root == "constant":
        if not (len(parts) == 1 and parts[0]):
            raise MappingExpressionError("MAPPING_ROOT_INVALID", "$constant 需要名称")
    else:
        raise MappingExpressionError("MAPPING_ROOT_INVALID",
                                     f"不允许的根 ${root}（仅 output/run/schema/system/constant）")
    return {"root": root, "path": parts, "cast": cast, "default": default}


def _read_path(cur: Any, parts: list[str]) -> tuple[Any, bool]:
    """对象字段读取；返回 (value, found)。数组只允许整体写入（路径止于 array）。"""
    for p in parts:
        if isinstance(cur, dict):
            if p not in cur:
                return None, False
            cur = cur[p]
        else:
            return None, False
    return cur, True


def source_schema_at(output_schema: dict, parts: list[str]) -> dict | None:
    """在冻结 Output Schema 内定位路径的 sub-schema；不存在返回 None。"""
    cur = output_schema or {}
    for p in parts:
        props = (cur.get("properties") or {})
        if p not in props:
            return None
        cur = props[p]
    return cur


def _apply_cast(value: Any, cast: str | None, expr: str) -> Any:
    if value is None or cast is None:
        return value
    try:
        if cast == "string":
            if isinstance(value, str):
                return value
            return json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else str(value)
        if cast == "integer":
            return int(value)
        if cast == "number":
            return float(value)
        if cast == "boolean":
            if isinstance(value, bool):
                return value
            return str(value).lower() in ("1", "true", "yes")
        if cast == "timestamp":
            if isinstance(value, (datetime, date)):
                return value.isoformat()
            datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            return str(value)
    except Exception as exc:  # noqa: BLE001
        raise MappingExpressionError("MAPPING_CAST_FAILED",
                                     f"{expr!r} 值 {value!r} 无法转换为 {cast}") from exc
    return value


def evaluate_mapping_expr(expr: str, ctx: dict) -> Any:
    """对冻结 ctx 求值。ctx = {output, run, schema, system, constants}。"""
    parsed = parse_mapping_expr(expr)
    root, parts = parsed["root"], parsed["path"]
    if root == "output":
        value, found = _read_path(ctx.get("output") or {}, parts)
    elif root == "run":
        value, found = (ctx.get("run") or {}).get(parts[0]), True
    elif root == "schema":
        value, found = (ctx.get("schema") or {}).get(parts[0]), True
    elif root == "system":
        value, found = (ctx.get("system") or {}).get(parts[0]), True
    else:  # constant
        consts = ctx.get("constants") or {}
        value, found = consts.get(parts[0]), parts[0] in consts
    if not found or value is None:
        if parsed["default"] is not None:
            return parsed["default"]
        if not found:
            raise MappingExpressionError("MAPPING_SOURCE_MISSING",
                                         f"源路径 {expr!r} 在 Output/上下文中不存在")
        return None
    return _apply_cast(value, parsed["cast"], expr)


def build_record_payload(mapping: dict, ctx: dict) -> dict:
    """按冻结 mapping 生成目标记录；任何表达式错误向上抛（调用方转 Run 失败或 issue）。"""
    record: dict = {}
    for column, expr in (mapping or {}).items():
        if not IDENT_RE.match(column or ""):
            raise MappingExpressionError("MAPPING_COLUMN_INVALID", f"非法目标列名 {column!r}")
        record[column] = evaluate_mapping_expr(expr, ctx)
    return record


def build_ctx(run, binding_snapshot: dict) -> dict:
    """SDD 13 §7.1：映射上下文只来自冻结事实（Run.output/谱系/schema/完成时间）。"""
    completed = run.ended_at.isoformat() if run.ended_at else None
    return {
        "output": run.output or {},
        "run": {"id": run.id, "taskRunId": run.task_run_id, "taskId": run.task_id,
                "taskVersionId": run.task_version_id,
                "interactionRef": run.interaction_ref, "attempt": run.attempt},
        "schema": {"ref": (binding_snapshot or {}).get("outputSchemaRef") or "",
                   "sha256": (binding_snapshot or {}).get("outputSchemaSha256") or ""},
        "system": {"completedAt": completed},
        "constants": (binding_snapshot or {}).get("constants") or {},
    }


def payload_sha256(record: dict) -> str:
    return hashlib.sha256(
        json.dumps(record, sort_keys=True, ensure_ascii=False, default=str).encode()
    ).hexdigest()


def fingerprint_binding(snapshot: dict) -> str:
    """目标表/定义版本/映射/写模式的指纹：启动探测与运行期漂移检测共用。"""
    core = {k: snapshot.get(k) for k in
            ("schemaName", "table", "definitionVersionId", "writeMode",
             "keyFields", "mapping", "outputSchemaRef", "outputSchemaSha256")}
    return hashlib.sha256(
        json.dumps(core, sort_keys=True, ensure_ascii=False, default=str).encode()
    ).hexdigest()


def normalize_binding(payload: dict) -> dict:
    """API 请求 outputBinding → 内部 camelCase 结构（服务端最终校验在 validator）。"""
    payload = payload or {}
    mode = payload.get("mode") or "platform_only"
    if mode not in ("platform_only", "target_table"):
        raise MappingExpressionError("BINDING_MODE_INVALID",
                                     "outputBinding.mode 必须是 platform_only|target_table")
    write_mode = payload.get("writeMode") or "upsert"
    if write_mode not in ("append", "upsert"):
        raise MappingExpressionError("BINDING_WRITE_MODE_INVALID",
                                     "writeMode 必须是 append|upsert")
    failure_policy = payload.get("failurePolicy") or "separate_delivery_status"
    if failure_policy != "separate_delivery_status":
        raise MappingExpressionError("BINDING_POLICY_INVALID",
                                     "本期 failurePolicy 固定 separate_delivery_status")
    mapping = payload.get("mapping") or {}
    if not isinstance(mapping, dict):
        raise MappingExpressionError("BINDING_MAPPING_INVALID", "mapping 必须是对象")
    key_fields = payload.get("keyFields") or []
    if not isinstance(key_fields, list) or any(not isinstance(k, str) for k in key_fields):
        raise MappingExpressionError("BINDING_KEY_INVALID", "keyFields 必须是字符串数组")
    constants = payload.get("constants") or {}
    if not isinstance(constants, dict):
        raise MappingExpressionError("BINDING_CONSTANTS_INVALID", "constants 必须是对象")
    return {"mode": mode,
            "assetId": payload.get("assetId"),
            "definitionVersionId": payload.get("definitionVersionId"),
            "writeMode": write_mode,
            "keyFields": key_fields,
            "failurePolicy": failure_policy,
            "mapping": mapping,
            "constants": constants}


def freeze_binding_snapshot(db, tv, output_schema_ref: str, output_schema_sha256: str) -> dict | None:
    """TaskRun 启动时把 OutputBinding 冻结为快照（SDD 13 §4.3：启动后不跟随 Task 编辑）。

    platform_only 返回 None。target_table 解析 DataAsset/Datasource/Connection 身份与
    表 locator；Secret 不进入快照（writer 运行时经 connection_id 读取）。"""
    if (tv.output_mode or "platform_only") != "target_table":
        return None
    from .models import DataAsset, DataDefinitionVersion, Datasource
    asset = db.get(DataAsset, tv.output_asset_id or "")
    if not asset:
        return None
    schema_name, table = "public", (asset.location or "").strip()
    if "." in table:
        maybe_schema, maybe_table = table.split(".", 1)
        if IDENT_RE.match(maybe_schema) and IDENT_RE.match(maybe_table):
            schema_name, table = maybe_schema, maybe_table
    datasource = db.get(Datasource, asset.datasource_id) if asset.datasource_id else None
    dv = db.get(DataDefinitionVersion, tv.output_definition_version_id or "")
    snapshot = {
        "mode": "target_table",
        "assetId": asset.id, "assetName": asset.name,
        "datasourceId": datasource.id if datasource else None,
        "connectionId": datasource.connection_id if datasource else None,
        "schemaName": schema_name, "table": table,
        "definitionVersionId": dv.id if dv else None,
        "writeMode": tv.output_write_mode or "upsert",
        "keyFields": tv.output_key_fields or [],
        "failurePolicy": tv.output_failure_policy or "separate_delivery_status",
        "mapping": tv.output_mapping or {},
        "constants": (tv.output_contract_snapshot or {}).get("constants") or {},
        "outputSchemaRef": output_schema_ref,
        "outputSchemaSha256": output_schema_sha256,
    }
    snapshot["schemaFingerprint"] = fingerprint_binding(snapshot)
    return snapshot
