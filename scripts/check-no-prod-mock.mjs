#!/usr/bin/env node
/** 09-SDD P0-01 / SDD-12 P0-05 机器门禁：生产路径 mock/fallback 可达性静态扫描。
 *
 * 规则：server/app 下每个包含 mock 字面量的函数体，必须同时包含
 * is_production() / code_node_enabled() / fixtures_enabled() 守卫
 * （即生产分支失败关闭；fixtures_enabled() 在生产恒为 false）。
 * 模块级 `_MOCK_*` 常量允许存在（仅供已守卫函数引用），注释/文档串不计。
 *
 * 用法：node scripts/check-no-prod-mock.mjs   （违规 → 非零退出）
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const APP = join(ROOT, "server", "app");

// 触发扫描的字面量（生产不得无守卫出现）
const MOCK_PATTERNS = [
  /mock:\/\//,
  /\[mock/,
  /"mock |'mock |mock 回落|mock：|（mock|\(mock/,
  /mock-\*|mock ok|mock 10|示例工具清单/,
];
// 守卫标记。SDD-12 P0-05：fixtures_enabled() 为新的失败关闭守卫
//（生产恒返回 false，等价于生产分支失败关闭）。
const GUARD = /is_production\(|code_node_enabled\(|fixtures_enabled\(/;

function* pyFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "__pycache__") continue;
      yield* pyFiles(p);
    } else if (name.endsWith(".py")) yield p;
  }
}

/** 粗粒度提取函数体：def 行 → 下一个缩进不深于它的 def/class/@router 行。 */
function functions(lines) {
  const out = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^(\s*)(?:async\s+)?def\s+(\w+)/);
    const isTop = /^\s*(class |@)/.test(line);
    if (cur && (m && m[1].length <= cur.indent) || (cur && isTop)) {
      out.push(cur);
      cur = null;
    }
    if (m) {
      cur = { name: m[2], indent: m[1].length, start: i, body: [] };
    } else if (cur) {
      cur.body.push(line);
    }
  }
  if (cur) out.push(cur);
  return out;
}

function stripComments(line) {
  return line.replace(/#.*$/, "");
}

const violations = [];
let scanned = 0;
for (const file of pyFiles(APP)) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  // 模块级：docstring/注释之外的 mock 常量必须命名为 _MOCK_*
  let inDoc = false;
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (line.startsWith('"""') || line.startsWith("'''")) inDoc = !inDoc;
    if (inDoc || line.startsWith("#")) return;
    const code = stripComments(raw);
    if (!MOCK_PATTERNS.some((p) => p.test(code))) return;
    const isModuleAssign = /^\s*_MOCK_\w+\s*=/.test(raw) || /^\s*_MOCK_\w+/.test(raw);
    if (raw.match(/^\S/) && isModuleAssign) return; // 模块级 _MOCK_* 常量
    // 定位所属函数
    const fns = functions(lines);
    const owner = fns.find((f) => idx > f.start && idx <= f.start + f.body.length + 1);
    if (!owner) {
      violations.push(`${file}:${idx + 1} mock 字面量不在函数内且非常量：${line.slice(0, 80)}`);
      return;
    }
    if (!GUARD.test(owner.body.join("\n"))) {
      violations.push(`${file}:${idx + 1} 函数 ${owner.name}() 含 mock 路径但无生产守卫`);
    }
  });
  scanned++;
}

console.log(`check-no-prod-mock：扫描 ${scanned} 个后端模块`);
if (violations.length) {
  console.error(`✗ ${violations.length} 处生产可达 mock 风险：`);
  for (const v of violations) console.error("  - " + v);
  process.exit(1);
}
console.log("✓ 所有 mock/fallback 路径均有生产守卫（fail closed）");
