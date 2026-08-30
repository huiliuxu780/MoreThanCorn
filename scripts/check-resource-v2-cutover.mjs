#!/usr/bin/env node
/** SDD-12 §19.3 / 验收 J-03：P0 切流不变量静态门禁。
 *
 * 断言以下"不得回退"的 P0 成果（任一被改回旧形态即失败）：
 *   1. 服务端不再信任 payload.tested（`_check_tested` 恒 False）；
 *   2. 删除 Connection 不再静默解绑引用（409 + refs，引用方不改）；
 *   3. reveal 恒 410；
 *   4. MCP/Knowledge/Tool/LLM 的 mock/echo 路径受 fixtures_enabled() 门控；
 *   5. ConnectionSecretRevision / CheckRun 表存在；
 *   6. 契约层错误码表冻结。
 *
 * 用法：node scripts/check-resource-v2-cutover.mjs   （违规 → 非零退出）
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const APP = join(ROOT, "server", "app");
const read = (p) => readFileSync(join(APP, p), "utf8");

const failures = [];
const ok = (cond, label) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
};

// 1. tested 不被信任
{
  const res = read("routers/resources.py");
  const m = res.match(/def _check_tested[\s\S]*?return False/);
  ok(!!m && !/payload\.get\("tested"\)/.test(m[0]),
     "P0-04：_check_tested 恒 False（不读取客户端 tested）");
  const assigns = [...res.matchAll(/^\s*tested\s*=\s*(.+)$/gm)].map((x) => x[1].trim());
  ok(assigns.length >= 1 && assigns.every((v) => v === "_check_tested(p)"),
     "P0-04：创建路径的 tested 只派生自 _check_tested（无其他自报来源）");
}

// 2. 删除连接不再静默解绑
{
  const admin = read("routers/admin.py");
  const del = admin.match(/def delete_connection[\s\S]*?(?=\n@router\.)/);
  ok(!!del, "删除连接路由存在");
  if (del) {
    ok(!/auth_connection_id = None|connection_id = None/.test(del[0]),
       "P0-03：delete_connection 不再静默解绑引用方");
    ok(/409/.test(del[0]) && /REFERENCE_CONFLICT/.test(del[0]),
       "P0-03：有引用删除返回 409 REFERENCE_CONFLICT");
    ok(/lifecycle = "archived"/.test(del[0]),
       "B-07：默认删除执行为归档（软删除）");
    ok(/lifecycle != "draft"/.test(del[0]),
       "B-07：硬删除仅限无引用 draft");
  }
}

// 3. reveal 恒 410
{
  const admin = read("routers/admin.py");
  const rv = admin.match(/def reveal_connection[\s\S]*?(?=\n@router\.|\ndef )/);
  ok(!!rv && /410/.test(rv[0]) && /SECRET_REVEAL_DISABLED/.test(rv[0]) && !/decrypt/.test(rv[0]),
     "B-01：reveal 恒 410 SECRET_REVEAL_DISABLED 且不解密");
}

// 4. mock/echo 受 fixture 门控
{
  const rt = read("resource_tests.py");
  const runner = read("runner.py");
  ok(/fixtures_enabled/.test(rt), "P0-05：resource_tests mock 路径受 fixtures_enabled 门控");
  ok(/fixtures_enabled/.test(runner), "P0-05：runner（LLM mock / echo tool）受 fixtures_enabled 门控");
}

// 5. 新表存在
{
  const models = read("models.py");
  ok(/class ConnectionSecretRevision\(Base\)/.test(models), "§5.3：ConnectionSecretRevision 表模型存在");
  ok(/class CheckRun\(Base\)/.test(models), "§11.3：CheckRun 表模型存在");
  ok(/lifecycle/.test(models) && /draft\|active\|disabled\|archived/.test(models),
     "§5.1：Connection.lifecycle 生命周期字段存在");
}

// 6. 契约错误码冻结
{
  const contracts = read("contracts.py");
  for (const code of ["SECRET_REVEAL_DISABLED", "CONNECTION_UNCHECKED", "REFERENCE_CONFLICT",
                      "RESOURCE_HEALTH_STALE", "CONNECTION_AUTH_FAILED", "EGRESS_BLOCKED"]) {
    ok(contracts.includes(`"${code}"`), `契约层含错误码 ${code}`);
  }
}

console.log("");
if (failures.length) {
  console.error(`check-resource-v2-cutover：${failures.length} 项 P0 不变量被破坏`);
  process.exit(1);
}
console.log("check-resource-v2-cutover：PASS（P0 切流不变量完整）");
