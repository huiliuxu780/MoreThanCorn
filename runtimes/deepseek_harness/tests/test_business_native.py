"""R8-UI-5：business-analysis DSH 原生实现验证。

- native_assets_for_mode 三模式选择（纯函数）；
- node 驱动 native_business_analysis.mjs 状态机：identify 校验、阶段工具守卫、
  每计划恰好一次正确工具调用、完成屏障、synthesize 输出对齐冻结 Schema 键。"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from app.adapter import (
    BUSINESS_BUNDLE,
    NATIVE_BUNDLE,
    native_assets_for_mode,
)

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
PLUGIN = RUNTIME_ROOT / "plugins" / "native_business_analysis.mjs"

DRIVER = """
import { apply } from %PLUGIN_JSON%
const registered = {}
function makeAgent() {
  const guards = []; const listeners = []
  const agent = {
    ctx: {
      systemPrompt: { section: () => {} },
      tools: {
        register: (t) => { registered[t.name] = t },
        restrict: () => {},
        guard: (fn) => guards.push(fn),
      },
      on: (ev, fn) => listeners.push([ev, fn]),
    },
    session: { events: [] },
  }
  return { agent, guards, listeners }
}
let handler = null
const ctx = { on: (ev, fn) => { handler = fn } }
apply(ctx, { metricTool: 'mcp__quality__metric_query', dimensionTool: 'mcp__quality__dimension_query' })
const { agent, guards, listeners } = makeAgent()
handler({ agent })
const submit = registered['business_analysis_submit']
if (!submit) throw new Error('submit tool not registered')
const toolResult = listeners.find(([ev]) => ev === 'tools/result')[1]

let v = await submit.execute({ stage: 'identify', payload: { question_id: 'Q1', plans: [
  { kind: 'metric', subject: 'refund_rate', query: 'q1' },
  { kind: 'dimension', subject: 'by_region', query: 'q2' },
] } })
if (v.next_stage !== 'execute/metric-1') throw new Error('bad next_stage ' + v.next_stage)
if (guards[0]({ name: 'mcp__quality__dimension_query' }) === undefined)
  throw new Error('guard must forbid dimension tool at metric stage')
if (guards[0]({ name: 'mcp__quality__metric_query' }) !== undefined)
  throw new Error('guard must allow metric tool at metric stage')

toolResult({ name: 'mcp__quality__metric_query' })
v = await submit.execute({ stage: 'execute/metric-1', payload: { value: 3.2, unit: '%%',
  citations: [{ source: 'metric_query', reference: 'r1', summary: 's' }] } })
if (v.next_stage !== 'execute/dimension-2') throw new Error('bad stage after metric ' + v.next_stage)

toolResult({ name: 'mcp__quality__dimension_query' })
v = await submit.execute({ stage: 'execute/dimension-2', payload: { value: 4, unit: 'rows',
  citations: [{ source: 'dimension_query', reference: 'r2' }] } })
if (v.next_stage !== 'synthesize') throw new Error('barrier should lead to synthesize')

// synthesis_state 随最后一次 execute submit 返回；synthesize 阶段无 submit 且禁工具
const s = v.synthesis_state
for (const key of ['question_id', 'answer', 'metrics', 'citations']) {
  if (!(key in s)) throw new Error('synthesis missing ' + key)
}
if (s.question_id !== 'Q1' || s.metrics.length !== 1 || s.metrics[0].value !== 3.2)
  throw new Error('synthesis content mismatch')
if (s.citations.length !== 2) throw new Error('citations not aggregated')
if (guards[0]({ name: 'mcp__quality__metric_query' }) === undefined)
  throw new Error('synthesize stage must forbid enterprise tools')
console.log('BUSINESS_PLUGIN_OK')
"""


def test_native_assets_for_mode():
    biz = native_assets_for_mode("business_analysis_v1")
    assert biz == {"config": "native_business.cordis.yml",
                   "plugin": "native_business_analysis.mjs",
                   "bundle": BUSINESS_BUNDLE, "native": True, "no_tools": False}
    qual = native_assets_for_mode("native_quality_v0.2")
    assert qual["bundle"] == NATIVE_BUNDLE and qual["native"] is True
    plain = native_assets_for_mode(None)
    assert plain["bundle"] is None and plain["native"] is False
    no_tools = native_assets_for_mode("independent_no_tools_v1")
    assert no_tools["config"] == "no_tools.cordis.yml" and no_tools["no_tools"] is True
    assert (RUNTIME_ROOT / "config" / biz["config"]).is_file()
    assert (RUNTIME_ROOT / "plugins" / biz["plugin"]).is_file()


def test_business_plugin_state_machine():
    node = shutil.which("node")
    if not node:
        pytest.skip("node 不可用")
    driver = DRIVER.replace("%PLUGIN_JSON%", json.dumps(str(PLUGIN)))
    out = subprocess.run([node, "--input-type=module", "-e", driver],
                         capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    assert "BUSINESS_PLUGIN_OK" in out.stdout
