#!/usr/bin/env python
"""OpenAPI → 平台 Tool 批量初始化器（09-14 首轮：Apifox 导出的 BSH 测试环境接口）。

用法（在 server/ 下，.venv/bin/python）：
    scripts/import_openapi_tools.py --spec oat=/path/文件一.json --spec xspace=/path/文件二.json --plan
    OAT_PASSWORD='…' scripts/import_openapi_tools.py --spec … --apply

安全与诚实约定（对齐 seed/fixture 三重门控文化）：
- 默认 --plan 只打印执行计划，--apply 才写库；幂等：Tool 按 curated 名称、
  Connection 按名称查重，重复运行只补缺。
- 凭据只进 Connection 加密 secret（OAT 密码从环境变量 OAT_PASSWORD 读取，
  不落 argv/不回显/不进本脚本）；OpenAPI 原文件含明文示例凭据，留在仓库外，
  本脚本只读不存。
- 写操作端点（建单/创建工单/入队/编辑标签）一律 status=disabled 入库——
  「高风险写全 deny 起步、白名单放开」既定原则；启用须用户拍板。
- multipart 端点当前执行链不支持（仅 JSON），disabled+说明入库，不假装可用。
- schema 质量诚实处理：requestBody schema 为空或 argN 位置参数透传（HSF/Dubbo
  代理风格）时，input_schema 从 example 反推并在 description 标注；schema 与
  example 冲突时以 example 为准（运行时契约优先）。

前置事实（09-14 实测）：
- xspace 组路由在 https://gw.dev-corn.bshg.com.cn（AKSK 网关鉴权，实测 200；
  pre-gw.xixikf.com/gateway.lydaas.com 不路由或 accessKey 不识别）。
- oat 组（bshbp-gate/orderPlatform/sopSelectPlatform/…）在可达网关均 404，
  base 域名待用户从 Apifox 环境提供——OAT 连接以空 base_url 入库（draft），
  工具相对 URL 执行时报「endpoint 未配置 base_url」诚实失败。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import secret_ledger  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.models import Connection, Tool, ToolVersion  # noqa: E402
from app.secrets import encrypt_secret, serialize_secret  # noqa: E402

ACTOR = "script:import_openapi_tools"

XSPACE_CONN_NAME = "browser-accept-gw"
XSPACE_DEV_BASE = "https://gw.dev-corn.bshg.com.cn"
OAT_CONN_NAME = "OAT 业务网关（BSH BP）"
OAT_AUTH_SCRIPT = """\
// OAT 裸 JWT：导出示例 Authorization 无 Bearer 前缀，原样产出（Apifox 兼容 shim）
const token = pm.environment.get("token");
if (!token) {
  pm.alert("OAT token 为空：先调用「OAT 登录换 Token」获取，再把新 token 轮换进本连接凭据");
}
pm.request.headers.add({ key: "Authorization", value: String(token) });
"""

_ARGN_RE = re.compile(r"^arg\d+$")

# (group, method, path) → 策展元数据。name 唯一（幂等键）；cls=query|write|auth；
# notes 进 description（诚实标注契约质量/风险/限制）。
CURATED: dict[tuple[str, str, str], dict] = {
    # —— 文件一：OAT / BSH BP（base 待用户提供；OAT JWT 鉴权） ——
    ("oat", "post", "/bshbp-gate/api/auth/jwt/token"): dict(
        name="OAT 登录换 Token", cls="auth", status="ready",
        notes="鉴权工具：body 传 {username,password} 换取 JWT。凭据须调用方显式传入——"
              "平台不把 Connection 密钥注入请求体（Secret 永不回显原则）。换得 token 后"
              "经 设置→连接→轮换 写入本连接凭据的 token 字段。"),
    ("oat", "post", "/bshbp-gate/api/bshbp-preliminaryConnPoolPlatform/extendWarranty/outbound/processEvent"): dict(
        name="电销通话记录推送（出站）", cls="write", status="disabled",
        notes="写操作+multipart/form-data：当前工具执行链仅支持 JSON，接通需出站动作改造；"
              "入库仅存档契约，不假装可用。"),
    ("oat", "post", "/orderPlatform/orderSeedUserTodo/orderSeedTodoListToCorn"): dict(
        name="订单种子用户 Task 列表查询", cls="query", status="ready",
        notes="query。schema 为空，input 从 example 反推：{crmUserId}。"),
    ("oat", "post", "/sopSelectPlatform/query/serviceOrderList"): dict(
        name="服务单列表查询", cls="query", status="ready",
        notes="query。schema 为空，input 从 example 反推：{instId,requestTime,userPhone,linkmanId}；"
              "响应 schema 完整（msServiceOrderResultDtoList 53 字段）。"),
    ("oat", "post", "/sopSelectPlatform/query/serviceOrderDetailInfo"): dict(
        name="服务单详情查询", cls="query", status="ready",
        notes="query。input 从 example 反推：{risCode}；响应 schema 同列表查询。"),
    ("oat", "post", "/integralGoodsPlatform/dtoc/selectCanBuy"): dict(
        name="D2C 延保可购查询", cls="query", status="ready",
        notes="query。requestBody schema 完整（vib/brandId/channelKey/ki/fd/zn/qualityStartTime/type，全必填）。"),
    ("oat", "post", "/bshbp-crmEquipmentPlatform/equipmentInfo/checkEquipmentCarDetailList"): dict(
        name="延保卡绑定校验查询", cls="query", status="ready",
        notes="query。input 从 example 反推：{keyWordType,keyWord,warrantyId,warrantyType}。"),
    ("oat", "post", "/sopCornPlatform/v1/eccn-service-orders/orders/corn/getorder"): dict(
        name="OAT 建单（服务工单下发）", cls="write", status="disabled",
        notes="写操作（真实建单）：deny 起步，启用须用户拍板白名单。token 走 query 参数（示例如此），"
              "与 Authorization 头鉴权并存关系待与对方系统确认。"),
    ("oat", "post", "/bshbp-crmUserInfoPlatform/userMainInfo/queryUserDetail"): dict(
        name="CRM 用户详情查询", cls="query", status="ready",
        notes="query。input 从 example 反推：{keyword,keywordType,scope[],page,limit}；含会员/设备/地址/保修/标签。"),
    ("oat", "post", "/bshbp-crmUserInfoPlatform/crmTag/getCrmTagList"): dict(
        name="CRM 标签列表查询", cls="query", status="ready",
        notes="query。example 为空对象——body 契约以对方系统为准（可能允许 {}）。"),
    ("oat", "post", "/bshbp-crmUserInfoPlatform/userMainInfo/editUserInfo"): dict(
        name="CRM 用户标签编辑", cls="write", status="disabled",
        notes="写操作（修改用户标签/手机号记录）：deny 起步，启用须用户拍板白名单。"),
    # —— 文件二：西西/Xspace 开放网关（gw.dev-corn 实测路由；AKSK 网关鉴权） ——
    ("xspace", "post", "/api/hsf/xspace-openapi-proxy/XspaceTicketProxyService/createTicket"): dict(
        name="NPS 工单创建（Xspace）", cls="write", status="disabled",
        notes="写操作（真实建单）：deny 起步，启用须用户拍板白名单。HSF 位置参数透传"
              "（arg0…arg12，业务契约整包在 arg12 JSON 字符串内），字段语义需人工标注后 agent 才可用。"),
    ("xspace", "post", "/api/v1/ticket/create"): dict(
        name="退换机协商单创建", cls="write", status="disabled",
        notes="写操作（真实建单）：deny 起步。argN 位置参数透传，业务契约在 arg12 JSON 字符串内。"),
    ("xspace", "post", "/api/hsf/xspace-openapi-proxy/TicketProxyService/updateTicket"): dict(
        name="工单更新（Xspace）", cls="write", status="disabled",
        notes="写操作：deny 起步。argN 位置参数（example: arg0=工单ID, arg1=租户, arg2={photo}）。"),
    ("xspace", "post", "/api/hsf/xspace-openapi-proxy/TicketProxyService/executeActivity"): dict(
        name="工单活动执行（Xspace）", cls="write", status="disabled",
        notes="写操作（推进工单状态机）：deny 起步。argN 位置参数，example 中 arg2 为活动码字符串。"),
    ("xspace", "post", "/api/hsf/xspace-openapi-proxy/XspaceTicketProxyService/searchTicketById"): dict(
        name="工单查询（Xspace searchTicketById）", cls="query", status="ready",
        notes="query。schema 与 example 冲突（schema 称 arg2 为对象，example 实为 arg2=工单ID、"
              "arg3=租户ID）——以 example 为准（运行时契约优先）。"),
    ("xspace", "post", "/ticket/dubbo/api/searchTicket"): dict(
        name="工单查询（dubbo searchTicket）", cls="query", status="ready",
        notes="query。schema 为 argN 但 example 是 {ticketId}——以 example 为准。"),
    ("xspace", "post", "/api/hsf/merge-xixi-online/OpenApiService/enqueue"): dict(
        name="西西在线会话入队", cls="write", status="disabled",
        notes="写操作（真实排队进线）：deny 起步。example 契约完整（userId/skillGroupId/tenantId 等）。"),
    ("xspace", "get", "/api/v1/device/deviceErrorList"): dict(
        name="机器故障记录查询", cls="query", status="ready",
        notes="query（GET）。参数 haId（机器 ID，如 BOSCH-WGC354B1HW-68A40EADE418）、"
              "timestamp（示例格式 2026-08）。两参数都会拼进 URL 模板，调用须传全。"),
    ("xspace", "post", "/api/hsf/xspace-openapi-proxy/HotlineProxyService/queryMessageLog"): dict(
        name="热线语音转文本记录查询", cls="query", status="ready",
        notes="query。argN 位置参数（example: arg0=实例ID, arg1=租户ID, arg2=通话acid）。"
              "质检取数面：通话转写文本。"),
    ("xspace", "post", "/api/hsf/xspace-openapi-proxy/HotlineProxyService/listRecordV2"): dict(
        name="热线录音查询（listRecordV2）", cls="query", status="ready",
        notes="query。argN 位置参数（example: arg0=实例ID, arg1=通话acid）。"
              "与存量 disabled 工具 lydaas_recording_lookup_v2 同端点（其 URL 指 gateway.lydaas.com，"
              "本 AKSK 未注册该域名）——存量工具为退役候选，本条为统一形态（相对 URL+连接解析）。"),
}


def _infer_schema(value, depth: int = 0):
    """从 example 值反推 JSON Schema（深度/宽度设限，诚实标注来源）。"""
    if depth > 4:
        return {}
    if isinstance(value, dict):
        props = {}
        for i, (k, v) in enumerate(value.items()):
            if i >= 60:
                break
            props[k] = _infer_schema(v, depth + 1)
        return {"type": "object", "properties": props}
    if isinstance(value, list):
        return {"type": "array",
                "items": _infer_schema(value[0], depth + 1) if value else {}}
    if isinstance(value, bool):
        return {"type": "boolean"}
    if isinstance(value, int):
        return {"type": "integer"}
    if isinstance(value, float):
        return {"type": "number"}
    if isinstance(value, str):
        return {"type": "string"}
    return {}


def _request_example(op: dict):
    content = (op.get("requestBody") or {}).get("content") or {}
    for media in content.values():
        if "example" in media:
            return media["example"]
    return None


def _request_schema_props(op: dict) -> dict:
    content = (op.get("requestBody") or {}).get("content") or {}
    for media in content.values():
        props = ((media.get("schema") or {}).get("properties")) or {}
        if props:
            return props
    return {}


def _response_schema(op: dict) -> dict:
    for resp in (op.get("responses") or {}).values():
        for media in (resp.get("content") or {}).values():
            schema = media.get("schema") or {}
            if schema.get("properties"):
                return schema
    return {}


def build_tool(entry: dict, group: str, method: str, path: str, op: dict) -> dict:
    """组装 Tool/ToolVersion 字段（纯函数，便于单测）。"""
    example = _request_example(op)
    schema_props = _request_schema_props(op)
    argn_only = bool(schema_props) and all(_ARGN_RE.match(k) for k in schema_props)
    if method == "get":
        params = op.get("parameters") or []
        input_schema = {"type": "object", "properties": {
            p["name"]: {"type": (p.get("schema") or {}).get("type", "string"),
                        **({"description": p["description"]} if p.get("description") else {})}
            for p in params if p.get("in") == "query"}}
        query = "&".join(f"{p['name']}={{{{{p['name']}}}}}"
                         for p in params if p.get("in") == "query")
        url = f"{path}?{query}" if query else path
        spec = {"request": {"url": url, "method": "GET"}}
        schema_src = "parameters"
    elif schema_props and not argn_only:
        content = (op.get("requestBody") or {}).get("content") or {}
        schema = next(iter(content.values()), {}).get("schema") or {}
        input_schema = schema
        spec = {"request": {"url": path, "method": method.upper(), "body": "$args"}}
        schema_src = "schema"
    elif example is not None:
        input_schema = _infer_schema(example)
        spec = {"request": {"url": path, "method": method.upper(), "body": "$args"}}
        schema_src = "example反推"
    else:
        input_schema = {}
        spec = {"request": {"url": path, "method": method.upper(), "body": "$args"}}
        schema_src = "无契约"
    desc = (f"[Apifox OpenAPI 导入 09-14] 组={group}（{'OAT JWT' if group == 'oat' else 'AKSK 网关'}）"
            f" 分类={entry['cls']} {method.upper()} {path}\n{entry['notes']}")
    return {"name": entry["name"], "description": desc, "status": entry["status"],
            "input_schema": input_schema, "output_schema": _response_schema(op),
            "spec": spec, "schema_src": schema_src}


def ensure_oat_conn(db, apply: bool) -> tuple[str, list[str]]:
    """OAT 连接（script 裸 JWT；base_url 待填=draft 诚实态）。返回 (conn_id, log)。"""
    log = []
    existing = db.query(Connection).filter(Connection.name == OAT_CONN_NAME).first()
    if existing:
        log.append(f"连接已存在，跳过创建：{OAT_CONN_NAME} ({existing.id})")
        return existing.id, log
    password = os.environ.get("OAT_PASSWORD", "")
    secret = {"username": "corn-prod", "token": ""}
    if password:
        secret["password"] = password
        log.append("OAT_PASSWORD 已读取 → 写入加密 secret（不回显）")
    else:
        log.append("⚠ 未提供 OAT_PASSWORD 环境变量：secret 暂存 {username,token}，"
                   "密码稍后经 设置→连接→轮换 补录")
    c = Connection(name=OAT_CONN_NAME, kind="script", protocol="http-api",
                   endpoint={},  # base 待用户从 Apifox 环境提供；空=执行时诚实报错
                   environments=[
                       {"code": "test", "label": "测试（域名待填）", "endpoint": {}},
                       {"code": "prod", "label": "生产（域名待填）", "endpoint": {}},
                   ],
                   default_env="test", auth_script=OAT_AUTH_SCRIPT,
                   provider_hint="", secret_ref="", lifecycle="draft", status="draft")
    if apply:
        db.add(c)
        db.flush()
        ref = encrypt_secret(serialize_secret(secret))
        c.secret_ref = ref
        secret_ledger.record_initial(db, c, "", ref, secret, ACTOR)
        db.flush()
        log.append(f"已创建 OAT 连接 {c.id}（draft；kind=script 裸 JWT 头；endpoint 待填）")
    else:
        log.append(f"[plan] 将创建 OAT 连接：{OAT_CONN_NAME}（kind=script, draft, endpoint 待填）")
    return (c.id if apply else ""), log


def fix_xspace_conn(db, apply: bool) -> tuple[str, list[str]]:
    """browser-accept-gw：dev 环境 base_url 修正为实测可路由的 gw.dev-corn（secret 不动）。"""
    log = []
    c = db.query(Connection).filter(Connection.name == XSPACE_CONN_NAME).first()
    if not c:
        log.append(f"✗ 未找到连接 {XSPACE_CONN_NAME}——xspace 组工具将无连接可绑（请先创建）")
        return "", log
    envs = [dict(e) for e in (c.environments or [])]
    changed = False
    for e in envs:
        if e.get("code") == "dev" and (e.get("endpoint") or {}).get("base_url", "").rstrip("/") != XSPACE_DEV_BASE:
            e["endpoint"] = {"base_url": XSPACE_DEV_BASE}
            e["label"] = "测试·dev-corn 网关（09-14 实测 200）"
            changed = True
    root_changed = (c.endpoint or {}).get("base_url", "").rstrip("/") != XSPACE_DEV_BASE
    if changed or root_changed:
        if apply:
            if changed:
                c.environments = envs
            if root_changed:
                c.endpoint = {"base_url": XSPACE_DEV_BASE}
            db.flush()
            log.append(f"已修正 {XSPACE_CONN_NAME} dev/root endpoint → {XSPACE_DEV_BASE}"
                       "（prod 环境 gw.xixikf.com 未实测，保留不动；secret 未触碰）")
        else:
            log.append(f"[plan] 将修正 {XSPACE_CONN_NAME} dev/root endpoint → {XSPACE_DEV_BASE}（secret 不动）")
    else:
        log.append(f"{XSPACE_CONN_NAME} endpoint 已是 {XSPACE_DEV_BASE}，无需修正")
    return c.id, log


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--spec", action="append", required=True,
                    help="group=path/to/openapi.json（可重复；group∈oat|xspace）")
    ap.add_argument("--apply", action="store_true", help="真实写库（默认仅打印计划）")
    args = ap.parse_args()

    specs: dict[str, dict] = {}
    for item in args.spec:
        group, _, p = item.partition("=")
        if not p or group not in ("oat", "xspace"):
            print(f"✗ --spec 格式须为 group=path（group∈oat|xspace）：{item}")
            return 2
        specs[group] = json.loads(Path(p).read_text(encoding="utf-8"))

    db = SessionLocal()
    try:
        log: list[str] = []
        oat_id, l1 = ensure_oat_conn(db, args.apply)
        xsp_id, l2 = fix_xspace_conn(db, args.apply)
        log += l1 + l2
        conn_by_group = {"oat": oat_id, "xspace": xsp_id}

        created = skipped = missing = 0
        rows = []
        for (group, method, path), entry in CURATED.items():
            op = ((specs.get(group, {}).get("paths") or {}).get(path) or {}).get(method)
            if op is None:
                missing += 1
                rows.append(("✗缺端点", group, method.upper(), path, entry["name"], "-", "-"))
                continue
            t = build_tool(entry, group, method, path, op)
            exists = db.query(Tool).filter(Tool.name == t["name"]).first()
            if exists:
                skipped += 1
                rows.append(("已存在", group, method.upper(), path, t["name"],
                             t["status"], t["schema_src"]))
                continue
            if args.apply:
                if not conn_by_group.get(group):
                    rows.append(("✗无连接", group, method.upper(), path, t["name"], "-", "-"))
                    missing += 1
                    continue
                tool = Tool(name=t["name"], description=t["description"], kind="http",
                            status=t["status"], connection_id=conn_by_group[group])
                db.add(tool)
                db.flush()
                db.add(ToolVersion(tool_id=tool.id, version_no=1,
                                   input_schema=t["input_schema"],
                                   output_schema=t["output_schema"],
                                   spec=t["spec"], status="ready"))
                created += 1
            rows.append(("将创建" if not args.apply else "已创建", group, method.upper(),
                         path, t["name"], t["status"], t["schema_src"]))
        if args.apply:
            db.commit()

        print(f"\n{'状态':<6} {'组':<7} {'M':<5} {'名称':<28} {'tool状态':<9} schema来源  path")
        for r in rows:
            print(f"{r[0]:<6} {r[1]:<7} {r[2]:<5} {r[4]:<28} {r[5]:<9} {r[6]:<10} {r[3]}")
        print(f"\n汇总：创建 {created} / 已存在跳过 {skipped} / 缺失 {missing}（共 {len(CURATED)} 策展端点）")
        for line in log:
            print(" -", line)
        if not args.apply:
            print("\n[plan 模式] 未写库。确认后加 --apply 执行。")
        return 1 if missing else 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
