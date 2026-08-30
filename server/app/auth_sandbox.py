"""自定义鉴权脚本沙箱：子进程隔离执行嵌入式 QuickJS。

为什么是子进程：quickjs(1.19.4) 的 set_time_limit 无法打断纯 JS 死循环
（C 层 eval 循环不可被 Python 信号/中断抢占，实测挂死），故用 OS 级硬超时：
subprocess.run(timeout) 到点杀进程，死循环/爆内存都伤不到主服务。

提供 Apifox/Postman 兼容 shim（pm.environment.get / pm.request.headers.add /
pm.alert / console.log / btoa / CryptoJS），用户的 Apifox 预请求脚本原样粘贴
即可运行。脚本以函数体包裹执行（兼容顶层 return）。
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

try:  # 包内导入；作为 --worker 顶层脚本运行时退化为本地定义
    from .auth_signers import AuthSignError
except ImportError:  # pragma: no cover - worker 进程路径
    class AuthSignError(Exception):
        pass

_VENDOR_CRYPTO = Path(__file__).parent / "vendor" / "crypto-js.js"

# 单次执行硬超时（秒）：含子进程启动；脚本本身应在毫秒级完成
TIME_LIMIT_S = 5
MEMORY_LIMIT = 64 * 1024 * 1024

_SHIM_PRE = """
const __env = {env_json};
const __out = {{ headers: {{}}, logs: [] }};
// 纯 JS btoa（latin1→base64）
const btoa = (input) => {{
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const s = String(input);
  let out = "", i = 0;
  while (i < s.length) {{
    const c1 = s.charCodeAt(i++) & 0xff;
    if (i === s.length) {{ out += chars[c1 >> 2] + chars[(c1 & 3) << 4] + "=="; break; }}
    const c2 = s.charCodeAt(i++) & 0xff;
    if (i === s.length) {{ out += chars[c1 >> 2] + chars[((c1 & 3) << 4) | (c2 >> 4)] + chars[(c2 & 15) << 2] + "="; break; }}
    const c3 = s.charCodeAt(i++) & 0xff;
    out += chars[c1 >> 2] + chars[((c1 & 3) << 4) | (c2 >> 4)] + chars[((c2 & 15) << 2) | (c3 >> 6)] + chars[c3 & 63];
  }}
  return out;
}};
const pm = {{
  environment: {{
    get: (k) => (Object.prototype.hasOwnProperty.call(__env, k) ? __env[k] : undefined),
  }},
  request: {{
    headers: {{
      add: (h) => {{
        if (h && h.key != null) {{ __out.headers[String(h.key)] = String(h.value == null ? "" : h.value); }}
      }},
    }},
  }},
  alert: (m) => {{ throw new Error("script alert: " + String(m)); }},
}};
const console = {{
  log: (...a) => {{ __out.logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); }},
}};
"""


def _run_in_process(script: str, env: dict) -> dict:
    """worker 进程内执行（无 IO/网络/fs 暴露）。"""
    import quickjs
    ctx = quickjs.Context()
    ctx.set_memory_limit(MEMORY_LIMIT)
    ctx.eval(_VENDOR_CRYPTO.read_text(encoding="utf-8"))
    ctx.eval(_SHIM_PRE.format(env_json=json.dumps(env or {}, ensure_ascii=False)))
    ctx.eval("(function(){\n" + script + "\n})()")
    return json.loads(ctx.eval("JSON.stringify(__out)"))


def run_auth_script(script: str, env: dict | None = None) -> tuple[dict[str, str], list[str]]:
    """执行鉴权脚本，返回 (产出的请求头, console 日志)。异常统一抛 AuthSignError。"""
    payload = json.dumps({"script": script, "env": env or {}}, ensure_ascii=False)
    try:
        proc = subprocess.run([sys.executable, str(Path(__file__)), "--worker"],
                              input=payload, capture_output=True, text=True,
                              timeout=TIME_LIMIT_S)
    except subprocess.TimeoutExpired as exc:
        raise AuthSignError(f"鉴权脚本执行超时（>{TIME_LIMIT_S}s，疑似死循环），已强制终止") from exc
    if proc.returncode != 0:
        raise AuthSignError(f"鉴权脚本执行崩溃：{(proc.stderr or '')[-300:]}")
    try:
        out = json.loads(proc.stdout)
    except Exception as exc:  # noqa: BLE001
        raise AuthSignError(f"鉴权脚本输出非法：{exc}") from exc
    if "error" in out:
        raise AuthSignError(f"鉴权脚本执行失败：{out['error']}")
    headers = {str(k): str(v) for k, v in (out.get("headers") or {}).items()}
    logs = [str(x) for x in (out.get("logs") or [])]
    return headers, logs


def _worker_main() -> None:  # pragma: no cover - 子进程入口
    req = json.loads(sys.stdin.read())
    try:
        out = _run_in_process(req.get("script") or "", req.get("env") or {})
    except Exception as exc:  # noqa: BLE001 —— JS 异常/内存等经 stdout 回传
        out = {"error": str(exc)}
    sys.stdout.write(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    if "--worker" in sys.argv:
        _worker_main()
