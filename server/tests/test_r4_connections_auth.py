"""R4：Connection 鉴权升级——kind 真实枚举 / AkSk 签名 / 脚本沙箱 / 多环境解析。

验收基准：用户 Apifox 脚本（2026-08-30 对 gw.dev-corn.bshg.com.cn 实测 200）
原样进沙箱，产出 Authorization 须与服务端反向校验一致。
"""
import base64
import hashlib
import hmac
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from app.auth_sandbox import run_auth_script
from app.auth_signers import AuthSignError, build_auth_headers, normalize_kind, sign_aksk
from app.connection_runtime import resolve_for_request
from app.main import app

client = TestClient(app)

AK = "test-ak"
SK = "test-sk"

# 用户 Apifox 预请求脚本原样（验收 fixture）
USER_SCRIPT = """
const accesskey = pm.environment.get("accesskey");
const secretKey = pm.environment.get("secretKey");
if (!accesskey || !secretKey) {
    pm.alert("请先在环境变量中配置accesskey和secretKey！");
    return;
}
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
function encrypt2MD5(str) {
    if (!str || str.trim() === "") return "";
    return CryptoJS.MD5(str).toString(CryptoJS.enc.Utf8);
}
function hmacSha1Sign(key, data) {
    const hmac = CryptoJS.HmacSHA1(data, key);
    return CryptoJS.enc.Base64.stringify(hmac);
}
const timeStamp = new Date().getTime();
const nonce = uuidv4();
const content = "";
const encryptContent = encrypt2MD5(content);
const stringToSign = `${accesskey}:${timeStamp}:${nonce}:${encryptContent}`;
const signature = hmacSha1Sign(secretKey, stringToSign);
const authValueRaw = `${signature}:${stringToSign}`;
const authValue = btoa(authValueRaw);
pm.request.headers.add({
    key: "Authorization",
    value: `BasicAKSK ${authValue}`
});
console.log("生成的UUID:", nonce);
"""


def _verify_aksk(auth: str, ak: str, sk: str, max_age_ms: int = 15_000) -> None:
    """服务端反向校验 BasicAKSK 头：结构 + HMAC + 时间戳新鲜度。"""
    assert auth.startswith("BasicAKSK ")
    inner = base64.b64decode(auth[len("BasicAKSK "):]).decode()
    sig, sts = inner.split(":", 1)
    p_ak, ts, _nonce, content = sts.split(":")
    assert p_ak == ak and content == ""
    assert abs(int(ts) - int(time.time() * 1000)) < max_age_ms
    expect = base64.b64encode(hmac.new(sk.encode(), sts.encode(), hashlib.sha1).digest()).decode()
    assert sig == expect


# ---------- 内置签名层 ----------

def test_aksk_signer_fixed_vector():
    auth = sign_aksk("AK", "SK", ts_ms=1700000000000, nonce="n-1")
    _verify_aksk_sts(auth, "AK", "SK", "1700000000000", "n-1")


def _verify_aksk_sts(auth, ak, sk, ts, nonce):
    inner = base64.b64decode(auth[len("BasicAKSK "):]).decode()
    sig, sts = inner.split(":", 1)
    assert sts == f"{ak}:{ts}:{nonce}:"
    assert sig == base64.b64encode(
        hmac.new(sk.encode(), sts.encode(), hashlib.sha1).digest()).decode()


def test_builtin_kinds_headers():
    assert build_auth_headers("bearer", "tok") == {"Authorization": "Bearer tok"}
    assert build_auth_headers("api_key", "k1") == {"X-API-Key": "k1"}
    assert build_auth_headers("basic", {"username": "u", "password": "p"}) == {
        "Authorization": "Basic " + base64.b64encode(b"u:p").decode()}
    assert build_auth_headers("none", {}) == {}
    _verify_aksk(build_auth_headers("aksk", {"access_key": AK, "secret_key": SK})["Authorization"], AK, SK)


def test_kind_normalization_and_errors():
    assert normalize_kind("API Key") == "api_key"
    assert normalize_kind("Bearer Token") == "bearer"
    assert normalize_kind("Basic Auth") == "basic"
    with pytest.raises(AuthSignError):
        normalize_kind("oauth9000")
    with pytest.raises(AuthSignError):
        build_auth_headers("aksk", "raw-string")  # aksk 必须双键结构
    with pytest.raises(AuthSignError):
        build_auth_headers("script", {})  # 无脚本


# ---------- 脚本沙箱 ----------

def test_sandbox_user_script_roundtrip():
    headers, logs = run_auth_script(USER_SCRIPT, {"accesskey": AK, "secretKey": SK})
    _verify_aksk(headers["Authorization"], AK, SK)
    assert any("生成的UUID" in line for line in logs)


def test_sandbox_alert_and_timeout():
    with pytest.raises(AuthSignError, match="accesskey"):
        run_auth_script(USER_SCRIPT, {})
    with pytest.raises(AuthSignError, match="超时"):
        run_auth_script("while(true){}", {})


# ---------- 环境解析 ----------

class _Conn:
    def __init__(self, **kw):
        self.endpoint = kw.get("endpoint", {})
        self.environments = kw.get("environments", [])
        self.default_env = kw.get("default_env")
        self.secret_ref = kw.get("secret_ref", "")
        self.kind = kw.get("kind", "none")
        self.auth_script = None


def test_env_resolution_override_and_fallback():
    conn = _Conn(endpoint={"base_url": "https://default.example"},
                 environments=[
                     {"code": "dev", "label": "日常", "endpoint": {"base_url": "https://dev.example"}},
                     {"code": "prod", "label": "生产",
                      "endpoint": {"base_url": "https://prod.example"}, "secret_ref": "prodsecret"},
                 ],
                 default_env="dev", secret_ref="rootsecret")
    ep, payload, code = resolve_for_request(conn)
    assert (ep["base_url"], payload, code) == ("https://dev.example", "rootsecret", "dev")
    ep, payload, code = resolve_for_request(conn, "prod")
    assert (ep["base_url"], payload, code) == ("https://prod.example", "prodsecret", "prod")
    # 未配 endpoint 的环境回落 connection 级
    ep, _p, _c = resolve_for_request(_Conn(endpoint={"base_url": "https://x"}, environments=[{"code": "dev"}]), "dev")
    assert ep["base_url"] == "https://x"


# ---------- API 层 ----------

def _create(payload):
    r = client.post("/api/connections", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def test_api_crud_environments_and_reveal():
    cid = _create({
        "name": "r4-gw", "kind": "aksk", "protocol": "http-api",
        "endpoint": {"base_url": "https://gw.dev-corn.bshg.com.cn/"},
        "environments": [
            {"code": "dev", "label": "日常",
             "endpoint": {"base_url": "https://gw.dev-corn.bshg.com.cn/"}},
            {"code": "prod", "label": "生产",
             "endpoint": {"base_url": "https://gw.xixikf.com/"},
             "secret": {"access_key": "AK2", "secret_key": "SK2"}},
        ],
        "default_env": "dev",
        "secret": {"access_key": AK, "secret_key": SK},
    })["id"]
    try:
        rows = client.get("/api/connections", params={"search": "r4-gw"}).json()["items"]
        row = rows[0]
        assert row["kind"] == "aksk"
        assert [e["code"] for e in row["environments"]] == ["dev", "prod"]
        assert row["environments"][1]["secretConfigured"] is True
        assert "secret_ref" not in row["environments"][0]

        rv = client.get(f"/api/connections/{cid}/reveal")
        # SDD-12 §5.3 / B-01：Secret 回显已永久关闭（410），只可轮换
        assert rv.status_code == 410
        assert rv.json()["detail"]["code"] == "SECRET_REVEAL_DISABLED"
        # 列表只暴露 configured 状态与版本信息，不回明文
        assert row["secretConfigured"] is True
        assert row["secretRevision"]["configured"] is True
        assert row["secretRevision"]["versionNo"] == 1

        # SDD-12 P0-01：只改 label/endpoint 的普通更新不得丢环境 Secret
        upd = client.put(f"/api/connections/{cid}", json={
            "environments": [
                {"code": "dev", "label": "日常-改",
                 "endpoint": {"base_url": "https://gw.dev-corn.bshg.com.cn/v2"}},
                {"code": "prod", "label": "生产"},
            ], "default_env": "dev"})
        assert upd.status_code == 200, upd.text
        row2 = client.get("/api/connections", params={"search": "r4-gw"}).json()["items"][0]
        assert row2["environments"][1]["secretConfigured"] is True  # prod 密钥未丢
        assert row2["environments"][1]["secretRevision"]["versionNo"] == 1  # 未产生新 revision
        assert row2["secretConfigured"] is True  # 根密钥未丢

        # 校验：default_env 必须已配置；script 必须带脚本
        bad = client.post("/api/connections", json={"name": "r4-bad", "kind": "aksk",
                                                    "default_env": "nope",
                                                    "secret": {"access_key": "a", "secret_key": "b"}})
        assert bad.status_code == 422
        bad2 = client.post("/api/connections", json={"name": "r4-bad2", "kind": "script"})
        assert bad2.status_code == 422
    finally:
        client.delete(f"/api/connections/{cid}")


def test_api_legacy_kind_normalized():
    cid = _create({"name": "r4-legacy", "kind": "API Key", "secret": "k"})["id"]
    try:
        row = client.get("/api/connections", params={"search": "r4-legacy"}).json()["items"][0]
        assert row["kind"] == "api_key"
    finally:
        client.delete(f"/api/connections/{cid}")


def test_api_dry_run_sign_script():
    r = client.post("/api/connections/dry-run-sign",
                    json={"kind": "script", "script": USER_SCRIPT,
                          "envVars": {"accesskey": AK, "secretKey": SK}})
    assert r.status_code == 200, r.text
    _verify_aksk(r.json()["headers"]["Authorization"], AK, SK)
    bad = client.post("/api/connections/dry-run-sign", json={"kind": "script", "script": "pm.alert('x')"})
    assert bad.status_code == 400
