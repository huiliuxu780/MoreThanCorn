"""AgentModule：manifest 驱动的领域能力单元（SDD 10 §2.2/§6.1）。

manifest 是受代码评审的部署资产；本模块负责加载、哈希固化与运行期行为分发：
- build_definition / freeze 增强所需的一切静态事实（schema 引用 + sha256）；
- request_context：把冻结的 AgentVersion.definition 映射为 Contract AgentExecutionSpec 字段；
- map_result：Provider 输出 → 领域结果投影（R3 结果事务调用）。
"""
from __future__ import annotations

import copy
import hashlib
import json
from functools import cached_property
from pathlib import Path

import jsonschema
import yaml

MODULE_DIR = Path(__file__).resolve().parent


def sha256_of(value) -> str:
    if isinstance(value, (dict, list)):
        canonical = json.dumps(value, ensure_ascii=False, sort_keys=True)
        return hashlib.sha256(canonical.encode()).hexdigest()
    return hashlib.sha256(Path(value).read_bytes()).hexdigest()


class AgentModule:
    """一个 (moduleKey, moduleVersion) 的已加载 Module。构造即完成静态校验（fail fast）。"""

    def __init__(self, manifest_path: Path):
        self.dir = manifest_path.parent
        self.manifest = yaml.safe_load(manifest_path.read_text(encoding="utf-8"))
        for field in ("moduleKey", "moduleVersion", "displayName", "specSchema",
                      "inputSchema", "outputSchema", "defaultSpec", "implementations"):
            if not self.manifest.get(field):
                raise ValueError(f"module manifest 缺少必填字段 {field}: {manifest_path}")
        if not isinstance(self.manifest["implementations"], dict) \
                or not self.manifest["implementations"]:
            raise ValueError(f"module 至少需要一个 Provider Implementation: {manifest_path}")
        self._spec_validator = jsonschema.Draft202012Validator(self.spec_schema)
        # 声明即校验：默认 Spec 必须通过本模块 Spec Schema
        self._spec_validator.validate(self.default_spec)

    # ---------- 标识 ----------

    @property
    def key(self) -> str:
        return self.manifest["moduleKey"]

    @property
    def version(self) -> str:
        return self.manifest["moduleVersion"]

    @property
    def workflow_mode(self) -> str | None:
        return self.manifest.get("workflowMode")

    @cached_property
    def spec_schema(self) -> dict:
        return json.loads((self.dir / self.manifest["specSchema"]).read_text(encoding="utf-8"))

    @cached_property
    def default_spec(self) -> dict:
        spec = json.loads((self.dir / self.manifest["defaultSpec"]).read_text(encoding="utf-8"))
        # POC 遗留的文件路径引用不属于 Contract Spec（Schema 引用经 definition 固化）
        spec.pop("input_schema", None)
        spec.pop("output_schema", None)
        return spec

    @cached_property
    def input_schema(self) -> dict:
        return json.loads((self.dir / self.manifest["inputSchema"]).read_text(encoding="utf-8"))

    @cached_property
    def output_schema(self) -> dict:
        return json.loads((self.dir / self.manifest["outputSchema"]).read_text(encoding="utf-8"))

    @cached_property
    def input_schema_ref(self) -> dict:
        return {"id": f"{self.key}-input", "version": self.version, "sha256": sha256_of(self.input_schema)}

    @cached_property
    def output_schema_ref(self) -> dict:
        return {"id": f"{self.key}-output", "version": self.version, "sha256": sha256_of(self.output_schema)}

    @cached_property
    def policies(self) -> dict:
        """执行与安全策略（SDD 10 §2.3）：只读 Module 首期默认值；代码而非提示词承载。"""
        return {
            "execution": {"timeoutSeconds": 300, "maxModelCalls": 30, "maxToolCalls": 30,
                          "maxKnowledgeRounds": 3, "maxParallelPlans": 2},
            "security": {"dataClass": "restricted", "networkPolicy": "tool-gateway-only",
                         "approvalPolicy": "none"},
        }

    @cached_property
    def logical_tools(self) -> list[dict]:
        return list(self.manifest.get("logicalTools") or [])

    def resolve_implementation(self, provider_kind: str) -> dict:
        impl = self.manifest["implementations"].get(provider_kind)
        if not impl:
            raise KeyError(f"module {self.key}@{self.version} 无 {provider_kind} 实现")
        return impl

    # ---------- Spec ----------

    def validate_spec(self, spec: dict) -> list[dict]:
        errors = sorted(self._spec_validator.iter_errors(spec),
                        key=lambda e: list(e.absolute_path))
        return [{"code": "SPEC_INVALID", "path": list(e.absolute_path), "message": e.message}
                for e in errors]

    def build_agent_spec(self, instance_config: dict | None) -> dict:
        """Module 默认 Spec + Agent 实例配置（模型/用途覆盖）→ 完整可冻结 AgentSpec。

        实例可覆盖 instructions 尾部补充与 model；criteria/tools/master_data 属于
        Module 版本资产，不允许实例改写（防止同 Module 版本语义漂移）。"""
        cfg = instance_config or {}
        spec = copy.deepcopy(self.default_spec)
        model_ref = cfg.get("modelRef") or {}
        spec["model"] = {
            "provider": str(model_ref.get("provider") or "openai-compatible"),
            "model": str(model_ref.get("modelId") or "unset"),
            "parameters": dict(model_ref.get("parameters") or {}),
        }
        extra = str(cfg.get("purpose") or "").strip()
        if extra:
            spec["instructions"] = f"{spec['instructions']}\n\n## 本实例业务定位\n{extra}"
        errors = self.validate_spec(spec)
        if errors:
            raise ValueError(f"AgentSpec 校验失败：{errors}")
        return spec

    # ---------- 运行映射 ----------

    def request_context(self, definition: dict) -> dict:
        """冻结的 AgentVersion.definition → Contract AgentExecutionSpec 组装字段。"""
        spec = definition.get("agentSpec") or {}
        return {
            "instructions": spec.get("instructions") or "",
            "model": spec.get("model") or {},
            "tools": [{"name": t["name"], "version": t["version"]} for t in spec.get("tools", [])],
            "master_data": [{"name": m["name"], "version": m["version"]}
                            for m in spec.get("master_data", [])],
            "output_schema": self.output_schema,
            "metadata": {"workflowMode": self.workflow_mode},
        }

    def map_result(self, agent_version, runtime_run) -> dict:
        """Provider 输出 → 领域结果投影（R2 返回质检结构化投影；QualityResult 落库在 R3）。

        质检分数由平台规则引擎派生——本映射只透传结构化结论，不计算 score。"""
        output = runtime_run.output or {}
        return {"module": {"key": self.key, "version": self.version},
                "agentVersionId": getattr(agent_version, "id", None),
                "criteria": output.get("criteria") or [],
                "insufficientEvidence": bool(output.get("insufficient_evidence")),
                "summary": output.get("summary") or ""}
