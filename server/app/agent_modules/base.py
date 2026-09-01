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

    @property
    def requires_rule_version(self) -> bool:
        """Whether every run must be bound to one immutable ResultRuleVersion."""
        return bool(self.manifest.get("requiresRuleVersion", False))

    @property
    def produces_quality_result(self) -> bool:
        """Whether a successful run is projected into QualityResult/Evidence."""
        return bool(self.manifest.get("producesQualityResult", False))

    @property
    def result_projection(self) -> str:
        return str(self.manifest.get("resultProjection") or "DomainResult")

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

    @cached_property
    def runtime_context(self) -> dict:
        """Load reviewed, code-owned context assets declared by the Module.

        Only relative JSON files inside the Module directory are accepted.  This keeps
        runtime context versioned with the Module and prevents a manifest from reading
        arbitrary host files.
        """
        metadata = copy.deepcopy(self.manifest.get("runtimeMetadata") or {})
        for item in self.manifest.get("runtimeContextAssets") or []:
            key = str(item.get("key") or "").strip()
            rel = str(item.get("path") or "").strip()
            if not key or not rel:
                raise ValueError(f"module {self.key}@{self.version} runtimeContextAssets 格式错误")
            path = (self.dir / rel).resolve()
            try:
                path.relative_to(self.dir.resolve())
            except ValueError as exc:
                raise ValueError(f"module runtime context 禁止越过模块目录: {rel}") from exc
            metadata[key] = json.loads(path.read_text(encoding="utf-8"))
        return metadata

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
        metadata = copy.deepcopy(self.runtime_context)
        metadata["workflowMode"] = self.workflow_mode
        return {
            "instructions": spec.get("instructions") or "",
            "model": spec.get("model") or {},
            "tools": [{"name": t["name"], "version": t["version"]} for t in spec.get("tools", [])],
            "master_data": [{"name": m["name"], "version": m["version"]}
                            for m in spec.get("master_data", [])],
            "output_schema": self.output_schema,
            "metadata": metadata,
        }

    def validate_output_semantics(self, output: dict, runtime_context: dict) -> list[dict]:
        """Validate cross-field invariants which JSON Schema cannot express.

        The frozen-rule result contract requires exact, ordered coverage of the
        snapshot and an identical ``result_by_rule`` projection.  It intentionally
        rejects model-produced scores; the output Schema already rejects unknown
        top-level fields such as ``score``.
        """
        contract = self.manifest.get("outputContract")
        run_input = (runtime_context or {}).get("input") or {}
        call_id = ((run_input.get("call") or {}).get("acid")
                   if isinstance(run_input, dict) else None)
        known_indexes = {m.get("index") for m in run_input.get("messages") or []
                         if isinstance(m, dict)} if isinstance(run_input, dict) else set()
        if contract == "consumer-analysis-v1":
            issues: list[dict] = []
            if output.get("call_id") != call_id:
                issues.append({"code": "CALL_ID_MISMATCH", "path": ["call_id"],
                               "message": "call_id 与输入 call.acid 不一致"})
            previous_end = -1
            for position, segment in enumerate(output.get("segments") or [], start=1):
                if segment.get("segment_id") != f"segment-{position}":
                    issues.append({"code": "SEGMENT_ORDER_INVALID", "path": ["segments", position - 1],
                                   "message": "segment_id 必须连续且按顺序编号"})
                start, end = segment.get("start_index"), segment.get("end_index")
                if not isinstance(start, int) or not isinstance(end, int) or start > end \
                        or start <= previous_end or start not in known_indexes or end not in known_indexes:
                    issues.append({"code": "SEGMENT_RANGE_INVALID", "path": ["segments", position - 1],
                                   "message": "片段必须有序、不重叠且边界引用已知消息"})
                if isinstance(end, int):
                    previous_end = end
                evidence_indexes = set(segment.get("evidence_message_indexes") or [])
                if not evidence_indexes.issubset(known_indexes):
                    issues.append({"code": "EVIDENCE_INDEX_INVALID", "path": ["segments", position - 1],
                                   "message": "片段证据引用了未知消息"})
                for entity in segment.get("entities") or []:
                    if not set(entity.get("evidence_message_indexes") or []).issubset(known_indexes):
                        issues.append({"code": "ENTITY_EVIDENCE_INVALID", "path": ["segments", position - 1, "entities"],
                                       "message": "实体证据引用了未知消息"})
            return issues
        if contract != "frozen-rule-results-v1":
            return []
        snapshot = (runtime_context or {}).get("rule_snapshot") or {}
        expected = [r.get("id") for r in snapshot.get("evaluationRules") or []]
        actual = [r.get("rule_id") for r in output.get("results") or []
                  if isinstance(r, dict)]
        issues: list[dict] = []
        if output.get("call_id") != call_id:
            issues.append({"code": "CALL_ID_MISMATCH", "path": ["call_id"],
                           "message": "call_id 与输入 call.acid 不一致"})
        if not expected:
            issues.append({"code": "RULE_SNAPSHOT_EMPTY", "path": ["context", "rule_snapshot"],
                           "message": "冻结规则快照没有 evaluationRules"})
        elif actual != expected:
            issues.append({"code": "RULE_COVERAGE_MISMATCH", "path": ["results"],
                           "message": "results 必须按冻结快照顺序对每条规则恰好输出一次"})
        projection = {r.get("rule_id"): r.get("result") for r in output.get("results") or []
                      if isinstance(r, dict)}
        if output.get("result_by_rule") != projection:
            issues.append({"code": "RULE_PROJECTION_MISMATCH", "path": ["result_by_rule"],
                           "message": "result_by_rule 必须与 results 完全一致"})
        if output.get("rule_set_id") != snapshot.get("ruleSetId"):
            issues.append({"code": "RULE_SET_MISMATCH", "path": ["rule_set_id"],
                           "message": "rule_set_id 与冻结快照不一致"})
        if output.get("rule_set_version") != snapshot.get("ruleSetVersion"):
            issues.append({"code": "RULE_VERSION_MISMATCH", "path": ["rule_set_version"],
                           "message": "rule_set_version 与冻结快照不一致"})
        for result_pos, result in enumerate(output.get("results") or []):
            for evidence in result.get("evidence") or []:
                if not set(evidence.get("message_indexes") or []).issubset(known_indexes):
                    issues.append({"code": "EVIDENCE_INDEX_INVALID",
                                   "path": ["results", result_pos, "evidence"],
                                   "message": "质检证据引用了未知消息"})
        return issues

    def map_result(self, agent_version, runtime_run) -> dict:
        """Provider 输出 → 领域结果投影（quality_output：findings[] 为逐 criterion 结论）。

        质检分数由平台规则引擎派生——本映射只透传结构化结论，不计算 score。"""
        output = runtime_run.output or {}
        findings = output.get("findings") or []
        if not findings and isinstance(output.get("results"), list):
            findings = [{"criterion": r.get("rule_id"), "status": r.get("result"),
                         "confidence": r.get("confidence"), "reason": r.get("reason"),
                         "evidence": r.get("evidence") or []}
                        for r in output["results"] if isinstance(r, dict)]
        return {"module": {"key": self.key, "version": self.version},
                "agentVersionId": getattr(agent_version, "id", None),
                "criteria": [{"id": f.get("criterion"), "status": f.get("status"),
                              "confidence": f.get("confidence"), "reason": f.get("reason"),
                              "evidence": f.get("evidence")} for f in findings
                             if isinstance(f, dict)],
                "labels": output.get("labels") or {},
                "insufficientEvidence": any(
                    f.get("status") == "insufficient_evidence" for f in findings
                    if isinstance(f, dict)),
                "summary": output.get("summary") or ""}
