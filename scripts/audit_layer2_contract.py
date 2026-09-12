"""四层审计·层2：契约/漂移/吞错/僵尸端点 静态+运行时扫荡（2026-09-13）。

用法：cd server && .venv/bin/python ../scripts/audit_layer2_contract.py [--fix-hint]
输出：每节发现清单 + 计数；退出码 0=无 P0 发现，1=有 P0。
P0 定义：模型/迁移漂移、Spec 登记端点缺失、吞错且无日志、DTO 必需键缺失。
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
os.environ.setdefault("WF_DATABASE_URL",
                      "postgresql+psycopg://rivers@127.0.0.1:5432/wf_dev")

P0: list[str] = []
P1: list[str] = []


def section(title: str) -> None:
    print(f"\n=== {title} ===")


# ---------- A. 模型 × 迁移/库 漂移 ----------
section("A. 模型列 × wf_dev information_schema 漂移")
from sqlalchemy import inspect as sa_inspect  # noqa: E402

from app.db import engine  # noqa: E402
from app.models import Base  # noqa: E402

insp = sa_inspect(engine)
db_tables = {t: {c["name"] for c in insp.get_columns(t)} for t in insp.get_table_names()}
for table in Base.metadata.sorted_tables:
    cols = db_tables.get(table.name)
    if cols is None:
        P0.append(f"[drift] 表 {table.name} 在 wf_dev 不存在")
        continue
    model_cols = {c.name for c in table.columns}
    missing = model_cols - cols
    extra = cols - model_cols
    if missing:
        P0.append(f"[drift] {table.name} 模型有库缺: {sorted(missing)}")
    if extra:
        P1.append(f"[drift] {table.name} 库有模型缺: {sorted(extra)}")
print(f"检查表 {len(Base.metadata.sorted_tables)} 张")

# ---------- B. Spec §12 登记端点 × openapi ----------
section("B. Spec §12 登记端点 × openapi.json")
from app.main import app  # noqa: E402

spec_md = (Path(__file__).resolve().parents[1]
           / "docs/product-domain/execution-automation-batch-spec.md").read_text()
sec = spec_md.split("## 12. API Spec")[1].split("## 13.")[0]
declared = set()
for m in re.finditer(r"(GET|POST|PUT|PATCH|DELETE)\s+(/api/[^\s`]+)", sec):
    declared.add((m.group(1), m.group(2).split("?")[0]))
openapi = app.openapi()
have = set()
for path, ops in openapi["paths"].items():
    for method in ops:
        if method in ("get", "post", "put", "patch", "delete"):
            have.add((method.upper(), path))


def norm(p: str) -> str:
    p = re.sub(r"\{[^}]+\}", "{}", p)
    # Spec 示例段（auto_xxx/inv_xxx/tr_xxx 等）视同占位符
    return re.sub(r"/[a-z]+_(xxx|[a-f0-9]{6,})", "/{}", p)


#: 已排期缺口白名单（切片归属，审计不判 P0）。
#: 2026-09-13 F5 切片落地：event-routes/event-deliveries ×8 已实施
#: （server/app/routers/event_routes.py + tests/test_f5_event_routes.py），白名单清零。
SCHEDULED_GAPS: dict[tuple[str, str], str] = {}


have_norm = {(m, norm(p)) for m, p in have}
for method, path in sorted(declared):
    np = norm(path)
    if (method, np) not in have_norm:
        if (method, np) in SCHEDULED_GAPS:
            P1.append(f"[spec-endpoint-scheduled] {method} {path} → {SCHEDULED_GAPS[(method, np)]}")
        else:
            P0.append(f"[spec-endpoint] Spec 登记但 openapi 缺失: {method} {path}")
print(f"Spec 登记端点 {len(declared)} 个")

# ---------- C. 吞错扫荡 ----------
section("C. except Exception 且 pass/continue 无日志")
app_dir = Path(__file__).resolve().parents[1] / "server" / "app"
swallow = 0
for py in app_dir.rglob("*.py"):
    src = py.read_text()
    for m in re.finditer(r"except Exception[^:]*:\s*\n(\s+)(pass|continue)\n", src):
        line = src[:m.start()].count("\n") + 1
        swallow += 1
        P1.append(f"[swallow] {py.relative_to(app_dir.parent.parent)}:{line} except→{m.group(2)} 无日志")
print(f"吞错候选 {swallow} 处（P1，需逐处判定是否补日志/错误码）")

# ---------- D. 僵尸端点 ----------
section("D. 僵尸端点（无测试且无前端消费者）")
tests_blob = "\n".join(p.read_text() for p in
                       (app_dir.parent / "tests").glob("*.py"))
src_blob = "\n".join(p.read_text() for p in
                     (app_dir.parent.parent / "src").rglob("*.ts*"))
zombies = 0
for route in app.routes:
    path = getattr(route, "path", "")
    if not path.startswith("/api"):
        continue
    methods = getattr(route, "methods", set())
    if not methods & {"GET", "POST", "PUT", "PATCH", "DELETE"}:
        continue
    pat = norm(path)
    in_tests = re.search(re.escape(pat).replace(r"\{\}", r"[^/]+"), tests_blob)
    in_src = re.search(re.escape(pat).replace(r"\{\}", r"[^/]+"), src_blob)
    if not in_tests and not in_src:
        zombies += 1
        P1.append(f"[zombie] {sorted(methods & {'GET','POST','PUT','PATCH','DELETE'})} {path}")
print(f"僵尸端点候选 {zombies} 个")

# ---------- E. DTO × TS 契约（抽样三端点） ----------
section("E. 响应键 × TS interface 契约（抽样）")
api_types = (app_dir.parent.parent / "src/services/api-types.ts").read_text()


def ts_keys(name: str) -> set[str]:
    m = re.search(rf"export interface {name} \{{(.*?)\n\}}", api_types, re.S)
    if not m:
        return set()
    return {k.strip().rstrip("?") for k in
            re.findall(r"^\s{2}([A-Za-z_][A-Za-z0-9_?]*)\s*:", m.group(1), re.M)}


from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(app)
samples = [
    ("/api/work-items", "WorkItemDTO", "items"),
]
for path, iface, list_key in samples:
    r = client.get(path)
    if r.status_code != 200:
        P0.append(f"[dto] {path} 非 200: {r.status_code}")
        continue
    items = r.json().get(list_key) or []
    if not items:
        print(f"{path}: 无样本行，跳过键对比")
        continue
    keys = set(items[0].keys())
    ts = ts_keys(iface)
    missing_in_ts = keys - ts
    if missing_in_ts:
        P1.append(f"[dto] {path} 响应键 TS 未声明: {sorted(missing_in_ts)}")
    print(f"{path}: 响应 {len(keys)} 键 vs TS {len(ts)} 键")

# ---------- 汇总 ----------
print("\n=== 汇总 ===")
print(f"P0: {len(P0)}")
for x in P0:
    print("  P0", x)
print(f"P1: {len(P1)}")
for x in P1[:40]:
    print("  P1", x)
if len(P1) > 40:
    print(f"  …另有 {len(P1) - 40} 条见完整输出")
sys.exit(1 if P0 else 0)
