"""JSON-Schema (subset) -> pydantic model, for structured runs.

AgentScope's ``reply_stream(structured_schema=...)`` requires a pydantic
model class. The platform stores output contracts as JSON Schema, so this
module translates the supported subset (objects with primitive/array
properties, required lists, enums) into a dynamic BaseModel. Unsupported
constructs raise ``SchemaTranslationError`` fail-closed.
"""
from __future__ import annotations

from typing import Any, Literal, Optional, Type

from pydantic import BaseModel, Field, create_model


class SchemaTranslationError(ValueError):
    """Raised when a JSON schema uses unsupported constructs."""


_PRIMITIVES = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
}


def _translate(name: str, schema: dict[str, Any]) -> Any:
    kind = schema.get("type")
    if kind == "object":
        props = schema.get("properties", {})
        required = set(schema.get("required", []))
        fields: dict[str, Any] = {}
        for key, sub in props.items():
            typ = _translate(f"{name}_{key}", sub)
            desc = sub.get("description", "")
            if key in required:
                fields[key] = (typ, Field(description=desc))
            else:
                fields[key] = (Optional[typ], Field(default=None, description=desc))
        return create_model(f"{name}Obj", **fields)
    if kind == "array":
        item = _translate(f"{name}_item", schema.get("items", {"type": "string"}))
        return list[item]  # type: ignore[valid-type]
    if isinstance(kind, list):
        # 09-16：list 型 type 必须先于 _PRIMITIVES 成员判断（list 不可哈希，
        # 否则 TypeError: unhashable type 使所有含 nullable union 的 Module schema 运行必 500）
        non_null = [k for k in kind if k != "null"]
        if len(non_null) == 1 and "null" in kind:
            return Optional[_translate(name, {"type": non_null[0]})]  # type: ignore[misc]
        raise SchemaTranslationError(f"union types unsupported: {kind}")
    if kind in _PRIMITIVES:
        enum = schema.get("enum")
        if enum:
            return Literal[tuple(enum)]  # type: ignore[valid-type]
        return _PRIMITIVES[kind]
    if kind is None and schema.get("enum"):
        return Literal[tuple(schema["enum"])]  # type: ignore[valid-type]
    raise SchemaTranslationError(f"unsupported schema node: {schema!r}")


def schema_to_model(name: str, schema: dict[str, Any]) -> Type[BaseModel]:
    """Translate a JSON-Schema object document into a pydantic model."""
    if schema.get("type") != "object":
        raise SchemaTranslationError("top level must be an object schema")
    model = _translate(name, schema)
    if not (isinstance(model, type) and issubclass(model, BaseModel)):
        raise SchemaTranslationError("top level did not translate to a model")
    return model
