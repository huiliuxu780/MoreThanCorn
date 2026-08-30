"""Secret 加解密与 payload 解析（09 P0-11 失败关闭语义的统一归属）。

- encrypt_secret：生产缺/非法 WF_SECRET_KEY 一律失败关闭，绝不回落明文；
- decrypt_secret：Fernet 密文必须成功解密，否则抛错（不回落明文/密文）；
- decrypt_payload：secret_ref 解密后要么是历史裸字符串，要么是 JSON 对象
  （aksk/basic/脚本 KV 等新形态统一存 JSON）。
"""
from __future__ import annotations

import json
import os


def encrypt_secret(secret: str) -> str:
    from .config import is_production  # 局部导入避免配置循环依赖
    from cryptography.fernet import Fernet
    key = os.environ.get("WF_SECRET_KEY")
    if is_production():
        if not key:
            raise RuntimeError("生产环境未配置 WF_SECRET_KEY，无法加密 Secret")
        try:
            return Fernet(key.encode()).encrypt(secret.encode()).decode()
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"WF_SECRET_KEY 非合法 Fernet 密钥，无法加密：{exc}")
    # 非生产：尽力加密，失败回落明文（开发便利）
    if key:
        try:
            return Fernet(key.encode()).encrypt(secret.encode()).decode()
        except Exception:  # noqa: BLE001
            pass
    return secret


def decrypt_secret(ref: str) -> str:
    """密钥解密（失败关闭，任何环境）。非密文（历史明文）原样返回仅为兼容遗留。"""
    key = os.environ.get("WF_SECRET_KEY")
    if isinstance(ref, str) and ref.startswith("gAAAAA"):  # Fernet 密文特征前缀
        if not key:
            raise RuntimeError("WF_SECRET_KEY 缺失：无法解密 Secret（禁止明文模式）")
        from cryptography.fernet import Fernet
        try:
            return Fernet(key.encode()).decrypt(ref.encode()).decode()
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"Secret 解密失败（密钥非法或密文损坏）：{exc}")
    return ref


def decrypt_payload(ref: str) -> dict | str:
    """解密并解析 secret_ref：JSON 对象 → dict（新形态），否则裸字符串（历史形态）。"""
    if not ref:
        return {}
    raw = decrypt_secret(ref)
    if raw.startswith("{"):
        try:
            val = json.loads(raw)
            if isinstance(val, dict):
                return val
        except Exception:  # noqa: BLE001 —— 非 JSON 即历史裸串
            pass
    return raw


def serialize_secret(payload: dict | str) -> str:
    """写入 secret_ref 前统一序列化：dict → JSON 串，str → 原样。"""
    if isinstance(payload, dict):
        return json.dumps(payload, ensure_ascii=False)
    return payload or ""
