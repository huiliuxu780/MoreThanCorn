#!/usr/bin/env node
/** 09-SDD P1-11：发布包完整性检查（锁文件 / 镜像 / 文档 / 单一迁移 head）。
 * 任一缺失 → 非零退出。 */
import { existsSync, readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import process from "node:process"

const ROOT = new URL("..", import.meta.url).pathname
let failures = 0
const check = (cond, label) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`)
  if (!cond) failures++
}

check(existsSync(`${ROOT}server/requirements.txt`), "后端依赖锁 server/requirements.txt 存在")
const req = existsSync(`${ROOT}server/requirements.txt`) ? readFileSync(`${ROOT}server/requirements.txt`, "utf8") : ""
check(req.includes("==") && !/^[a-z-]+$/m.test(req.trim()), "requirements.txt 为固定版本（含 ==）")
check(existsSync(`${ROOT}package-lock.json`), "前端依赖锁 package-lock.json 存在")
check(existsSync(`${ROOT}server/Dockerfile`), "后端镜像 server/Dockerfile 存在")
check(existsSync(`${ROOT}docs/ops/release.md`), "发布文档 docs/ops/release.md 存在")
check(existsSync(`${ROOT}docs/ops/runbook.md`), "运维 Runbook docs/ops/runbook.md 存在")

// 单一迁移 head（可复现迁移链）
try {
  const heads = execSync(".venv/bin/alembic heads", { cwd: `${ROOT}server`, encoding: "utf8" })
    .split("\n").filter((l) => l.trim())
  check(heads.length === 1, `alembic 单一 head（实际 ${heads.length}）`)
} catch (e) {
  check(false, "alembic heads 可执行")
}

console.log(`\n发布包检查：${failures === 0 ? "通过" : `${failures} 项缺失`}`)
process.exit(failures === 0 ? 0 : 1)
