"""Connection 请求校验（替换路由层裸 dict，09 硬化延续）。

kind 真实枚举：none|api_key|bearer|basic|aksk|script（旧人类可读串自动归一化）。
environments：预置 dev/test/pre/prod 四槽 + 可自定义；条目可按环境覆盖 endpoint 与凭据。

SDD-12 P0 修复轮（验收 A-03/B-03/C-04）：
- 创建路径用 `EnvEntry`（含 secret，初始落库）；
- 更新路径用 `EnvPatch`（patch 语义：按 code 更新/`remove` 删除，**不接受任何
  secret 字段**，extra=forbid）——凭据写入/清除一律走 `secret:rotate` /
  `secret:clear` 高危端点（含确认词与依赖检查）；
- `validate_secret_structure` 为创建与 rotate 共用的结构化凭据校验。
"""
from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .auth_signers import KINDS, normalize_kind

PROTOCOLS = ("http-api", "llm", "mcp-http", "mysql", "postgresql", "oss")
_ENV_CODE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,15}$")


def validate_secret_structure(kind: str, secret) -> None:
    """创建与轮换共用的凭据结构校验（SDD-12 修复轮）：

    aksk 必须为含 access_key+secret_key 的对象；basic 必须为含 username 的对象。
    防止把有效结构化凭据轮换/创建为签名器无法使用的普通字符串。非法抛 ValueError。
    """
    if secret in (None, "", {}):
        return  # 是否必填由调用方决定
    if kind == "aksk":
        if not isinstance(secret, dict) or not secret.get("access_key") or not secret.get("secret_key"):
            raise ValueError("aksk 密钥须为含 access_key 与 secret_key 的对象")
    elif kind == "basic":
        if not isinstance(secret, dict) or not secret.get("username"):
            raise ValueError("basic 密钥须为含 username 的对象")


def _validate_env_codes(codes: list[str]) -> None:
    if len(codes) != len(set(codes)):
        raise ValueError("环境码重复")
    for code in codes:
        if not _ENV_CODE_RE.match(code):
            raise ValueError(f"环境码非法：{code}（小写字母/数字开头，≤16 位）")


class EnvEntry(BaseModel):
    """创建路径的环境条目（允许随创建提供初始凭据）。"""
    code: str
    label: str = ""
    endpoint: dict = Field(default_factory=dict)
    secret: str | dict | None = None  # 明文入参；服务端加密为 secret_ref，永不原样落库/回显


class EnvPatch(BaseModel):
    """更新路径的环境条目（SDD-12 修复轮 / B-03）。

    仅 patch 语义：按 code 更新，`remove=true` 删除该环境。
    未提交的环境整体保留（含密钥，A-03）；secret/clearSecret 等字段一律拒绝
    （extra=forbid），凭据写入/清除只能走 secret:rotate / secret:clear。

    字段级缺省（二次验收修复）：`label` / `endpoint` 为 `None` 表示**未提交**，
    服务端保留存量值；只有请求实际携带（命中 `model_fields_set`）的字段才覆盖。
    这样"只改 label"不会把省略的 endpoint 清空为 `{}`。
    """
    model_config = ConfigDict(extra="forbid")

    code: str
    label: str | None = None
    endpoint: dict | None = None
    remove: bool = False


class ConnectionBase(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    kind: str = "api_key"
    protocol: str = "http-api"
    endpoint: dict = Field(default_factory=dict)
    environments: list[EnvEntry] = Field(default_factory=list)
    default_env: str | None = None
    auth_script: str | None = Field(default=None, max_length=20000)
    providerHint: str = ""
    secret: str | dict | None = None

    @field_validator("kind")
    @classmethod
    def _kind(cls, v: str) -> str:
        return normalize_kind(v)

    @field_validator("protocol")
    @classmethod
    def _protocol(cls, v: str) -> str:
        if v not in PROTOCOLS:
            raise ValueError(f"不支持的协议：{v}（可选：{', '.join(PROTOCOLS)}）")
        return v

    @field_validator("environments")
    @classmethod
    def _envs(cls, v: list[EnvEntry]) -> list[EnvEntry]:
        _validate_env_codes([e.code for e in v])
        return v

    @model_validator(mode="after")
    def _cross(self):
        if self.default_env and self.default_env not in [e.code for e in self.environments]:
            raise ValueError(f"default_env 必须是已配置的环境：{self.default_env}")
        if self.kind == "script" and not (self.auth_script or "").strip():
            raise ValueError("script 鉴权必须提供鉴权脚本")
        try:
            validate_secret_structure(self.kind, self.secret)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc
        for e in self.environments:
            try:
                validate_secret_structure(self.kind, e.secret)
            except ValueError as exc:
                raise ValueError(f"环境 {e.code}：{exc}") from exc
        return self


class ConnectionCreate(ConnectionBase):
    pass


class ConnectionUpdate(BaseModel):
    """全字段可选；不接受任何 secret（根级显式拒绝，环境级由 EnvPatch 拒绝）。

    default_env 传 None=保持不变；传入的 code 必须在**合并后**的环境集合中
    （服务端在 patch 存量环境后校验，见 update_connection，修复 C-04 ghost 落库）。
    """
    name: str | None = Field(default=None, min_length=1, max_length=64)
    kind: str | None = None
    protocol: str | None = None
    endpoint: dict | None = None
    environments: list[EnvPatch] | None = None
    default_env: str | None = None
    auth_script: str | None = Field(default=None, max_length=20000)
    providerHint: str | None = None
    secret: str | dict | None = None

    @field_validator("kind")
    @classmethod
    def _kind(cls, v: str | None) -> str | None:
        return normalize_kind(v) if v is not None else None

    @field_validator("protocol")
    @classmethod
    def _protocol(cls, v: str | None) -> str | None:
        if v is not None and v not in PROTOCOLS:
            raise ValueError(f"不支持的协议：{v}（可选：{', '.join(PROTOCOLS)}）")
        return v

    @field_validator("environments")
    @classmethod
    def _envs(cls, v: list[EnvPatch] | None) -> list[EnvPatch] | None:
        if v is None:
            return None
        _validate_env_codes([e.code for e in v])
        return v

    @model_validator(mode="after")
    def _cross(self):
        # 更新是 patch 语义：未提交的环境仍保留在存量集合中，请求内无法判定
        # default_env 合法性——统一由服务端在合并存量环境后校验（C-04 修复）。
        # 更新时 auth_script=None 表示保留存量脚本，仅显式传空才拒绝
        if self.kind == "script" and self.auth_script is not None and not self.auth_script.strip():
            raise ValueError("script 鉴权必须提供鉴权脚本")
        return self


class DryRunSign(BaseModel):
    """编辑器空跑：不落库，仅返回产出头与脚本日志。"""
    kind: str
    secret: str | dict | None = None
    script: str | None = None
    envVars: dict = Field(default_factory=dict)
