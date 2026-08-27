"""09-SDD P2-07：PII 分类与脱敏。

对 Prompt/输入/响应/日志中的敏感字段按数据分类脱敏：
手机号、邮箱、身份证号、银行卡号。脱敏后保留首尾少量字符便于排障，
中间以 * 覆盖。生产环境强制启用（生产恒开）。
"""
from __future__ import annotations

import re

# 手机号（中国大陆 11 位，1 开头）
_PHONE = re.compile(r"(?<!\d)(1[3-9]\d)(\d{4})(\d{4})(?!\d)")
# 邮箱
_EMAIL = re.compile(r"([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})")
# 身份证号（18 位，末位可 X）
_IDCARD = re.compile(r"(?<!\d)(\d{6})(\d{8})(\d{3}[\dXx])(?!\d)")
# 银行卡号（16-19 位）
_BANKCARD = re.compile(r"(?<!\d)(\d{4})\d{8,12}(\d{4})(?!\d)")


def mask_pii(text: str) -> str:
    """对文本中的 PII 脱敏（手机/邮箱/身份证/银行卡）。非字符串原样返回。"""
    if not isinstance(text, str) or not text:
        return text
    text = _PHONE.sub(r"\1****\3", text)
    text = _EMAIL.sub(r"\1***\2", text)
    text = _IDCARD.sub(r"\1********\3", text)
    text = _BANKCARD.sub(r"\1********\2", text)
    return text


def mask_structure(obj):
    """递归脱敏 dict/list 中的字符串值（CallRecord request/response 用）。"""
    if isinstance(obj, dict):
        return {k: mask_structure(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [mask_structure(v) for v in obj]
    if isinstance(obj, str):
        return mask_pii(obj)
    return obj
