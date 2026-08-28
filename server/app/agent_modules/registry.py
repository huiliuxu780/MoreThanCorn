"""Module Registry（SDD 10 §6.2）：启动时发现并 fail fast。

失败模式：重复 (key, version)、缺 Schema/默认 Spec/实现、声明哈希不一致、默认 Spec 不合
Spec Schema——任何一项都拒绝服务启动（main.lifespan 调用 warmup）。
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from .base import MODULE_DIR, AgentModule, sha256_of


class ModuleRegistryError(RuntimeError):
    pass


def _discover() -> dict[tuple[str, str], AgentModule]:
    modules: dict[tuple[str, str], AgentModule] = {}
    for manifest_path in sorted(MODULE_DIR.glob("*/manifest.yaml")):
        module = AgentModule(manifest_path)
        key = (module.key, module.version)
        if key in modules:
            raise ModuleRegistryError(f"重复 Module 注册：{key}")
        modules[key] = module
    if not modules:
        raise ModuleRegistryError("未发现任何 Agent Module（agent_modules/*/manifest.yaml）")
    return modules


@lru_cache(maxsize=1)
def _registry() -> dict[tuple[str, str], AgentModule]:
    return _discover()


def warmup() -> list[dict]:
    """启动时强制加载全部 Module（fail fast）；返回清单供日志/诊断。"""
    return [{"key": m.key, "version": m.version,
             "implementations": sorted(m.manifest["implementations"]),
             "inputSchemaSha256": m.input_schema_ref["sha256"][:12],
             "outputSchemaSha256": m.output_schema_ref["sha256"][:12]}
            for _, m in sorted(_registry().items())]


def all_modules() -> list[AgentModule]:
    return [m for _, m in sorted(_registry().items())]


def get(module_key: str, module_version: str | None = None) -> AgentModule:
    registry = _registry()
    if module_version is None:
        matches = [m for (k, _), m in registry.items() if k == module_key]
        if len(matches) == 1:
            return matches[0]
        raise ModuleRegistryError(f"module {module_key} 需要明确版本（候选 "
                                  f"{sorted(v for (k, v) in registry if k == module_key)}）")
    module = registry.get((module_key, module_version))
    if module is None:
        raise ModuleRegistryError(f"module {module_key}@{module_version} 未注册")
    return module


def validate_spec(module_key: str, module_version: str, spec: dict) -> list[dict]:
    return get(module_key, module_version).validate_spec(spec)


def resolve_implementation(module_key: str, module_version: str, provider_kind: str) -> dict:
    try:
        return get(module_key, module_version).resolve_implementation(provider_kind)
    except KeyError as exc:
        raise ModuleRegistryError(str(exc)) from exc
