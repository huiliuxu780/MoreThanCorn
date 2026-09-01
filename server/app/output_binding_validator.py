"""SDD 13 §6：统一 OutputBindingValidator。

- validate_for_edit：新建/编辑时返回完整问题列表（不只第一个错误）；
- validate_for_start：Task 激活/TaskRun 启动时 fail-closed 探测（连接/表/结构/权限/唯一键）；
- §6.3 禁止项：不写测试行、不打印 Secret、不接受任意 schema/table 绕过 DataAsset、
  不只看平台旧 health 字段。"""
from __future__ import annotations

from .data_writers import WriterError, get_writer
from .data_writers.base import TargetMetadata
from .output_binding import (MappingExpressionError, fingerprint_binding,
                             parse_mapping_expr, source_schema_at)

_PG_STRING = ("text", "character varying", "character")
_PG_INT = ("integer", "bigint", "smallint")
_PG_NUM = ("numeric", "real", "double precision") + _PG_INT
_PG_BOOL = ("boolean",)
_PG_TIME = ("timestamp without time zone", "timestamp with time zone", "date")
_PG_JSON = ("jsonb", "json")


def _type_compatible(source_type: str | None, pg_type: str, cast: str | None) -> bool:
    if pg_type in _PG_JSON:
        return True
    eff = cast or source_type
    if eff is None:
        return True  # 源类型未知（$run/$system 根）：由目标列运行时约束兜底
    if pg_type in _PG_STRING:
        return eff in (None, "string", "any") or cast == "string"
    if pg_type in _PG_INT:
        return eff in ("integer",) or cast == "integer"
    if pg_type in _PG_NUM:
        return eff in ("integer", "number") or cast in ("integer", "number")
    if pg_type in _PG_BOOL:
        return eff in ("boolean",) or cast == "boolean"
    if pg_type in _PG_TIME:
        return eff in ("string",) or cast == "timestamp"
    return eff is None


def _issue(code: str, path: list, message: str) -> dict:
    return {"code": code, "path": path, "message": message}


def _resolve_output_schema(db, tv=None, output_schema: dict | None = None) -> dict:
    if output_schema is not None:
        return output_schema
    if tv is not None and tv.output_contract_snapshot:
        return (tv.output_contract_snapshot or {}).get("schema") or {}
    return {}


def validate_for_edit(db, binding: dict, *, output_schema: dict,
                      output_schema_ref: str = "",
                      input_asset_id: str | None = None) -> dict:
    """编辑态完整校验。binding 为 normalize_binding 结果。"""
    issues: list[dict] = []
    if (binding.get("mode") or "platform_only") == "platform_only":
        return {"valid": True, "issues": [],
                "resolved": {"outputSchemaRef": output_schema_ref, "targetTable": None,
                             "schemaFingerprint": None}}
    from .models import DataAsset, DataDefinition, DataDefinitionVersion, Datasource, Connection
    asset = db.get(DataAsset, binding.get("assetId") or "")
    if not asset:
        issues.append(_issue("ASSET_MISSING", ["outputBinding", "assetId"],
                             "目标 DataAsset 不存在"))
        return {"valid": False, "issues": issues, "resolved": None}
    if (asset.lifecycle or "") != "Ready":
        issues.append(_issue("ASSET_NOT_READY", ["outputBinding", "assetId"],
                             f"目标 DataAsset 生命周期 {asset.lifecycle}（需 Ready）"))
    datasource = db.get(Datasource, asset.datasource_id) if asset.datasource_id else None
    if not datasource:
        issues.append(_issue("DATASOURCE_MISSING", ["outputBinding", "assetId"],
                             "目标 DataAsset 未绑定 DataSource"))
    else:
        if (datasource.status or "") != "enabled":
            issues.append(_issue("CONNECTION_DISABLED", ["outputBinding", "assetId"],
                                 "DataSource 未启用"))
        conn = db.get(Connection, datasource.connection_id) if datasource.connection_id else None
        if not conn or (conn.lifecycle or "") not in ("active",):
            issues.append(_issue("CONNECTION_DISABLED", ["outputBinding", "assetId"],
                                 "Connection 不存在或未激活"))
    table_raw = (asset.location or "").strip()
    schema_name, table = "public", table_raw
    if "." in table_raw:
        s, t = table_raw.split(".", 1)
        schema_name, table = s, t
    if not table_raw or not table:
        issues.append(_issue("TARGET_LOCATOR_INVALID", ["outputBinding", "assetId"],
                             "目标表 locator 为空或非法（禁止任意 SQL）"))
    dv = db.get(DataDefinitionVersion, binding.get("definitionVersionId") or "")
    if not dv:
        issues.append(_issue("DEFINITION_MISSING", ["outputBinding", "definitionVersionId"],
                             "DataDefinitionVersion 不存在"))
    else:
        dd = db.get(DataDefinition, dv.definition_id)
        if not dd or dd.data_asset_id != asset.id:
            issues.append(_issue("DEFINITION_NOT_OWNED", ["outputBinding", "definitionVersionId"],
                                 "DataDefinitionVersion 不属于目标 DataAsset"))
    if input_asset_id and input_asset_id == asset.id:
        issues.append(_issue("INPUT_EQUALS_OUTPUT", ["outputBinding", "assetId"],
                             "输入与输出指向同一物理表，默认拒绝"))

    snapshot = {"schemaName": schema_name, "table": table,
                "definitionVersionId": binding.get("definitionVersionId"),
                "writeMode": binding.get("writeMode"), "keyFields": binding.get("keyFields"),
                "mapping": binding.get("mapping"), "outputSchemaRef": output_schema_ref,
                "outputSchemaSha256": "", "assetId": asset.id}
    meta: TargetMetadata | None = None
    if datasource:
        try:
            writer = get_writer(db, datasource)
            meta = writer.inspect_target(snapshot)
        except WriterError as exc:
            issues.append(_issue(exc.code, ["outputBinding", "assetId"], exc.message))
    if meta is not None:
        mapping = binding.get("mapping") or {}
        for column, expr in mapping.items():
            if column not in meta.columns:
                issues.append(_issue("TARGET_COLUMN_MISSING",
                                     ["outputBinding", "mapping", column],
                                     f"目标列 {column} 不存在于 {schema_name}.{table}"))
                continue
            try:
                parsed = parse_mapping_expr(expr)
            except MappingExpressionError as exc:
                issues.append(_issue(exc.code, ["outputBinding", "mapping", column], exc.message))
                continue
            if parsed["root"] == "output":
                sub = source_schema_at(output_schema or {}, parsed["path"])
                if sub is None:
                    issues.append(_issue("MAPPING_SOURCE_MISSING",
                                         ["outputBinding", "mapping", column],
                                         f"源路径 {expr} 不在冻结 Output Schema 中"))
                else:
                    src_type = sub.get("type")
                    if not _type_compatible(src_type, meta.columns[column].pg_type, parsed["cast"]):
                        issues.append(_issue("TARGET_COLUMN_TYPE_MISMATCH",
                                             ["outputBinding", "mapping", column],
                                             f"{expr} 源类型 {src_type or 'any'} 与目标列 "
                                             f"{meta.columns[column].pg_type} 不兼容；"
                                             f"请选择 jsonb 或显式转换"))
        # required 目标列必须有映射或数据库默认值
        mapped = set(mapping.keys())
        for name, col in meta.columns.items():
            if not col.nullable and not col.has_default and name not in mapped:
                issues.append(_issue("REQUIRED_COLUMN_UNMAPPED",
                                     ["outputBinding", "mapping", name],
                                     f"必填目标列 {name} 无映射且无数据库默认值"))
        key_fields = binding.get("keyFields") or []
        if not key_fields:
            issues.append(_issue("KEY_FIELDS_MISSING", ["outputBinding", "keyFields"],
                                 "唯一键缺失：keyFields 至少包含目标表唯一键"))
        else:
            missing = [k for k in key_fields if k not in meta.columns]
            if missing:
                issues.append(_issue("KEY_FIELDS_MISSING", ["outputBinding", "keyFields"],
                                     f"keyFields 不存在于目标表：{missing}"))
            elif not any(set(key_fields) <= set(uq) for uq in meta.unique_constraints):
                issues.append(_issue("KEY_NO_UNIQUE_CONSTRAINT", ["outputBinding", "keyFields"],
                                     "目标数据库没有覆盖 keyFields 的唯一约束，拒绝保存生产 binding"))
        try:
            writer.check_write_privilege(snapshot)
        except WriterError as exc:
            issues.append(_issue(exc.code, ["outputBinding", "assetId"], exc.message))
    resolved = {"outputSchemaRef": output_schema_ref,
                "targetTable": f"{schema_name}.{table}",
                "schemaFingerprint": fingerprint_binding(snapshot)}
    return {"valid": not issues, "issues": issues, "resolved": resolved}


def validate_for_start(db, snapshot: dict) -> tuple[bool, list[dict]]:
    """启动态 fail-closed 探测（SDD §6.2）。失败不得创建注定无法投递的生产 TaskRun。"""
    issues: list[dict] = []
    if not snapshot or snapshot.get("mode") != "target_table":
        return True, []
    from .models import Datasource
    datasource = db.get(Datasource, snapshot.get("datasourceId") or "")
    if not datasource:
        return False, [_issue("DATASOURCE_MISSING", ["outputBinding"], "目标 DataSource 不存在")]
    try:
        writer = get_writer(db, datasource)
        meta = writer.inspect_target(snapshot)
    except WriterError as exc:
        return False, [_issue(exc.code, ["outputBinding"], exc.message)]
    mapping = snapshot.get("mapping") or {}
    for column in mapping:
        if column not in meta.columns:
            issues.append(_issue("TARGET_COLUMN_MISSING", ["outputBinding", "mapping", column],
                                 f"目标列 {column} 已不存在（Schema 漂移）"))
    key_fields = snapshot.get("keyFields") or []
    if not key_fields or not any(set(key_fields) <= set(uq) for uq in meta.unique_constraints):
        issues.append(_issue("KEY_NO_UNIQUE_CONSTRAINT", ["outputBinding", "keyFields"],
                             "目标表唯一约束已失效"))
    try:
        writer.check_write_privilege(snapshot)
    except WriterError as exc:
        issues.append(_issue(exc.code, ["outputBinding"], exc.message))
    if fingerprint_binding(snapshot) != snapshot.get("schemaFingerprint"):
        issues.append(_issue("BINDING_FINGERPRINT_DRIFT", ["outputBinding"],
                             "冻结 binding 指纹与快照不一致"))
    return (not issues), issues
