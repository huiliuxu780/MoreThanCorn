"""Unified Agent execution entry (task book §五-C).

Every Agent execution in MoreThanCorn — chat, single run, automation,
workflow node, AgentFlow node, agent-tool invocation, API trigger — goes
through this module. It only:

1. compiles the control-plane prompt sections into ONE system_prompt;
2. materializes published releases into immutable runtime AgentRecords;
3. resolves model credentials into runtime credentials (cached mapping,
   secrets never leave the server except inside TLS request bodies);
4. creates/resumes the official AgentScope Session per explicit policy;
5. records the platform index row (session ↔ trigger/business refs).

No Agent state, messages or scheduler live here.
"""
from __future__ import annotations

import hashlib
import json
import secrets as _pysecrets
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from . import agentscope_client as rt
from . import secret_ledger, secrets
from .models import (
    Agent,
    AgentSessionIndex,
    AgentVersion,
    Connection,
    MemoryRecord,
    Model,
    ModelProvider,
    Release,
)

CRED_SCOPE = "runtime:credential"


# ---------------------------------------------------------------------------
# prompt compilation (control plane)
# ---------------------------------------------------------------------------

PROMPT_SECTION_ORDER = ("identity", "bible", "persona")


def resources_manifest(cfg: dict[str, Any]) -> dict[str, Any]:
    """THE one resource manifest definition (P1-01 dedupe, P0-08 边界).

    agent_release.resources_manifest 重导出本函数。workflow_ids/agentflow_ids
    声明 Agent 被允许经内部 Tool 回调执行的 Workflow/AgentFlow（清单强制）。
    """
    return {
        "skill_ids": [
            s for s in (cfg.get("skills") or cfg.get("skill_ids") or [])
            if s not in set(cfg.get("skills_disabled") or [])
        ],
        "mcp_ids": list(cfg.get("mcps") or cfg.get("mcp_ids") or []),
        "tool_ids": list(cfg.get("tools") or cfg.get("tool_ids") or []),
        "knowledge_ids": list(cfg.get("knowledges") or cfg.get("knowledge_ids")
                              or cfg.get("default_knowledge_ids") or []),
        "workflow_ids": list(cfg.get("workflows") or cfg.get("workflow_ids") or []),
        "agentflow_ids": list(cfg.get("agentflows") or cfg.get("agentflow_ids") or []),
    }


def manifest_for_release(release) -> dict[str, Any]:
    """Return the release resource manifest, including frozen content snapshots (P1-8)."""
    binding = release.runtime_binding_snapshot or {}
    resources = binding.get("resources") or {}
    return {
        **resources,
        "_frozen_skills": binding.get("_frozen_skills") or {},
        "_frozen_mcps": binding.get("_frozen_mcps") or {},
        "_frozen_tools": binding.get("_frozen_tools") or {},
        "_frozen_knowledges": binding.get("_frozen_knowledges") or {},
    }


def compile_system_prompt(
    config: dict[str, Any], *, model_ref: dict | None = None
) -> tuple[str, str, str | None]:
    """Deterministically compile IDENTITY/BIBLE/PERSONA into one prompt.

    Module Agent: agentSpec.instructions is the real system prompt and MUST
    be included.  model_ref carries the frozen model key for downstream
    resolution (returned as third element so callers can lock the model).
    """
    parts: list[str] = []
    for key in PROMPT_SECTION_ORDER:
        text = (config.get(key) or "").strip()
        if text:
            parts.append(f"<{key}>\n{text}\n</{key}>")
    # P0-1  fix: Module Agent 的真正指令在 agentSpec.instructions
    agent_spec = config.get("agentSpec") or {}
    spec_instructions = (agent_spec.get("instructions") or "").strip()
    if spec_instructions:
        parts.append(spec_instructions)
    legacy = (config.get("rolePrompt") or config.get("system_prompt") or "").strip()
    if legacy and not parts:
        parts.append(legacy)
    compiled = "\n\n".join(parts) or "You are a helpful assistant."
    digest = hashlib.sha256(compiled.encode()).hexdigest()
    # frozen model key — resolve from explicit model_ref, then Module Agent's
    # agentSpec.model, then autonomous Agent's top-level modelRef.
    mref = (
        model_ref
        or (agent_spec.get("model") or None)
        or config.get("modelRef")
        or None
    )
    frozen_model_key = (mref or {}).get("model") if isinstance(mref, dict) else None
    if not frozen_model_key and isinstance(mref, dict):
        frozen_model_key = mref.get("modelId")  # autonomous agents use modelId
    return compiled, digest, frozen_model_key


# ---------------------------------------------------------------------------
# credential mapping
# ---------------------------------------------------------------------------

def runtime_credential_id(db: Session, user_id: str, model_id: str) -> str:
    """Map a platform Model to a runtime credential id (cached)."""
    model = db.get(Model, model_id)
    if model is None:
        raise ValueError(f"model {model_id} not found")
    provider = db.get(ModelProvider, model.provider_id)
    if provider is None or not provider.auth_connection_id:
        raise ValueError(f"model {model_id} has no auth connection")
    conn = db.get(Connection, provider.auth_connection_id)
    if conn is None:
        raise ValueError("auth connection missing")
    # 缓存键含 runtime user：AgentScope 凭据归属 owner，跨 owner 复用 id 会被
    # 官方 access.resolve_credential 404（归属一致性，P0-08）
    cache = (
        db.query(MemoryRecord)
        .filter_by(scope=CRED_SCOPE, key=f"{user_id}:{conn.id}")
        .first()
    )
    cached: dict = {}
    if cache and cache.value:
        try:
            cached = json.loads(cache.value)
        except (ValueError, TypeError):
            cached = {}
    if cached.get("credential_id"):
        return cached["credential_id"]
    env_code = conn.default_env or "default"
    rev = secret_ledger.current_revision(db, conn.id, env_code)
    if rev is None and conn.secret_ref:
        secret = secrets.decrypt_secret(conn.secret_ref)
    elif rev is not None:
        secret = secrets.decrypt_secret(rev.encrypted_payload)
    else:
        raise ValueError(f"connection {conn.id} has no secret")
    endpoint = conn.endpoint or {}
    base_url = endpoint.get("base_url") or ""
    cred_id = rt.ensure_credential(
        user_id, "dashscope_credential", secret, base_url
    )
    row = cache or MemoryRecord(scope=CRED_SCOPE, key=f"{user_id}:{conn.id}", value="")
    row.value = json.dumps({"credential_id": cred_id, "base_url": base_url})
    db.add(row)
    db.commit()
    return cred_id


# AgentScope ChatModelConfig.parameters is validated against the provider
# model's Parameters class (pydantic) — unknown keys raise at session/run
# time.  Whitelist = union of DashScope/OpenAI-chat Parameters fields in
# AgentScope 2.0.8.  Platform-only keys (timeout) are frozen separately.
# 09-11 权限策略：六开关组，默认全开（opt-out），发布时冻结进 release 快照
TOOL_POLICY_KEYS = ("shell", "file_write", "file_read", "schedule", "subagent", "platform_tools")


def resolve_permission_policy(raw: dict | None) -> dict:
    from .permission_seed import resolve_permission_policy as _resolve

    return _resolve(raw)


def normalize_tool_policy(raw: dict | None) -> dict[str, bool]:
    """缺省键视为开启——存量 Agent 行为不变。"""
    src = raw or {}
    return {k: bool(src.get(k, True)) for k in TOOL_POLICY_KEYS}


MODEL_PARAM_WHITELIST = frozenset({
    "temperature", "top_p", "top_k", "max_tokens",
    "thinking_enable", "thinking_budget", "reasoning_effort",
    "parallel_tool_calls",
})
EXEC_TIMEOUT_KEYS = ("timeout", "timeout_seconds", "request_timeout")


def split_model_params(raw: dict | None) -> tuple[dict, float | None]:
    """Split stored params into (AgentScope model parameters, exec timeout)."""
    params: dict = {}
    timeout: float | None = None
    for key, value in (raw or {}).items():
        if key in EXEC_TIMEOUT_KEYS:
            try:
                timeout = float(value)
            except (TypeError, ValueError):
                timeout = None
        elif key in MODEL_PARAM_WHITELIST and value is not None:
            params[key] = value
    return params, timeout


def chat_model_config(
    db: Session, user_id: str, model_id: str, *, extra_params: dict | None = None
) -> dict:
    """Live model config (chat-page explicit model selection).

    Parameters come from the platform Model's ``default_params`` plus caller
    overrides — never silently dropped (P0-02).  Release-bound execution must
    use :func:`chat_model_config_for_release` instead so the published
    snapshot, not live DB state, drives the SessionConfig.
    """
    model = db.get(Model, model_id)
    if model is None:
        raise ValueError(f"model {model_id} not found")
    merged = dict(model.default_params or {})
    merged.update(extra_params or {})
    params, _timeout = split_model_params(merged)
    return {
        "type": "dashscope_credential",
        "credential_id": runtime_credential_id(db, user_id, model_id),
        "model": model.model_key,
        "parameters": params,
    }


def chat_model_config_for_release(db: Session, user_id: str, release) -> dict:
    """Model config strictly from the release snapshot (P0-02/P0-03).

    ``materialize_release`` freezes ``frozen_model_id`` + ``frozen_model_params``
    at publish time; draft edits after publishing cannot drift an execution.
    A snapshot without a frozen model is a legacy artifact — callers must
    re-materialize (resolve_runtime_agent does this) before executing.
    """
    binding = release.runtime_binding_snapshot or {}
    model_id = binding.get("frozen_model_id")
    if not model_id:
        raise ValueError(
            f"release {release.id} has no frozen model; re-materialize required"
        )
    model = db.get(Model, model_id)
    if model is None:
        raise ValueError(
            f"release {release.id} frozen model {model_id} no longer exists"
        )
    params, _timeout = split_model_params(binding.get("frozen_model_params") or {})
    return {
        "type": "dashscope_credential",
        "credential_id": runtime_credential_id(db, user_id, model_id),
        "model": model.model_key,
        "parameters": params,
    }


# ---------------------------------------------------------------------------
# knowledge base sync
# ---------------------------------------------------------------------------

class KnowledgeUnavailableError(RuntimeError):
    """Knowledge provider/registration unavailable — fail closed (P0-01).

    Raised when the AgentScope KnowledgeBase for a platform KnowledgeSource
    cannot be created or looked up (missing embedding credential, runtime
    down, provider misconfiguration).  NEVER substitute a synthetic id: a
    fabricated ``kb_*`` id would be a forged runtime fact.
    """


DEFAULT_EMBEDDING_DIMENSIONS = 1024  # text-embedding-v3 default


def _ensure_knowledge_base(
    db: Session, user_id: str, ks
) -> str:
    """Create or look up the AgentScope KnowledgeBase for a platform KnowledgeSource.

    Returns the REAL AgentScope runtime KB id (not the platform KnowledgeSource
    id, never a synthetic id).  Idempotent via the official list endpoint with
    a deterministic name.  Any failure raises KnowledgeUnavailableError so the
    caller blocks publish / keeps the KB unmounted.
    """
    # EmbeddingModelConfig mirrors ChatModelConfig: type/credential_id/model/
    # dimensions are ALL required by the official API (2.0.8).  The previous
    # payload omitted credential_id+dimensions, so creation always failed and
    # the exception was masked by a synthetic id (P0-01 root cause).
    if not ks.embedding_model_id:
        raise KnowledgeUnavailableError(
            f"KnowledgeSource {ks.id} ({ks.name}) 未配置 embedding 模型，"
            "Knowledge Provider 不可用"
        )
    try:
        credential_id = runtime_credential_id(db, user_id, ks.embedding_model_id)
    except ValueError as exc:
        raise KnowledgeUnavailableError(
            f"KnowledgeSource {ks.name} embedding 凭据不可用：{exc}"
        ) from exc
    emb_model = db.get(Model, ks.embedding_model_id)
    dimensions = int(
        (emb_model.default_params or {}).get("dimensions")
        or DEFAULT_EMBEDDING_DIMENSIONS
    )
    embedding_cfg = {
        "type": "dashscope_credential",
        "credential_id": credential_id,
        "model": emb_model.model_key,
        "dimensions": dimensions,
    }
    kb_name = f"mtc-{ks.id[:12]}-{ks.name[:32]}"
    # idempotent: official lookup first so re-materialize reuses the same KB
    try:
        existing = rt.list_knowledge_bases(user_id)
    except Exception as exc:  # noqa: BLE001
        raise KnowledgeUnavailableError(
            f"AgentScope Knowledge 注册链不可达（list 失败）：{exc!r}"
        ) from exc
    for row in existing:
        data = row.get("data") or row
        if data.get("name") == kb_name:
            real_id = row.get("id") or data.get("id")
            if real_id:
                return real_id
    try:
        runtime_kb_id = rt.create_knowledge_base(user_id, kb_name, embedding_cfg)
    except Exception as exc:  # noqa: BLE001
        raise KnowledgeUnavailableError(
            f"AgentScope KnowledgeBase 创建失败（name={kb_name}）：{exc!r}"
        ) from exc
    if not runtime_kb_id:
        raise KnowledgeUnavailableError(
            f"AgentScope KnowledgeBase 创建未返回真实 ID（name={kb_name}）"
        )
    return runtime_kb_id


# ---------------------------------------------------------------------------
# release materialization
# ---------------------------------------------------------------------------

def materialize_release(
    db: Session, user_id: str, release: Release
) -> str:
    """Publish = immutable runtime AgentRecord from the version snapshot."""
    version = db.get(AgentVersion, release.agent_version_id)
    agent = db.get(Agent, release.agent_id)
    definition = version.definition or {}
    compiled, digest, frozen_model_key = compile_system_prompt(
        definition, model_ref=definition.get("modelRef")
    )
    binding = release.runtime_binding_snapshot or {}
    runtime_agent_id = binding.get("agentscope_agent_id")
    cfg = {
        "react_config": definition.get("react_config"),
        "context_config": definition.get("context_config"),
    }
    # P0-02/P0-03: freeze model id + parameters + exec timeout at publish time
    # so every execution (chat/fresh run/schedule/Workflow node/AgentFlow node)
    # reads the SAME snapshot; draft edits afterwards cannot drift a release.
    model_row = None
    if frozen_model_key:
        model_row = (
            db.query(Model).filter_by(model_key=frozen_model_key).first()
            or db.get(Model, frozen_model_key)
        )
    if model_row is None:
        # no explicit frozen key (e.g. dialogue agents): freeze the default at
        # publish time instead of resolving live at every execution
        cfg_default = (agent.config or {}).get("default_model_id")
        if cfg_default:
            model_row = db.get(Model, cfg_default)
        if model_row is None:
            model_row = (
                db.query(Model).filter_by(enabled=True).order_by(Model.id).first()
            )
    if model_row is None:
        raise ValueError(
            "MODEL_UNFROZEN：发布时无法解析可用模型，禁止发布后运行期回退漂移"
        )
    frozen_model_id = model_row.id
    ref_params: dict = {}
    mref = definition.get("modelRef") or {}
    if isinstance(mref, dict):
        ref_params = dict(mref.get("params") or mref.get("parameters") or {})
    spec_model = (definition.get("agentSpec") or {}).get("model") or {}
    if isinstance(spec_model, dict):
        ref_params = {
            **ref_params,
            **(spec_model.get("params") or spec_model.get("parameters") or {}),
        }
    frozen_params, frozen_exec_timeout = split_model_params(
        {**(model_row.default_params or {}), **ref_params}
    )
    resources = (version.definition or {}).get("resources") or resources_manifest(
        agent.config or {}
    )
    # P1-8: freeze resource content snapshots so release is truly immutable
    from .models import (
        KnowledgeSource as _KnowledgeSource,
        McpServer as _McpServer,
        SkillResource as _SkillResource,
        Tool as _Tool,
        ToolVersion as _ToolVersion,
    )
    frozen_skills: dict[str, dict] = {}
    for skill_id in resources.get("skill_ids") or []:
        skill = db.get(_SkillResource, skill_id)
        if skill:
            frozen_skills[skill_id] = {
                "name": skill.name,
                "content": skill.content or "",
                "content_digest": hashlib.sha256(
                    (skill.content or "").encode()
                ).hexdigest(),
            }
    frozen_mcps: dict[str, dict] = {}
    for mcp_id in resources.get("mcp_ids") or []:
        mcp = db.get(_McpServer, mcp_id)
        if mcp and mcp.connection_id:
            conn = db.get(Connection, mcp.connection_id)
            if conn:
                endpoint = conn.endpoint or {}
                frozen_mcps[mcp_id] = {
                    "name": mcp.name,
                    "transport": mcp.transport or "http",
                    "url": endpoint.get("base_url") or endpoint.get("url") or "",
                }
    frozen_tools: dict[str, dict] = {}
    for tool_id in resources.get("tool_ids") or []:
        tv = (
            db.query(_ToolVersion)
            .filter_by(tool_id=tool_id, status="ready")
            .order_by(_ToolVersion.version_no.desc())
            .first()
        )
        if tv:
            frozen_tools[tool_id] = {
                "tool_version_id": tv.id,
                "version_no": tv.version_no,
            }
    frozen_knowledges: dict[str, dict] = {}
    for kid in resources.get("knowledge_ids") or []:
        ks = db.get(_KnowledgeSource, kid)
        if not ks:
            continue
        if ks.status != "enabled":
            # 显式降级策略：停用的 KnowledgeSource 不注册、不挂载、留痕
            frozen_knowledges[kid] = {
                "name": ks.name,
                "status": ks.status,
                "runtime_kb_id": None,
                "mount_status": "disabled",
            }
            continue
        # P0-01: registration is fail-closed.  A missing embedding credential
        # or unreachable runtime BLOCKS publish instead of forging a kb_* id.
        try:
            runtime_kb_id = _ensure_knowledge_base(db, user_id, ks)
        except KnowledgeUnavailableError as exc:
            raise ValueError(
                f"KNOWLEDGE_PROVIDER_UNAVAILABLE：Agent 引用的知识库 {ks.name} "
                f"无法注册到 AgentScope，发布已阻止。{exc}"
            ) from exc
        frozen_knowledges[kid] = {
            "name": ks.name,
            "status": ks.status,
            "runtime_kb_id": runtime_kb_id,
            "mount_status": "mounted",
        }
    # AgentRecord create/update happens LAST: the failure-prone freezes
    # (model resolution, Knowledge registration) run first so a blocked
    # publish does not leave orphan runtime AgentRecords behind.
    if runtime_agent_id:
        try:
            rt.get_agent(user_id, runtime_agent_id)
            rt.update_agent(
                user_id,
                runtime_agent_id,
                name=agent.name,
                system_prompt=compiled,
                **{k: v for k, v in cfg.items() if v},
            )
        except rt.RuntimeError_:
            runtime_agent_id = None
    if not runtime_agent_id:
        runtime_agent_id = rt.create_agent(
            user_id, agent.name, compiled, **{k: v for k, v in cfg.items() if v}
        )
    release.runtime_binding_snapshot = {
        **binding,
        "agentscope_agent_id": runtime_agent_id,
        "owner": user_id,
        "prompt_digest": digest,
        "frozen_model_id": frozen_model_id,
        "frozen_model_key": model_row.model_key,
        "frozen_model_params": frozen_params,
        "frozen_tool_policy": normalize_tool_policy(
            (version.definition or {}).get("permissions")
        ),
        "frozen_permission_policy": resolve_permission_policy(
            (version.definition or {}).get("permissions")
        ),
        "frozen_exec_timeout_seconds": frozen_exec_timeout,
        "resources": resources,
        "_frozen_skills": frozen_skills,
        "_frozen_mcps": frozen_mcps,
        "_frozen_tools": frozen_tools,
        "_frozen_knowledges": frozen_knowledges,
        "materialized_at": datetime.now(timezone.utc).isoformat(),
    }
    db.commit()
    return runtime_agent_id


EXECUTION_ENVIRONMENTS = ("prod", "sandbox")


def resolve_runtime_agent(
    db: Session, user_id: str, agent: Agent, *, environment: str
) -> tuple[str, Release]:
    """Runtime agent id for execution: the active release of ONE environment.

    P0-04: environment is an explicit, required choice — prod executions only
    ever select the prod release, sandbox only sandbox.  No lexicographic
    ordering, no silent cross-environment downgrade: a missing release in the
    requested environment is a hard error telling the caller to publish.
    """
    if environment not in EXECUTION_ENVIRONMENTS:
        raise ValueError(
            f"environment must be one of {EXECUTION_ENVIRONMENTS}, got {environment!r}"
        )
    release = (
        db.query(Release)
        .filter_by(agent_id=agent.id, status="active", environment=environment)
        .order_by(Release.created_at.desc())
        .first()
    )
    if release is None:
        raise ValueError(
            f"agent {agent.id} has no active {environment} release; "
            f"publish to {environment} first（禁止跨环境静默降级）"
        )
    binding = release.runtime_binding_snapshot or {}
    runtime_agent_id = binding.get("agentscope_agent_id")
    if not runtime_agent_id or "frozen_model_params" not in binding:
        # missing AgentRecord, or a legacy (pre-P0-02) snapshot without frozen
        # model params — re-materialize once so executions never read live
        # draft state through an old snapshot
        runtime_agent_id = materialize_release(db, user_id, release)
    return runtime_agent_id, release


# ---------------------------------------------------------------------------
# session policy + index
# ---------------------------------------------------------------------------

def default_model_id(db: Session, agent: Agent, release: Release | None = None) -> str:
    # P0-1: 发布快照冻结的模型优先（防止发布后修改 agent.config 导致漂移）
    if release:
        frozen = (release.runtime_binding_snapshot or {}).get("frozen_model_id")
        if frozen:
            return frozen
    config = agent.config or {}
    model_id = config.get("default_model_id")
    if model_id:
        return model_id
    first = db.query(Model).filter_by(enabled=True).order_by(Model.id).first()
    if first is None:
        raise ValueError("no enabled model configured")
    return first.id


def start_session(
    db: Session,
    user_id: str,
    agent: Agent,
    *,
    trigger_kind: str,
    environment: str = "prod",
    policy: str = "fresh",
    conversation_key: str | None = None,
    automation_id: str | None = None,
    trigger_log_id: str | None = None,
    workflow_run_id: str | None = None,
    agentflow_run_id: str | None = None,
    agentflow_node_run_id: str | None = None,
    release_override: Release | None = None,
    model_override: dict | None = None,
) -> AgentSessionIndex:
    """Create or resume the official Session per explicit policy.

    ``environment`` selects which release the execution binds to (P0-04);
    "prod" is the product execution default — sandbox runs must ask for it
    explicitly.  The model config always comes from the release snapshot
    (P0-02), never from live draft state.
    """
    # 09-16 封存执行面闸门：新会话拦 archived（调用方 ValueError→422）
    if agent.archived:
        raise ValueError("AGENT_ARCHIVED: 已封存 Agent 不可开启新会话；先解封")
    if release_override is not None:
        # an explicitly pinned release (e.g. run.runtime_snapshot.releaseId) —
        # the caller already chose; do not re-resolve to a different one
        release = release_override
        binding = release.runtime_binding_snapshot or {}
        runtime_agent_id = binding.get("agentscope_agent_id")
        if not runtime_agent_id or "frozen_model_params" not in binding:
            runtime_agent_id = materialize_release(db, user_id, release)
    else:
        runtime_agent_id, release = resolve_runtime_agent(
            db, user_id, agent, environment=environment
        )
    # 运行时对象归属一致性：AgentRecord/凭据/Session 都活在发布物化时的 owner
    # 名下；以调用者身份操作他人 owner 的运行时对象会被官方 access 层 404。
    runtime_uid = (release.runtime_binding_snapshot or {}).get("owner") or user_id
    model_cfg = chat_model_config_for_release(db, runtime_uid, release)
    # 09-16 对比弹窗（模型对比）：test-only 模型覆盖，仅覆盖 model 键，
    # 其余冻结参数不动；非 test 触发由调用方闸门忽略该参数
    if model_override:
        model_cfg = {**model_cfg, **model_override}
    knowledge_ids = (agent.config or {}).get("default_knowledge_ids") or []

    if policy == "conversation" and conversation_key:
        existing = (
            db.query(AgentSessionIndex)
            .filter_by(agent_id=agent.id, conversation_key=conversation_key)
            .order_by(AgentSessionIndex.created_at.desc())
            .first()
        )
        if existing:
            return existing
    if policy == "stateful" and automation_id:
        existing = (
            db.query(AgentSessionIndex)
            .filter_by(automation_id=automation_id, trigger_kind="schedule")
            .order_by(AgentSessionIndex.created_at.desc())
            .first()
        )
        if existing:
            return existing

    manifest = manifest_for_release(release)
    knowledge_ids = manifest.get("knowledge_ids") or knowledge_ids
    # P0-01: translate platform KnowledgeSource ids → REAL AgentScope KB ids
    # from the frozen snapshot.  Never pass a platform id (or a leftover
    # synthetic "kb_<platform id>") to AgentScope — unresolvable entries stay
    # unmounted instead of forging an attachment.
    frozen_kbs = manifest.get("_frozen_knowledges") or {}
    runtime_kb_ids: list[str] = []
    for kid in knowledge_ids:
        fk = frozen_kbs.get(kid) or {}
        runtime_kb_id = fk.get("runtime_kb_id")
        if (
            not runtime_kb_id
            or runtime_kb_id == kid              # 平台 KS id 直传（旧兼容降级）
            or runtime_kb_id == f"kb_{kid}"      # 旧 synthetic 伪造 id
        ):
            continue  # disabled / unregistered → unmounted, never forged
        if fk.get("mount_status") == "disabled":
            continue
        runtime_kb_ids.append(runtime_kb_id)
    # P0-08: per-session internal Tool callback token — runtime carries the
    # raw value, platform stores only the sha256 hash on the index row.
    internal_token = _pysecrets.token_urlsafe(32)
    session_id = rt.create_session(
        runtime_uid, runtime_agent_id, model_cfg, runtime_kb_ids,
        internal_token=internal_token,
    )
    # P1-8: prefer frozen resource snapshots from the release; fall back to
    # live DB reads only for releases materialized before the freeze was added.
    frozen_skills = manifest.get("_frozen_skills") or {}
    frozen_mcps = manifest.get("_frozen_mcps") or {}

    for skill_id in manifest.get("skill_ids") or []:
        fs = frozen_skills.get(skill_id)
        if fs:
            rt.upload_workspace_skill(
                runtime_uid,
                runtime_agent_id,
                session_id,
                root=fs["name"],
                parts=[("SKILL.md", fs["content"].encode("utf-8"))],
            )
            continue
        # fallback: read live Skill content (pre-P1-8 release)
        from .models import SkillResource as _SkillResource
        skill = db.get(_SkillResource, skill_id)
        if skill is None:
            raise ValueError(f"Release 清单 Skill {skill_id} 不存在")
        rt.upload_workspace_skill(
            runtime_uid,
            runtime_agent_id,
            session_id,
            root=skill.name,
            parts=[("SKILL.md", (skill.content or "").encode("utf-8"))],
        )
    for mcp_id in manifest.get("mcp_ids") or []:
        fm = frozen_mcps.get(mcp_id)
        if fm:
            rt.add_workspace_mcp(
                runtime_uid,
                runtime_agent_id,
                session_id,
                {"name": fm["name"], "is_stateful": False,
                 "mcp_config": {"type": "http_mcp", "url": fm["url"]}},
            )
            continue
        # fallback: read live MCP connection (pre-P1-8 release)
        from .models import McpServer as _McpServer, Connection as _Conn
        mcp = db.get(_McpServer, mcp_id)
        if mcp is None:
            raise ValueError(f"Release 清单 MCP {mcp_id} 不存在")
        if mcp.transport != "http" or not mcp.connection_id:
            raise ValueError(f"MCP {mcp.name} 非 http 接入，暂不支持 Workspace 装配")
        conn = db.get(_Conn, mcp.connection_id)
        endpoint = (conn.endpoint or {}) if conn else {}
        url = endpoint.get("base_url") or endpoint.get("url") or ""
        if not url:
            raise ValueError(f"MCP {mcp.name} 连接缺少 base_url")
        rt.add_workspace_mcp(
            runtime_uid,
            runtime_agent_id,
            session_id,
            {"name": mcp.name, "is_stateful": False,
             "mcp_config": {"type": "http_mcp", "url": url}},
        )
    row = AgentSessionIndex(
        session_id=session_id,
        # runtime owner（会话操作以此身份连运行时；平台鉴权仍走 require_role）
        user_id=runtime_uid,
        agent_id=agent.id,
        runtime_agent_id=runtime_agent_id,
        session_token_hash=hashlib.sha256(internal_token.encode()).hexdigest(),
        release_id=release.id if release else None,
        trigger_kind=trigger_kind,
        automation_id=automation_id,
        trigger_log_id=trigger_log_id,
        workflow_run_id=workflow_run_id,
        agentflow_run_id=agentflow_run_id,
        agentflow_node_run_id=agentflow_node_run_id,
        conversation_key=conversation_key,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def run_into_existing_run(
    db: Session,
    run,
    agent,
    run_input: dict,
    *,
    timeout_seconds: float = 600.0,
) -> None:
    """批量/业务链复用既有 Run 行的统一执行入口（审核 P0-3）。

    Release 解析 → 物化 → 新建 AgentScope Session（索引固化绑定）→
    结构化执行（Module outputSchema）→ 回写 Run → 业务结算。
    不再依赖 Runtime Provider。"""
    import json as _json

    from .agent_modules import registry as module_registry
    from .models import Release as _Release

    snap_release_id = (run.runtime_snapshot or {}).get("releaseId")
    release = db.get(_Release, snap_release_id) if snap_release_id else None
    if release is None or release.status != "active":
        # P0-04: batch/business runs are prod executions — only the prod
        # release may be picked up when the run was not explicitly pinned.
        release = (
            db.query(_Release)
            .filter_by(agent_id=agent.id, status="active", environment="prod")
            .order_by(_Release.created_at.desc())
            .first()
        )
    if release is None:
        run.status = "failed"
        run.error = {
            "message": "NO_RELEASED_VERSION：Agent 无 active prod Release，"
            "运行只认发布快照（禁止跨环境静默降级）"
        }
        db.commit()
        return
    binding = release.runtime_binding_snapshot or {}
    if not binding.get("agentscope_agent_id") or "frozen_model_params" not in binding:
        materialize_release(db, run.user_id if hasattr(run, "user_id") else "system", release)
    schema = {"type": "object", "properties": {"content": {"type": "string"}},
              "required": ["content"]}
    if agent.module_key:
        try:
            schema = module_registry.get(agent.module_key, agent.module_version).output_schema
        except Exception:  # noqa: BLE001
            pass
    binding = release.runtime_binding_snapshot or {}
    runtime_uid = binding.get("owner") or "system"
    frozen_timeout = binding.get("frozen_exec_timeout_seconds")
    if frozen_timeout:
        timeout_seconds = float(frozen_timeout)
    index = start_session(
        db,
        runtime_uid,
        agent,
        trigger_kind="batch",
        release_override=release,
    )
    runtime_agent_id = index.runtime_agent_id or binding.get("agentscope_agent_id")
    try:
        result = rt.structured_run(
            runtime_uid,
            runtime_agent_id,
            _json.dumps(run_input or {}, ensure_ascii=False)[:6000],
            schema,
            session_id=index.session_id,
            timeout_seconds=timeout_seconds,
        )
    except Exception as exc:  # noqa: BLE001
        run.status = "failed"
        run.error = {"message": repr(exc)}
        db.commit()
        return
    run.status = "succeeded"
    run.output = result.get("structured_output") or {"content": result.get("text", "")}
    run.agentscope_session_id = index.session_id  # P0-07 专名列，不再借 provider 字段
    run.agent_version_id = release.agent_version_id
    db.commit()
    from types import SimpleNamespace

    # P0-07: settlement lives in the neutral business module, not in the
    # retired runtime-provider worker.
    from .run_settlement import settle_module_result

    settle_module_result(db, run, SimpleNamespace(trace=[], output=run.output))


def render_prompt(template: str, payload: dict[str, Any]) -> str:
    """{{field}} / {{nested.field}} / {{items[0].name}} substitution."""
    import re

    def repl(match: re.Match) -> str:
        path = match.group(1)
        cur: Any = payload
        for part in re.split(r"\.|\[(\d+)\]", path):
            if part is None or part == "":
                continue
            if isinstance(cur, list):
                try:
                    cur = cur[int(part)]
                except (IndexError, ValueError):
                    return match.group(0)
            elif isinstance(cur, dict):
                if part not in cur:
                    return match.group(0)
                cur = cur[part]
            else:
                return match.group(0)
        return json.dumps(cur, ensure_ascii=False) if not isinstance(cur, str) else cur

    rendered = re.sub(r"\{\{([^}]+)\}\}", repl, template or "")
    if "{{" not in rendered and template:
        return rendered
    return rendered


def run_turn(
    db: Session,
    user_id: str,
    agent: Agent,
    text: str,
    *,
    trigger_kind: str,
    environment: str = "prod",
    index: AgentSessionIndex | None = None,
    **session_kwargs: Any,
) -> AgentSessionIndex:
    index = index or start_session(
        db, user_id, agent, trigger_kind=trigger_kind,
        environment=environment, model_override=model_override,
        **session_kwargs
    )
    runtime_agent_id = index.runtime_agent_id or resolve_runtime_agent(
        db, user_id, agent, environment=environment
    )[0]
    rt.chat_trigger(index.user_id, runtime_agent_id, index.session_id, text)
    return index


def run_structured(
    db: Session,
    user_id: str,
    agent: Agent,
    text: str,
    schema: dict,
    *,
    trigger_kind: str,
    environment: str = "prod",
    index: AgentSessionIndex | None = None,
    timeout_seconds: float = 300.0,
    model_override: dict | None = None,
    **session_kwargs: Any,
) -> tuple[AgentSessionIndex, dict]:
    # P1-01: single resolution pass (the duplicated resolve lines were removed)
    _runtime_agent_id, rel = resolve_runtime_agent(
        db, user_id, agent, environment=environment
    )
    owner = (rel.runtime_binding_snapshot or {}).get("owner")
    if owner:
        user_id = owner
    index = index or start_session(
        db, user_id, agent, trigger_kind=trigger_kind,
        environment=environment, **session_kwargs
    )
    runtime_agent_id = index.runtime_agent_id or _runtime_agent_id
    binding = rel.runtime_binding_snapshot or {}
    if binding.get("frozen_exec_timeout_seconds"):
        timeout_seconds = float(binding["frozen_exec_timeout_seconds"])
    result = rt.structured_run(
        index.user_id,
        runtime_agent_id,
        text,
        schema,
        session_id=index.session_id,
        timeout_seconds=timeout_seconds,
    )
    return index, result
