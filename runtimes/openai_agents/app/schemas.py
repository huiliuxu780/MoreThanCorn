"""Translate the POC JSON Schema subset into Pydantic models for SDK output_type.

与 AgentScope runtime 的 schema_adapter 语义一致：同一平台 Output Schema 在不同
Provider 上生成等价的结构化输出边界（SDD 14 §24 第一层；平台二次校验在第三层）。
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, create_model


def _union(types: list[type[Any]]) -> type[Any]:
    result = types[0]
    for member in types[1:]:
        result = result | member
    return result


def schema_type(name: str, schema: dict[str, Any]) -> type[Any]:
    if "enum" in schema:
        return Literal.__getitem__(tuple(schema["enum"]))

    declared = schema.get("type")
    if isinstance(declared, list):
        members = [schema_type(name, {**schema, "type": item}) for item in declared]
        return _union(members)
    if declared == "null":
        return type(None)
    if declared == "string":
        return str
    if declared == "integer":
        return int
    if declared == "number":
        return float
    if declared == "boolean":
        return bool
    if declared == "array":
        item_type = schema_type(f"{name}Item", schema.get("items", {}))
        return list[item_type]
    if declared == "object" or "properties" in schema:
        required = set(schema.get("required", []))
        fields: dict[str, tuple[type[Any], Any]] = {}
        for field_name, field_schema in schema.get("properties", {}).items():
            field_type = schema_type(f"{name}{field_name.title().replace('_', '')}", field_schema)
            if field_name in required:
                fields[field_name] = (field_type, ...)
            else:
                fields[field_name] = (field_type | None, None)
        extra = "forbid" if schema.get("additionalProperties") is False else "allow"
        return create_model(name, __config__=ConfigDict(extra=extra), **fields)
    return Any


def output_model(schema: dict[str, Any]) -> type[BaseModel]:
    model = schema_type("QualityRuntimeOutput", schema)
    if not isinstance(model, type) or not issubclass(model, BaseModel):
        raise ValueError("output_schema root must be an object")
    return model
