"""飞书（lark-cli）工具包装层（09-18 TrueAsk 场景拍板：形态 A + 用户 lark-cli 鉴权）。

dev-only：生产环境或 MTC_FEISHU_CLI=off 时全部 404（与 fixture-tools 同门控语义）。
白名单 ops + 严格参数：subprocess 以 argv 列表 exec lark-cli（无 shell、无自由命令），
输出原样解析返回；失败给 error 信封（fail-closed，不 mock）。
凭据不复制进平台：exec 继承本机 lark-cli 已登录 profile（用户身份）。
"""
from __future__ import annotations

import json
import os
import subprocess

from fastapi import APIRouter, HTTPException

from ..config import is_production

router = APIRouter(prefix="/api/feishu-tools", tags=["feishu-tools"])

_TIMEOUT_S = 90
_CLI = "lark-cli"


def _gate() -> None:
    if is_production() or os.environ.get("MTC_FEISHU_CLI", "on") != "on":
        raise HTTPException(404, "feishu-cli 工具仅限开发环境（MTC_FEISHU_CLI=on 且非生产）")


def _run(argv: list[str]) -> dict:
    try:
        proc = subprocess.run(  # noqa: S603 —— argv 白名单构造，无 shell
            [_CLI, *argv],
            capture_output=True,
            text=True,
            timeout=_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired as exc:
        return {"ok": False, "error": f"lark-cli 超时（{_TIMEOUT_S}s）", "detail": str(exc)}
    out = proc.stdout or ""
    if proc.returncode != 0:
        return {"ok": False, "error": (proc.stderr or out)[:800],
                "returncode": proc.returncode}
    try:
        return {"ok": True, "output": json.loads(out)}
    except json.JSONDecodeError:
        return {"ok": True, "output": out[:4000]}


@router.post("/record_list")
def record_list(payload: dict | None = None) -> dict:
    """读多维表格记录（分页 offset/limit，limit≤200 与平台源适配器同上限）。"""
    _gate()
    b = payload or {}
    base_token = str(b.get("base_token") or "")
    table_id = str(b.get("table_id") or "")
    if not base_token or not table_id:
        raise HTTPException(422, "base_token 与 table_id 必填")
    limit = min(int(b.get("limit") or 100), 200)
    offset = max(int(b.get("offset") or 0), 0)
    argv = ["base", "+record-list", "--base-token", base_token,
            "--table-id", table_id, "--limit", str(limit),
            "--offset", str(offset), "--as", "user", "--json"]
    for fid in (b.get("field_ids") or [])[:20]:
        argv += ["--field-id", str(fid)]
    return _run(argv)


@router.post("/record_batch_create")
def record_batch_create(payload: dict | None = None) -> dict:
    """批量写多维表格记录：{"fields":[列名…],"rows":[[值…]…]}（rows 跟随 fields 序）。"""
    _gate()
    b = payload or {}
    base_token = str(b.get("base_token") or "")
    table_id = str(b.get("table_id") or "")
    fields = b.get("fields")
    rows = b.get("rows")
    if not base_token or not table_id:
        raise HTTPException(422, "base_token 与 table_id 必填")
    if not isinstance(fields, list) or not fields or not all(isinstance(f, str) for f in fields):
        raise HTTPException(422, "fields 必须是非空字符串数组")
    if not isinstance(rows, list) or not rows:
        raise HTTPException(422, "rows 必须是非空数组")
    for row in rows[:100]:
        if not isinstance(row, list) or len(row) != len(fields):
            raise HTTPException(422, "每行长度必须与 fields 一致")
    body = json.dumps({"fields": fields, "rows": rows[:100]}, ensure_ascii=False)
    return _run(["base", "+record-batch-create", "--base-token", base_token,
                 "--table-id", table_id, "--as", "user", "--json", body])
