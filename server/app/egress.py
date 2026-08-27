"""统一出站 Egress Policy（09-SDD §6.9 / P0-11）。

SSRF 防护覆盖：DNS 解析结果（含 IPv6/多 A 记录）、私网/环回/链路本地/
保留段、云元数据地址（169.254.169.254）、非法 scheme。
调用方必须禁用自动重定向（httpx 默认 follow_redirects=False），
重定向目标需重新过本检查。"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse


class EgressError(Exception):
    pass


# 云厂商元数据地址（AWS/阿里云/腾讯云等）
_METADATA = {"169.254.169.254", "metadata.google.internal"}


def _blocked_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return True  # 无法解析即拒绝（fail closed）
    return (addr.is_private or addr.is_loopback or addr.is_link_local
            or addr.is_reserved or addr.is_multicast or addr.is_unspecified)


def assert_safe_url(url: str) -> None:
    """出站前强制校验；违规抛 EgressError。"""
    p = urlparse(url or "")
    if p.scheme not in ("http", "https"):
        raise EgressError(f"EGRESS_BLOCKED：scheme 必须是 http/https（{p.scheme!r}）")
    host = p.hostname or ""
    if not host:
        raise EgressError("EGRESS_BLOCKED：缺少主机名")
    if host.lower() in _METADATA:
        raise EgressError("EGRESS_BLOCKED：云元数据地址禁止访问")
    try:
        infos = socket.getaddrinfo(host, p.port or (443 if p.scheme == "https" else 80),
                                   proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise EgressError(f"EGRESS_BLOCKED：无法解析 {host}: {exc}") from exc
    for info in infos:
        ip = info[4][0].split("%")[0]
        if ip in _METADATA or _blocked_ip(ip):
            raise EgressError(f"EGRESS_BLOCKED：{host} 解析到受限地址 {ip}")


def enforce_egress(url: str) -> None:
    """09 P0（审计反例 4）：所有生产出站路径统一过 Egress。

    生产环境强制拦截私网/元数据/受限地址；非生产放行（允许本地开发）。
    用于模型调用 / Agent / Knowledge / MCP / 资源健康检查 / 连接探测等路径。"""
    from .config import is_production
    if is_production():
        assert_safe_url(url)
