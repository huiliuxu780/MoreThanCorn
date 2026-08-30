"""P2-06：KMS 信封加密抽象层（密钥管理）。

- Provider 接口 encrypt/decrypt；LocalKmsProvider 默认：WF_SECRET_KEY 作 master key，
  每次加密随机 data key 并将 wrapped data key 附在密文头（信封加密）；
  外部云 KMS/HSM 后续按同一接口接入（本轮不虚构实现）。
- decrypt 兼容三态：env1 信封 / 旧 Fernet 直密（gAAAAA 前缀，存量数据）/ 历史明文。
- 失败关闭：生产缺/非法 master key 拒加密；有密文缺 key 拒解密（不回落明文）。
"""
from __future__ import annotations

import os

ENV_PREFIX = "env1:"


class LocalKmsProvider:
    """本地 master key 提供者（WF_SECRET_KEY + Fernet 包裹 data key）。"""

    def _master(self):
        from cryptography.fernet import Fernet
        from .config import is_production
        key = os.environ.get("WF_SECRET_KEY")
        if is_production() and not key:
            raise RuntimeError("生产环境未配置 WF_SECRET_KEY，KMS 无法加密")
        if not key:
            return None
        try:
            return Fernet(key.encode())
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"WF_SECRET_KEY 非合法 Fernet 密钥：{exc}")

    def encrypt(self, plaintext: bytes) -> str:
        from cryptography.fernet import Fernet
        master = self._master()
        if master is None:
            return plaintext.decode()  # 非生产无 key：明文回落（开发便利），调用方保留语义
        data_key = Fernet.generate_key()
        wrapped = master.encrypt(data_key)
        ct = Fernet(data_key).encrypt(plaintext)
        return f"{ENV_PREFIX}{wrapped.decode()}.{ct.decode()}"

    def decrypt(self, token: str) -> bytes:
        from cryptography.fernet import Fernet
        if token.startswith(ENV_PREFIX):
            wrapped, _, ct = token[len(ENV_PREFIX):].partition(".")
            key = os.environ.get("WF_SECRET_KEY")
            if not key:
                raise RuntimeError("WF_SECRET_KEY 缺失：无法解密信封密文（禁止明文模式）")
            master = Fernet(key.encode())
            return Fernet(master.decrypt(wrapped.encode())).decrypt(ct.encode())
        if token.startswith("gAAAAA"):  # 旧 Fernet 直密存量
            key = os.environ.get("WF_SECRET_KEY")
            if not key:
                raise RuntimeError("WF_SECRET_KEY 缺失：无法解密 Secret（禁止明文模式）")
            return Fernet(key.encode()).decrypt(token.encode())
        return token.encode()  # 历史明文兼容


_provider = LocalKmsProvider()


def get_provider() -> LocalKmsProvider:
    """外部 KMS 接入点：替换 provider 即换密钥后端（接口不变）。"""
    return _provider


def kms_encrypt(secret: str) -> str:
    return _provider.encrypt(secret.encode())


def kms_decrypt(ref: str) -> str:
    return _provider.decrypt(ref).decode()
