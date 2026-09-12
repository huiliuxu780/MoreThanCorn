# P1+P2 脚本编排引擎 · 自验记录（2026-09-12）

> 设计：`docs/v2-design/16-wakerflow-script-agentflow.md` v1.1（D1=子进程沙箱 / D2=DAG 冻结共存 / D3=NL 生成 P4 后置）
> 状态：P1+P2 完成，未提交待验收；真实运行时（8301）跨栈冒烟属 P5，须额度批准
> 证据可复现：命令均在 `server/` 执行

## 1. 交付内容

| 件 | 落点 | 说明 |
|---|---|---|
| 沙箱子进程 | `runtimes/agentscope/app/script_sandbox.py`（**纯 stdlib，可独立测试**） | `async def run(ctx)` 契约；五原语经 stdin/stdout 行 JSON RPC；`parallel` 单子失败降级 None；64KB 上限；`spawn_sandbox()` 加固 spawn（最小 env 不继承任何父变量 / rlimits CPU·AS·NOFILE / 临时 cwd / 脚本文件直入无需包上下文） |
| 运行时端点 | `runtimes/agentscope/app/script_runner.py` + `main.py` 挂载 | `POST /mtc/script-run`（SSE）：spawn 沙箱 → RPC 分派（worker=新建 Session+internal token 注册+structured/chat 执行+schema 校验，复用 DAG 节点执行件）→ 事件按 DAG 形状（`stage:{label}` start 带 session_id/agent_id/runtime_agent_id、end 带 status/output/error + `phase`/`log` + `flow:complete`）→ deadline 看门狗 SIGKILL + on_exit 兜底结算 |
| 平台分支 | `agentflow_executor.py` | `scan_script_wakers`（ast 扫描 `worker(waker=…)` 常量）、`validate_script_definition`（可解析/run 入口/meta 形状/waker 可解析/64KB，版本保存 422）、`build_script_body`（逐 waker 预解析 release 冻结绑定，缺绑定 fail fast）、`start_run`/`execute_agentflow_run` 按 `definition.kind=="script"` 分支（job 异步化/F0 增量落库/attempt 递增重跑全复用）；`_handle_flow_event` start 事件新增 `agent_id`/`runtime_agent_id` 字段 |
| 版本校验 | `routers/as_flows_board.py` | `create_version` 接受脚本形态定义并强校验 |
| 测试 | `server/tests/test_p1_script_agentflow.py`（13 条） | 见 §2 |
| conftest | hermetic 默认假件 | `script_run_stream` 默认成功流，防止测试残留 queued job 误执行 |

## 2. 测试证据（17/17 绿：13 新增 + 4 相关 F0）

```
.venv/bin/python -m pytest tests/test_p1_script_agentflow.py tests/test_f0_execution_truthfulness.py -q
  → 22 passed
```

分层：
1. **子进程语义（stub 传输，4 条）**：串行 golden（事件次序/label/schema 透传）；parallel 三扇出单子失败降级 None；for+askUser 循环（首轮「需要调整」→ 修订，次轮 skipped → break，worker 恰 2 次）；契约负向（缺 run/返回非 dict/超 64KB/worker 缺 waker 全部 ScriptError）。
2. **真实子进程（5 条，AC-S4）**：无 RPC done 结算 output 正确；RPC 往返（worker→父回响应→脚本拿结果）；deadline 自超时（async 挂起类）；同步死循环**无法自报 done、由父侧看门狗强杀**（语义澄清：子进程内 `asyncio.wait_for` 只覆盖异步挂起，同步死循环=父侧 kill，测试固化该事实）；崩溃结算 failed + exit 1；**env 断言零平台凭据**（TOKEN/SECRET/DATABASE 类变量为空）。
3. **平台分支（F0 探针法，3 条）**：扫描/构建 body（waker 预解析 + ghost waker 拒绝）；版本保存契约校验（4 类 422 + 1 类 200）；run-now queued→探针在 start/end 事件间查得 NodeRun(running)+SessionIndex(runtime_agent_id/agent_id 来自脚本事件)→终态结算 output。

## 3. 已知边界（诚实交底）

1. `askUser` 在运行时端暂以 RPC 错误结算（P2 接 needs_input/resume + ApprovalCard）——脚本用到即 run failed，诚实行为；
2. 同步死循环依赖父侧看门狗（deadline+5s）强杀，运行中该窗口内子进程占用一个 rlimit 限定的 CPU 核；
3. 子进程内完整 Python 的网络/文件访问=部署级收口（16号稿 §8 威胁模型），dev 前提=operator-only 编辑+内部部署；
4. 真实运行时 `/mtc/script-run` 跨栈链路（含 structured_run_core 出结构化输出、internal token 工具回调）未在本轮验证——P5 live 冒烟项；
5. callSites 投影/画布/执行记录 phase 聚合=P3 前端切片。

## 2A. P2 交付（askUser 挂起/恢复，AC-S3）

| 件 | 落点 | 说明 |
|---|---|---|
| 运行时挂起 | `script_runner.py` | `askUser` RPC → `needs_input` 事件（request_id/label/prompt/options）+ 进程内 Future 挂起；`POST /mtc/script-resume` 写回答复；run 结束/子进程死亡统一按 skipped 结算并清表（waiting 不跨进程持久=已登记边界）；Future 解析后补发 `stage:{label}` end 事件（output={value,skipped}） |
| 平台事件 | `agentflow_executor.py` | `needs_input` → NodeRun(status=waiting, input 存 request_id/prompt/options)；run 终态时剩余 waiting 节点统一 cancelled 结算 |
| 答复端点 | `as_flows_board.py` | `POST /api/v2/agentflows/runs/{rid}/inputs/{node_run_id}`（operator）：waiting 校验→`rt.script_resume` 透传；节点终态由执行流 stage:end 结算；负向 409/404 |
| 前端确认卡 | `agentflow-detail.tsx` + `as-api.ts` | 运行详情头部对 waiting 节点渲染确认卡：选项按钮/自由意见/跳过；节点 DTO 补 `input` 字段 |
| 测试 | `test_p1_script_agentflow.py` +3（累计 16） | 门控 fake 端到端（needs_input→他线程轮询到 waiting 节点→答复→恢复→脚本继续→终态，captured request_id 一致）；终态自动结算 waiting→cancelled；答复端点负向（终态 run 409/非 waiting 409/未知节点 404） |



## 4. 门禁

```
定向: pytest tests/test_p1_script_agentflow.py tests/test_f0_execution_truthfulness.py → 25 passed
全量: pytest tests/ → 520 passed ×2 遍稳定（504 基线 + 13 P1 + 3 P2）
前端: tsc 0 错 / vitest 全绿 / build ✓
```

**全量轮抓出的竞态（已修）**：先前测试文件模块级启动的常驻 worker 线程会认领新测试入队的
`agentflow-execution` job，与用例显式 `_dispatch_job` 双执行（门控长窗口下必现，
表现为 needs_input 处理两次/节点行重复）。修复=显式驱动用例先 `_dequeue_run_jobs(run_id)`
摘队（F0/P1 文件共 5 处），两遍全量验证稳定。
