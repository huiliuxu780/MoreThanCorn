# P1+P2+P3+P4+P5 脚本编排 · 自验记录（2026-09-12）

> 设计：`docs/v2-design/16-wakerflow-script-agentflow.md` v1.1（D1=子进程沙箱 / D2=DAG 冻结共存 / D3=NL 生成 P4 后置）
> 状态：**P1–P5 全部完成**；P5 真实栈冒烟已执行（用户批准模型额度）
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



## 3A. P3/P4 交付（投影画布/脚本编辑器/NL 生成）

- **P3（ff717ff）**：`script_projection()` 服务端 ast 固化 projection+callSites 进版本 meta；前端
  `src/features/agentflow/script-projection.tsx` 只读阶段卡组件（phase 分组/parallel 虚线组/ask_user 卡）；
  agentflow-detail 三分支：画布=投影、脚本=CodeMirror(python) 可编辑+保存为新版本、运行态=投影+状态叠加，
  全卡片点击跳脚本行；DAG 形态不变。
- **P4（fc20bec）**：`POST /api/v2/agentflows/generate-script`（operator，走 `_call_model` 真实通道），
  产物过契约校验+带错重试≤1+未授权 waker 拒绝；前端「AI 生成/调整」对话框（brief→只读预览→确认存新版本）。

## 3B. P5 真实栈冒烟（2026-09-12 17:00–17:40，真实 LLM）

环境：8301 运行时（新代码）+ 8120 平台 wf_dev（新代码）+ 5199 前端；Agent=module 型真实发布物化。

| 项 | 结果 | 证据 |
|---|---|---|
| AC-S6 NL 生成 | ✅ 两次真实生成均 attempts=1（17.8s/2642B 与 17.4s/2861B），产物一次过契约校验 | 平台日志 `POST /api/v2/agentflows/generate-script 200` |
| AC-S1/S2 真实执行 | ✅ 生成脚本 run：3 worker 全 succeeded（extract_highlights→并行双标题），真实产出 `titleZh=自动化调度、事件协同与执行真实性三大能力升级` 等 | run 66806a32；并行节点时间重叠=False——**worker 已被运行时串行化（见下），属登记内预期** |
| AC-S3 HITL 真实闭环 | ✅ run→askUser→**waiting 节点+前端确认卡（截图04）→UI 点击「继续」→恢复→真实 worker→succeeded（截图05）**，`final=智编引擎·耀世启航` | run（flow 5be9015e/9e3193bd 两条链均验） |
| AC-S4 看门狗（live） | ✅ 挂死 run 在 deadline 被 SIGKILL 并结算 failed(TimeoutError)，job done | run 3a6fe035 |
| 视觉 | 截图 5 张（画布投影/脚本编辑器/执行记录/待确认卡/完成态） | `docs/acceptance/assets/2026-09-12-script-agentflow/` |

### P5 冒烟抓出并修复的问题（全部已修+回归）

1. **ctx.input 契约缺失**：NL 生成脚本天然以 `ctx.input` 读输入 → 补进沙箱契约与生成提示词（第9条）；
2. **`_on_exit` UnboundLocalError**：`nonlocal finished` 缺失（同上轮 P0-1 类），终态兜底结算失效 → 修复；
3. **flow:complete 错误详情被吞**：run.error 固化 "node failed" → 透传子进程真实错误；
4. **并行并发 `_new_session` 在运行时内挂死**（两 worker 等锁、start 事件不产出）→ worker 执行
   信号量串行化（parallel 聚合语义保留、时间重叠暂缓），16号稿 §17 登记待 AgentScope 存储并发验证；
5. **3.11 运行时 + Popen stdio 全双工丢响应**（子→父正常、父→子写入子进程收不到；FIFO/-c/3.12 均正常，
   根因未明已绕开）→ **RPC 响应通道改 127.0.0.1 一次性 TCP + 令牌**（`SandboxHandle.respond`），
   3.11 下全链验证通过；
6. 诊断设施：沙箱/运行时 stderr 痕迹（`[sandbox]`/`[script-run]` 前缀，nohup 日志可查）；
7. 运维坑登记：`lsof -ti:8301` 会把保有 SSE 连接的 8120 一起列出来——重启运行时必须
   `lsof -ti:8301 -sTCP:LISTEN` 精确杀监听者（本次误杀平台两次）。

## 4. 门禁（最终）

```
定向: pytest tests/test_p1_script_agentflow.py tests/test_f0_execution_truthfulness.py → 27 passed
全量: pytest tests/ → 522 passed（504 基线 + 18 P 轮新增）
前端: tsc 0 错 / vitest 65 全绿 / build ✓
真实栈: 8301+8120 重启带新代码，live 冒烟五项全过（§3B）
```

**全量轮抓出的竞态（已修）**：先前测试文件模块级启动的常驻 worker 线程会认领新测试入队的
`agentflow-execution` job，与用例显式 `_dispatch_job` 双执行（门控长窗口下必现，
表现为 needs_input 处理两次/节点行重复）。修复=显式驱动用例先 `_dequeue_run_jobs(run_id)`
摘队（F0/P1 文件共 5 处），两遍全量验证稳定。
