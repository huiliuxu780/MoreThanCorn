"""Connection 请求校验（替换路由层裸 dict，09 硬化延续）。

kind 真实枚举：none|api_key|bearer|basic|aksk|script（旧人类可读串自动归一化）。
environments：预置 dev/test/pre/prod 四槽 + 可自定义；条目可按环境覆盖
endpoint 与凭据（secret 明文入参，服务端加密落 secret_ref）。
"""
from __future__ import annotations

import re

from pydantic import BaseModel, Field, field_validator, model_validator

from .auth_signers import KINDS, normalize_kind

PROTOCOLS = ("http-api", "llm", "mcp-http", "mysql", "postgresql", "oss")
_ENV_CODE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,15}$")


class EnvEntry(BaseModel):
    code: str
    label: str = ""
    endpoint: dict = Field(default_factory=dict)
    secret: str | dict | None = None  # 明文入参；服务端加密为 secret_ref，永不原样落库/回显


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
        codes = [e.code for e in v]
        if len(codes) != len(set(codes)):
            raise ValueError("环境码重复")
        for e in v:
            if not _ENV_CODE_RE.match(e.code):
                raise ValueError(f"环境码非法：{e.code}（小写字母/数字开头，≤16 位）")
        return v

    @model_validator(mode="after")
    def _cross(self):
        if self.default_env and self.default_env not in [e.code for e in self.environments]:
            raise ValueError(f"default_env 必须是已配置的环境：{self.default_env}")
        if self.kind == "script" and not (self.auth_script or "").strip():
            raise ValueError("script 鉴权必须提供鉴权脚本")
        if self.kind == "aksk" and isinstance(self.secret, dict):
            if not self.secret.get("access_key") or not self.secret.get("secret_key"):
                raise ValueError("aksk 密钥须含 access_key 与 secret_key")
        if self.kind == "basic" and isinstance(self.secret, dict):
            if not self.secret.get("username"):
                raise ValueError("basic 密钥须含 username")
        return self


class ConnectionCreate(ConnectionBase):
    pass


class ConnectionUpdate(BaseModel):
    """全字段可选；secret=None 表示保留原密钥。"""
    name: str | None = Field(default=None, min_length=1, max_length=64)
    kind: str | None = None
    protocol: str | None = None
    endpoint: dict | None = None
    environments: list[EnvEntry] | None = None
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
    def _envs(cls, v: list[EnvEntry] | None) -> list[EnvEntry] | None:
        if v is None:
            return None
        codes = [e.code for e in v]
        if len(codes) != len(set(codes)):
            raise ValueError("环境码重复")
        for e in v:
            if not _ENV_CODE_RE.match(e.code):
                raise ValueError(f"环境码非法：{e.code}")
        return v

    @model_validator(mode="after")
    def _cross(self):
        if self.default_env and self.environments is not None and \
                self.default_env not in [e.code for e in self.environments]:
            raise ValueError(f"default_env 必须是已配置的环境：{self.default_env}")
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
