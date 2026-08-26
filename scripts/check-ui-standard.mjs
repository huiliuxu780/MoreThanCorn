/** 07-SDD §9.1/V1/V4：组件标准静态检查。
 *  禁原生 select/option/裸 input/textarea/window.alert-confirm-prompt/手搓 switch；
 *  allowlist 只减不增；components/wf 台账比对。
 *  用法：node scripts/check-ui-standard.mjs [--seed] */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
const ALLOW = join(ROOT, "scripts/ui-allowlist.json");
const seed = process.argv.includes("--seed");

const PATTERNS = {
  "native-select": /<select[\s>]/,
  "native-option": /<option[\s>]/,
  "raw-input": /<input[\s>]/,
  "raw-textarea": /<textarea[\s>]/,
  "window-dialog": /window\.(alert|confirm|prompt)\(/,
  "handmade-switch": /role=["']switch["']/,
};

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(f)) out.push(p);
  }
  return out;
}

const counts = {}; // key: pattern|relfile -> n
for (const p of walk(SRC)) {
  const rel = relative(SRC, p);
  if (rel.startsWith("components/ui/")) continue; // shadcn 本体豁免
  const lines = readFileSync(p, "utf-8").split("\n");
  lines.forEach((ln, i) => {
    for (const [name, re] of Object.entries(PATTERNS)) {
      if (re.test(ln)) {
        const k = `${name}|${rel}`;
        counts[k] = (counts[k] ?? 0) + 1;
      }
    }
  });
}

// 台账：components/wf 只允许登记文件（新增须先更新 SDD §6.2 与本清单）
const WF_ALLOWED = new Set(["controls.tsx", "sections.tsx", "field-controls.tsx", "form-renderer.tsx"]);
const wfDir = join(SRC, "components/wf");
const wfFiles = existsSync(wfDir) ? readdirSync(wfDir).filter((f) => f.endsWith(".tsx")) : [];
const ledgerViol = wfFiles.filter((f) => !WF_ALLOWED.has(f));

if (seed) {
  writeFileSync(ALLOW, JSON.stringify(counts, null, 2));
  console.log("seeded allowlist:", Object.keys(counts).length, "keys");
  process.exit(0);
}

const allow = existsSync(ALLOW) ? JSON.parse(readFileSync(ALLOW, "utf-8")) : {};
const fails = [];
for (const [k, n] of Object.entries(counts)) {
  if ((allow[k] ?? 0) < n) fails.push(`${k} 新增命中 ${n}（基线 ${allow[k] ?? 0}）`);
}
for (const k of Object.keys(allow)) {
  if (!counts[k]) console.log("  (基线已清零，可移除 allowlist 键:", k, ")");
}
for (const f of ledgerViol) fails.push(`components/wf 未登记文件: ${f}（先更新 SDD §6.2）`);

if (fails.length) {
  console.error("UI 标准检查失败:");
  fails.forEach((f) => console.error(" -", f));
  process.exit(1);
}
console.log("UI 标准检查通过：无新增违规；components/wf 台账一致。");
