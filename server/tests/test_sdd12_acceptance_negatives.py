"""SDD-12 P0 验收阻断项回归（2026-08-31 独立验收发现的三个 P0 + 两个附加缺口）。

每条对应验收记录 M.5 的复现路径；全部为负向/边界断言，防止门禁覆盖缺口复发：
- A-03 部分环境更新不得删除未提交环境（主回归在 test_sdd12_secret_lifecycle）；
- B-03 PUT 不得写/清 Secret（同上）；
- C-04 default_env 必须存在于合并后的环境集合（ghost 拒绝落库）；
- 附加：归档连接拒绝 test/rotate/clear；rotate 按 kind 做结构校验。
"""
import uuid

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def u(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:6]}"


def _mk(envs=None, kind="api_key", secret=None) -> dict:
    body = {"name": u("neg"), "protocol": "http-api", "kind": kind,
            "endpoint": {"base_url": "https://invalid.example/"}}
    if envs is not None:
        body["environments"] = envs
    if secret is not None:
        body["secret"] = secret
    r = client.post("/api/connections", json=body)
    assert r.status_code == 201, r.text
    return r.json()


# ---------- C-04：default_env 必须存在于合并后的环境集合 ----------

def test_c04_ghost_default_env_rejected():
    c = _mk(envs=[{"code": "dev", "label": "日常",
                   "endpoint": {"base_url": "https://dev.example/"}}])
    r = client.put(f"/api/connections/{c['id']}", json={"default_env": "ghost"})
    assert r.status_code == 422, f"ghost default_env 不得落库，实际 {r.status_code}"
    assert r.json()["detail"]["code"] == "VALIDATION_FAILED"
    # 未被污染
    g = client.get(f"/api/connections/{c['id']}").json()
    assert g["defaultEnv"] != "ghost"


def test_c04_valid_default_env_switch_ok():
    c = _mk(envs=[
        {"code": "dev", "label": "日常", "endpoint": {"base_url": "https://dev.example/"}},
        {"code": "prod", "label": "生产", "endpoint": {"base_url": "https://prod.example/"}},
    ])
    r = client.put(f"/api/connections/{c['id']}", json={"default_env": "prod"})
    assert r.status_code == 200, r.text
    assert client.get(f"/api/connections/{c['id']}").json()["defaultEnv"] == "prod"


def test_c04_removing_default_env_without_repoint_rejected():
    c = _mk(envs=[
        {"code": "dev", "label": "日常", "endpoint": {"base_url": "https://dev.example/"}},
        {"code": "prod", "label": "生产", "endpoint": {"base_url": "https://prod.example/"}},
    ])
    client.put(f"/api/connections/{c['id']}", json={"default_env": "dev"})
    # 删除当前默认环境且不指向新默认 → 拒绝（避免产生悬空 default_env）
    r = client.put(f"/api/connections/{c['id']}",
                   json={"environments": [{"code": "dev", "remove": True}]})
    assert r.status_code == 422
    # 同时指向保留的环境 → 允许
    r2 = client.put(f"/api/connections/{c['id']}",
                    json={"environments": [{"code": "dev", "remove": True}],
                          "default_env": "prod"})
    assert r2.status_code == 200, r2.text
    g = client.get(f"/api/connections/{c['id']}").json()
    assert g["defaultEnv"] == "prod" and [e["code"] for e in g["environments"]] == ["prod"]


def test_c04_create_with_ghost_default_env_rejected():
    r = client.post("/api/connections", json={
        "name": u("neg"), "protocol": "http-api", "kind": "none",
        "endpoint": {"base_url": "https://invalid.example/"},
        "environments": [{"code": "dev", "label": "日常"}],
        "default_env": "nope"})
    assert r.status_code == 422


# ---------- 附加缺口 1：归档连接拒绝 test / rotate / clear ----------

def test_archived_connection_rejects_test_rotate_clear():
    c = _mk(secret="arch-canary")
    d = client.delete(f"/api/connections/{c['id']}")
    assert d.status_code == 200 and d.json()["lifecycle"] == "archived"

    t = client.post(f"/api/connections/{c['id']}/test", json={})
    assert t.status_code == 409 and t.json()["detail"]["code"] == "CONNECTION_DISABLED", \
        "归档连接不得再探测/写 CheckRun"

    rot = client.post(f"/api/connections/{c['id']}/secret:rotate", json={"secret": "x"})
    assert rot.status_code == 409 and rot.json()["detail"]["code"] == "CONNECTION_DISABLED"

    clr = client.post(f"/api/connections/{c['id']}/secret:clear",
                      json={"confirm": "CLEAR_SECRET"})
    assert clr.status_code == 409 and clr.json()["detail"]["code"] == "CONNECTION_DISABLED"

    upd = client.put(f"/api/connections/{c['id']}", json={"name": "x"})
    assert upd.status_code == 409

    en = client.post(f"/api/connections/{c['id']}:enable")
    assert en.status_code == 409 and en.json()["detail"]["code"] == "CONNECTION_DISABLED"


# ---------- 附加缺口 2：rotate 按 kind 做结构校验 ----------

def test_rotate_validates_basic_structure():
    c = _mk(kind="basic", secret={"username": "u0", "password": "p0"})
    bad = client.post(f"/api/connections/{c['id']}/secret:rotate", json={"secret": "plain-string"})
    assert bad.status_code == 422, "basic 不得被轮换为普通字符串"
    good = client.post(f"/api/connections/{c['id']}/secret:rotate",
                       json={"secret": {"username": "u1", "password": "p1"}})
    assert good.status_code == 200 and good.json()["versionNo"] == 2


def test_rotate_validates_aksk_structure():
    c = _mk(kind="aksk", secret={"access_key": "AK0", "secret_key": "SK0"})
    bad = client.post(f"/api/connections/{c['id']}/secret:rotate",
                      json={"secret": {"access_key": "AK1"}})
    assert bad.status_code == 422, "aksk 缺 secret_key 不得轮换成功"
    bad2 = client.post(f"/api/connections/{c['id']}/secret:rotate", json={"secret": "plain"})
    assert bad2.status_code == 422
    good = client.post(f"/api/connections/{c['id']}/secret:rotate",
                       json={"secret": {"access_key": "AK1", "secret_key": "SK1"}})
    assert good.status_code == 200 and good.json()["versionNo"] == 2


def test_rotate_api_key_accepts_string():
    c = _mk(kind="api_key", secret="k0")
    good = client.post(f"/api/connections/{c['id']}/secret:rotate", json={"secret": "k1"})
    assert good.status_code == 200


def test_create_validates_structured_secret():
    """创建与轮换同源校验：aksk/basic 不得用普通字符串创建。"""
    r = client.post("/api/connections", json={
        "name": u("neg"), "protocol": "http-api", "kind": "aksk",
        "endpoint": {"base_url": "https://invalid.example/"}, "secret": "plain"})
    assert r.status_code == 422
    r2 = client.post("/api/connections", json={
        "name": u("neg"), "protocol": "http-api", "kind": "basic",
        "endpoint": {"base_url": "https://invalid.example/"}, "secret": {"password": "no-user"}})
    assert r2.status_code == 422
