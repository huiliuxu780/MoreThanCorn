# 03 · AgentScope 2.0.8 官方契约审计（RESEARCH_ONLY · 阶段3）

> 日期：2026-09-08
> 执行：阶段3执行代理（RESEARCH_ONLY，未修改任何代码/lockfile/依赖）
> 审计对象：任务书 §6 所列 AgentScope "2.0.8" 的官方契约
> 关键前置事实（先说结论）：**"2.0.8" 不是已发布版本。** PyPI 最新正式版为 `2.0.7.post1`（2026-08-28），GitHub 无 `v2.0.8` tag；`2.0.8` 仅存在于官方仓库 main 分支源码（`_version.py` 声明 `2.0.8`），当前 main HEAD = 审计固定提交 `ff8697ec4d59ee01f3766176e70cb24ee894d6c6`（2026-09-07T13:10:30Z）。本项目运行时 venv 实际安装并 pin 的是 **2.0.7 正式版（PyPI wheel）**。
>
> 证据标注约定：
> - `[L2.0.7]` = 本地已安装包源码，路径前缀 `/Users/rivers/MoreThanCorn/runtimes/agentscope/.venv/lib/python3.11/site-packages/agentscope/`，行号为该安装版实测行号（证据等级 A1，版本=已发布 2.0.7）。
> - `[DEV]` = 官方仓库 `github.com/agentscope-ai/agentscope` @ `ff8697ec4d59ee01f3766176e70cb24ee894d6c6`（= 采集当时的 main HEAD，`_version.py` 声明 2.0.8），路径前缀 `src/agentscope/`（证据等级 A1，版本=2.0.8-dev，**未发布**）。
> - `I1` = 推断；`NETWORK_BLOCKED` / `EVIDENCE_GAP` 见 §5。

---

## 0. 探针与 URL 全清单

所有探针均为只读（find/ls/cat/grep/awk/curl GET/python import 探针/WebFetch）。未安装、未升级、未降级任何依赖；未写任何数据库；未启停服务；未使用浏览器自动化；未派发子代理。除本文件外未创建/修改任何文件（远端源码经 curl 管道内存读取，未落盘）。

### 0.1 本地探针命令

| # | 命令（摘要） | 结果 |
|---|---|---|
| P1 | `find /Users/rivers/MoreThanCorn -name "*.dist-info" -path "*agentscope*"` | 唯一命中 `runtimes/agentscope/.venv/lib/python3.11/site-packages/agentscope-2.0.7.dist-info` |
| P2 | `find /Users/rivers/MoreThanCorn -type d -name "agentscope"` | 唯一命中 `runtimes/agentscope/.venv/.../site-packages/agentscope` |
| P3 | 遍历 `server/.venv`、`packages/runtime_contract/.venv`、`packages/runtime_service/.venv`、`services/tool_service/.venv` 的 site-packages `grep -i agentscope`；`find poc/ -name "*agentscope*"` | 全部为空（poc/ 目录存在但无 agentscope 安装） |
| P4 | `/Users/rivers/MoreThanCorn/runtimes/agentscope/.venv/bin/python -c "import agentscope; print(agentscope.__version__, agentscope.__file__)"` | `2.0.7 /Users/rivers/MoreThanCorn/runtimes/agentscope/.venv/lib/python3.11/site-packages/agentscope/__init__.py`；venv Python 3.11.15 |
| P5 | `cat agentscope-2.0.7.dist-info/{INSTALLER,WHEEL,METADATA}`；`ls` dist-info | `INSTALLER=uv`；**无 `direct_url.json`**（PEP 610：非 git/本地直装，即 registry 安装）；METADATA：`Version: 2.0.7`、`Classifier: Development Status :: 4 - Beta`、`Requires-Python: >=3.11` |
| P6 | `cat runtimes/agentscope/pyproject.toml` | dependencies 含 `"agentscope==2.0.7"` |
| P7 | `grep -A2 'name = "agentscope"' runtimes/agentscope/uv.lock` | `version = "2.0.7"`，`source = { registry = "https://pypi.org/simple" }` |
| P8 | `grep -in agentscope server/requirements.txt` | 无命中（exit 1）——server 不依赖 agentscope |
| P9 | `grep -rn "2\.0\.8" docs/v2-design/*.md` | 旧说法出处：doc11 L7/L195、doc12 L138、AUDIT-HANDOFF L36/L89 等（见 §1.5） |
| P10 | 本地包结构：`ls site-packages/agentscope/` | 顶层模块：agent, app, console, credential, embedding, event, exception, formatter, mcp, message, middleware, model, permission, rag, skill, state, tool, tts, types, workspace。**无 pipeline 模块** |
| P11 | `grep -rn "PipelineProtocol\|GoalPipeline\|class.*Pipeline"` 本地包 | 零命中（2.0.7 无任何 Pipeline 类） |
| P12 | `grep -rn "MsgHub\|fanout\|sequential_pipeline\|barrier"` 本地包 | 零命中（1.x 系编排原语在 2.0.7 中不存在） |
| P13 | 逐项 `awk NR>=a && NR<=b` / `grep -n` 读取本地 event/state/agent/app/tool/mcp/skill/rag/permission/workspace/middleware 源码（详见 §2 各行号引用） | 成功 |

### 0.2 远端 URL 探针（全部为官方域名）

| # | URL | 手段 | 结果 |
|---|---|---|---|
| U1 | `https://pypi.org/pypi/agentscope/json` | WebFetch | 超时 ×3（60s）→ 改用 per-version 端点（U2） |
| U1b | `https://pypi.org/simple/agentscope/` | WebFetch | Connect Timeout ×1 |
| U1c | `https://pypi.org/project/agentscope/` | WebFetch | 超时 ×1 |
| U2 | `https://pypi.org/pypi/agentscope/{2.0.7, 2.0.7.post1, 2.0.8, 2.0.9, 2.1.0}/json` | curl GET（只读） | `2.0.7→HTTP 200`（upload 2026-08-24T12:48:18，`agentscope-2.0.7-py3-none-any.whl`）；`2.0.7.post1→HTTP 200`（upload 2026-08-28T02:42:49）；**`2.0.8→HTTP 404`**；`2.0.9→404`；`2.1.0→404` |
| U3 | `https://api.github.com/repos/agentscope-ai/agentscope/tags?per_page=20` | WebFetch | 首次 ECONNRESET，重试成功。20 个 tag 中**无 v2.0.8**；最新：`v2.0.7.post1`、`v2.0.7`、`v2.0.6`…（至 `v1.0.14`） |
| U4 | `https://api.github.com/repos/agentscope-ai/agentscope/releases/latest` | curl GET | `tag_name: v2.0.7.post1`，`published_at: 2026-08-28T02:42:12Z` |
| U5 | `https://api.github.com/repos/agentscope-ai/agentscope/commits/ff8697ec4d59ee01f3766176e70cb24ee894d6c6` | WebFetch | SHA 确认；committer date `2026-09-07T13:10:30Z`；message 首行 `fix(app): support cross-owner agent invites (#2326)` |
| U6 | `https://api.github.com/repos/agentscope-ai/agentscope/commits/main` | curl GET | main HEAD `sha = ff8697ec…`（即固定提交 == 采集时 main tip，日期同上） |
| U7 | `https://api.github.com/repos/agentscope-ai/agentscope/compare/v2.0.7...ff8697ec…` | curl GET | `status: ahead`，`ahead_by: 46`，`behind_by: 0`，174 个文件变更（完整清单已读，关键项引用于 §1.4/§2） |
| U8 | `https://api.github.com/repos/agentscope-ai/agentscope/compare/ff8697ec…...main` | curl GET | `status: identical`，`ahead_by: 0`（固定提交后 main 无新提交） |
| U9 | `https://api.github.com/repos/agentscope-ai/agentscope/contents/src/agentscope/pipeline?ref=ff8697ec…` | WebFetch | 目录仅 3 文件：`__init__.py`(188B)、`_base.py`(884B)、`_goal_pipeline.py`(12469B) |
| U10 | `https://api.github.com/repos/agentscope-ai/agentscope/contents/examples?ref=ff8697ec…` | curl GET | 示例目录：`a2a, agent_service, console, long_term_memory, pipeline, rag, web_ui, workspace` |
| U11 | `https://raw.githubusercontent.com/agentscope-ai/agentscope/ff8697ec…/src/agentscope/pipeline/_base.py` | WebFetch 超时×1 → curl GET 成功 | 全文 32 行取得（§2 项1；2026-09-08 复核修正，原误记 33） |
| U12 | 同上 `…/pipeline/_goal_pipeline.py` | curl GET（`cat -n` 内存管道） | 全文 325 行取得（§2 项2） |
| U13 | 同上 `…/pipeline/__init__.py` | curl GET | 全文 10 行取得 |
| U14 | `https://raw.githubusercontent.com/agentscope-ai/agentscope/main/src/agentscope/_version.py` | WebFetch 超时×1 → curl GET 成功 | `__version__ = "2.0.8"` |
| U15 | 同上 @ff8697ec：`examples/pipeline/goal/README.md`（46行）、`examples/pipeline/goal/goal_pipeline.py`（77行） | curl GET | 全文取得（§2 项11） |
| U16 | 同上 @ff8697ec：`tests/pipeline_goal_test.py` | curl GET + grep -n | 测试名与关键行取得（§2 项2） |
| U17 | 同上 @ff8697ec：`src/agentscope/{agent/_agent.py, agent/__init__.py, agent/_a2a_agent.py, event/_event.py, state/_state.py, app/_app.py, app/_service/_chat.py, app/_service/_session.py, app/_service/_toolkit.py, app/storage/_model/_session.py, console/_console.py}` | curl GET + grep -n（只取行号锚点）；`_chat.py/_app.py/deps.py/_lifespan.py` 另做 `grep -in pipeline` | 行号锚点取得；4 个 app 层文件 **pipeline 引用为零**（§2 项10） |
| U18 | `https://docs.agentscope.io/latest/en/building-blocks/pipeline/overview` | WebFetch ×2（ECONNRESET）+ curl ×1（HTTP 000） | **NETWORK_BLOCKED**（该 URL 的存在性由 [DEV] `docs/NEWS.md` diff 中的官方链接证实，内容未能核验） |

> 手段说明：raw.githubusercontent.com 与 pypi.org 大 JSON 在 WebFetch 通道下多次超时/断连；按任务书允许口径改用只读 `curl GET`（同为访问官方仓库/PyPI，无副作用），全部记入上表。github.com API 首次失败均按规程重试一次并如实记录。

---

## 1. 版本事实（任务书 §6 开头五项，逐项回答）

### 1.1 本项目实际安装的 agentscope 在哪几个位置、各自精确版本号

**唯一安装位置**：`/Users/rivers/MoreThanCorn/runtimes/agentscope/.venv/lib/python3.11/site-packages/agentscope/`，版本 **2.0.7 正式版**。（A1）

- dist-info：`agentscope-2.0.7.dist-info`（P1）；包内 `_version.py` L4：`__version__ = "2.0.7"`；运行时探针 `agentscope.__version__ == "2.0.7"`（P4）。
- 其余候选位置均无安装（P3）：`server/.venv`、`packages/runtime_contract/.venv`、`packages/runtime_service/.venv`、`services/tool_service/.venv` 的 site-packages 无 agentscope；`poc/` 目录存在但其下无 agentscope 安装、无独立 venv 命中。
- 结论：**本项目不存在任何 2.0.8 / 2.0.8-dev 的本地安装**。任务书所称"当前明确采用的 2.0.8 版本"在设计文档语境中指 *计划基线*（2.0.8-dev@ff8697ec 沙箱 spike 口径，见 doc11 L7、AUDIT-HANDOFF L36），而非运行时现状。

### 1.2 安装来源（PyPI 包还是 git 安装；若 git 记录 commit/tag）

**PyPI registry 安装，非 git 安装**。（A1）

- dist-info 中**不存在 `direct_url.json`**（P5）。按 PEP 610，git/本地路径直装必留该文件；其缺失 + `INSTALLER=uv` + `WHEEL`（`Generator: setuptools (84.0.0)`，`Tag: py3-none-any`）指向 registry wheel 安装。
- `runtimes/agentscope/uv.lock` L11-13：`name = "agentscope"`，`version = "2.0.7"`，`source = { registry = "https://pypi.org/simple" }`（P7）。
- 对应 PyPI 发布物：`agentscope-2.0.7-py3-none-any.whl`，upload_time `2026-08-24T12:48:18`（U2）。
- 无任何本地 commit/tag 可记录（不是 git 安装）。

### 1.3 PyPI 现状：2.0.8 正式版是否存在、最新版本号、发布时间

**2.0.8 正式版不存在；PyPI 最新为 2.0.7.post1（2026-08-28）**。（A1）

- `https://pypi.org/pypi/agentscope/2.0.8/json` → **HTTP 404**（WebFetch 与 curl 双通道确认）；`2.0.9`、`2.1.0` 亦 404（U2）。
- `2.0.7.post1/json` → HTTP 200，upload_time `2026-08-28T02:42:49`；`2.0.7/json` → HTTP 200，upload_time `2026-08-24T12:48:18`（U2）。
- 交叉印证：GitHub `releases/latest` = `v2.0.7.post1`（published `2026-08-28T02:42:12Z`，U4）；tags 列表无 v2.0.8（U3）。
- 局限说明：全量 `pypi.org/pypi/agentscope/json`（含 `info.version` 字段）3 次超时未能读取（U1），"最新版本"结论由 per-version 404/200 探测 + GitHub release/tag 双源交叉得出。

### 1.4 官方仓库 tag / changelog

（A1；github.com API 首次调用 ECONNRESET，重试成功后取得，未编造）

- **Tag**：无 `v2.0.8`。2.0.x 系 tag：`v2.0.0 … v2.0.7, v2.0.7.post1`（U3）。
- **main HEAD** = `ff8697ec4d59ee01f3766176e70cb24ee894d6c6`（2026-09-07T13:10:30Z，"fix(app): support cross-owner agent invites (#2326)"）（U5/U6）。`compare ff8697ec...main = identical`（U8）——**本文所有 [DEV] 证据同时是采集当时的 main tip，不存在"固定提交落后 main"的漂移**；但这也意味着 2.0.8-dev 内容随 main 持续变动，正式 tag 出现前不冻结。
- **main 版本声明**：`src/agentscope/_version.py`@main → `__version__ = "2.0.8"`（U14）。即"2.0.8"目前是 main 分支的 dev 版本号。
- **changelog（docs/NEWS.md@ff8697ec diff，U7）**新增三条：
  - `[2026-09] FEAT: A2A protocol supported — chat with any remote A2A agent via A2AAgent`（examples/a2a、docs 链接）；
  - `[2026-08] FEAT: Pipeline supported — run multiple agents by a fixed logic behind one event stream`（examples/pipeline、docs 链接）；
  - `[2026-08] INTE: DingTalk channel supported`。
- **v2.0.7 → ff8697ec 差异规模**：ahead 46 commits / 174 文件（U7）。与本审计直接相关：新增 `src/agentscope/pipeline/`（`__init__.py` +10、`_base.py` +32、`_goal_pipeline.py` +325）、`src/agentscope/agent/_a2a_agent.py` +657、`state/_a2a_state.py` +23、`examples/pipeline/goal/`、`examples/a2a/`、`tests/pipeline_goal_test.py` +275；修改 `app/_service/_chat.py` +160-11（主因：session 自动命名）、`app/_app.py` +9（新增 `enable_scheduler` 参数）、`agent/_agent.py` +321-33、`state/_state.py` +53-27、`event/_event.py` +15-2、`storage/_model/_session.py` +239-21、`console/_console.py` +5-4（接受 PipelineProtocol）、`_manager/_scheduler/_scheduler_manager.py` +229-72、`mcp/_mcp_client.py` +141-28、`middleware/_rag.py` +263-13 等。

### 1.5 本项目 lockfile / requirements 当前 pin；旧说法是否过期

- `runtimes/agentscope/pyproject.toml`：`dependencies = ["agentscope==2.0.7", …]`（P6）；`runtimes/agentscope/uv.lock`：2.0.7 @ pypi registry（P7）。**精确等号 pin，装的就是 2.0.7，不是 2.0.7.post1，更不是 2.0.8-dev。**
- `server/requirements.txt`：无 agentscope 条目（P8）——平台 server 进程不直接依赖 agentscope，依赖只存在于 `runtimes/agentscope` 运行时子项目。
- 旧说法核对（P9）：
  - AUDIT-HANDOFF L36"PyPI 仍为 2.0.7.post1；2.0.8 只存在于官方 Git main 源码，审计固定提交 ff8697ec…" → **截至今日仍然准确，未过期**（U2/U3/U6 全部吻合；且 main HEAD 恰好仍是 ff8697ec）。
  - doc11 L7"2.0.8-dev@ff8697ec…；PyPI 尚无 2.0.8 发布物"、L89/L126"2.0.8 尚未在 PyPI 发布/正式版前只允许沙箱 spike" → **未过期，仍然成立**。
  - doc12 L138"官方 2.0.8-dev GoalPipeline 只有一个 executor 与一个 verifier；验证失败时把反馈交回整个 executor" → 与 [DEV] `_goal_pipeline.py` 全文核对**一致**（L59-66 构造签名仅 executor+verifier；fail 反馈以 UserMsg 交回 executor，L311-321）。
  - 需要修正的一个易混点（I1）：任务书/文档口径"当前明确采用 2.0.8"若被读作"运行时已装 2.0.8"，则与事实不符——运行时是 2.0.7 正式版；2.0.8 只是 spike/设计基线。任何"2.0.8 能力"（Pipeline、A2A）在当前生产 venv 中**不存在**（P10/P11）。

---

## 2. 12 项契约复核

> 每项格式：结论 → 证据（文件+行号）→ 证据等级 → 不能确认的部分。
> 通则（适用于全部 12 项）：凡引用 [DEV] 的能力均**仅存在于未发布的 2.0.8-dev@ff8697ec**；凡引用 [L2.0.7] 的能力存在于已发布 2.0.7（本项目实装版本）。两者差异以 U7 compare 清单为准。

### 项1 · PipelineProtocol 的输入、输出和事件 union

**结论**：`PipelineProtocol` 是 2.0.8-dev 新增的极小结构化协议（typing.Protocol），仅一个方法 `reply_stream`；输入是"消息或 HITL 续接事件"的 union，输出是 `AsyncGenerator[AgentEvent | Msg, None]`。它不是类继承接口、无运行时校验、无任何注册/发现机制。2.0.7 中完全不存在。（A1）

**证据**：
- [DEV] `pipeline/_base.py` L4-12（导入事件 union 成员）、L15 `class PipelineProtocol(Protocol)`、L16-22 docstring（"What a pipeline has to offer to go where an agent goes"；说明为何声明为 plain `def` 返回 async generator 而非 `async def`）、L24-31 `def reply_stream(self, inputs: Msg | list[Msg] | UserConfirmResultEvent | UserInterruptEvent | ExternalExecutionResultEvent) -> AsyncGenerator[AgentEvent | Msg, None]`、L32-33 docstring。全文 33 行（U11；文件 884B，U9）。
- [DEV] `pipeline/__init__.py` L4-10：模块仅导出 `PipelineProtocol`、`GoalPipeline`（U13）。
- 事件 union `AgentEvent`：[DEV] `event/_event.py` L565-594（TypeAlias，28 个成员）；[L2.0.7] `event/_event.py` L552-581 同构（2.0.8-dev 仅对 DataBlock 两事件做了字段级修改：`DataBlockStartEvent` 增加 `name: str | None`，`DataBlockDeltaEvent` 的 `data` 改可选并新增 `url`，见 U7 patch，`+15-2`）。
- 2.0.7 无 pipeline：P10（无目录）、P11（零命中）、U7（pipeline 三文件均为 `added`）。
- 与 `Agent.reply_stream` 的签名对齐：[L2.0.7] `agent/_agent.py` L256-266、[DEV] `agent/_agent.py` L288（同一输入 union + `structured_schema` + `yield_final_msg`），即 Protocol 描述的是"Agent 已有的形状"。

**不能确认**：官方是否计划为 Protocol 提供运行时一致性检查/注册表（无任何源码证据）；`docs.agentscope.io` pipeline 页面对 Protocol 的官方叙述（U18 NETWORK_BLOCKED，仅 NEWS.md 一句话"run multiple agents by a fixed logic behind one event stream"可证）。

### 项2 · GoalPipeline 的 executor / verifier / iteration / state

**结论**：`GoalPipeline` 是 2.0.8-dev 中**唯一**的具体 pipeline 实现：固定"1 executor + 1 verifier"的目标达成循环。执行器产出结构化 `_ExecutionReport`，验证器产出 `_VerificationResult(pass|fail|impossible)`；fail 时把 message 作为 system-reminder 反馈给 executor 再迭代；pass/impossible 终止；迭代预算 `_iters`/目标 `_goal` 是**纯内存实例字段**。构造参数 `max_retries` 与 `verifier_reset_context` 在全文件 325 行中**赋值后从未被读取**（dead params）。（A1；"dead params 的影响"为 I1）

**证据**（[DEV] `pipeline/_goal_pipeline.py`，全文 325 行经 U12 取得，行数与 U7 compare `+325-0` 吻合）：
- 结构化模型：L22-31 `_ExecutionReport(report: str)`；L34-52 `_VerificationResult(result: Literal["pass","fail","impossible"], message: str)`。
- 构造：L55-57 类 docstring（"run an executor and verifier in a loop until the goal is achieved"）；L59-66 `__init__(executor: Agent, verifier: Agent, verifier_reset_context: bool=True, max_iters: int=10, max_retries: int=3)`。
- 状态：L88-90 注释+字段 `self._iters = 0`（"On the instance rather than in `reply_stream`, so a HITL resume does not restart the budget"）、L91 `self._goal: None | list[TextBlock | DataBlock]`。**无 state_dict/serialize/save/load，无 storage/session 集成**。
- dead params：`max_retries` 仅出现在 L65/79/87，`verifier_reset_context` 仅出现在 L63/74/85（U17 专项 grep 全文核实）；L177 `while execution_report is None:` 与 L248 `while final_msg is None:` + L274-275 `continue` 构成的"重提示直到产出合法结构化输出"循环**无次数上限**。
- 输入处理：L116-144 新 `Msg/list[Msg]` → deepcopy 给 executor、注入提示（L127-133）、**重置 `_iters=0`（L124-125）**、`_goal` 取自输入 content（L136/L139-141）；L146-161 HITL 续接事件按 `inputs.reply_id` 与 `self.executor.state.reply_id` / `self.verifier.state.reply_id` 匹配路由，未知 reply_id → `ValueError`（L158-161）；L163-169 `UserInterruptEvent` 直接转发给 parked 的那个 agent 后 `return`。
- 循环：L172 `while True`；executor 步 L176-217（`structured_schema=_ExecutionReport`、`yield_final_msg=True`，L181-182；透传全部事件 L184；`RequireExternalExecutionEvent/RequireUserConfirmEvent` → `break_loop=True` L185-192；`Msg.finished_reason==COMPLETED and structured_output` → 提取 report L193-201；无效 report → 重提示 L207-217，提示文案点名 `'GenerateStructuredOutput'` 工具）；park 即 break（L219-221 "The executor parked, so there is nothing to verify yet"）；verifier 步 L224-292（instruction 内嵌 `<goal>`+`<report>` L225-246，`structured_schema=_VerificationResult` L251；无效结果重提示 L274-292，含 `TODO: support multimodal verification instruction` L278）；终局判定 L293-303（pass/impossible → `break_loop=True`，impossible 记 logger.info）；fail 分支 L304-321（`self._iters += 1` L305；`>= max_iters` → break L306-309；否则把 `message` 作为反馈 UserMsg 交回 executor L311-321）。
- 官方测试（[DEV] `tests/pipeline_goal_test.py`，275 行，U16）：`StubAgent`（L59，state 为 `SimpleNamespace(reply_id=f"{name}-reply")` L70）+ 10 个测试：`test_passes_on_first_round`(L101)、`test_refusal_reaches_the_executor`(L118)、`test_stops_at_max_iters`(L135)、`test_impossible_ends_the_run`(L146)、`test_reprompts_a_verifier_that_skips_the_tool`(L160)、`test_reprompts_an_executor_that_skips_the_tool`(L180)、`test_a_parked_executor_is_not_verified`(L199)、`test_resumes_into_the_agent_that_parked`(L212)、`test_resume_keeps_the_iteration_budget`(L232)、`test_rejects_an_unknown_reply_id`(L261)。
- 官方示例（[DEV] `examples/pipeline/goal/goal_pipeline.py` L64-70）：goal 随首次输入到达而非构造期绑定（L64-66 注释）。

**不能确认**：`max_retries`/`verifier_reset_context` 是遗留占位还是待接线 bug（官方意图无源码/issue 证据，本审计未查 issue 区）；verifier 无限重提示循环在实际模型下的终止性（仅有行为无保证）。

### 项3 · 多 stage / 多 role / 并行 / barrier / 选择性重做的原生支持度

**结论**：**编排意义上全部不原生支持。** pipeline 模块只有"单 executor+单 verifier 固定循环"一种形态；无 stage/DAG 抽象、无并行分支、无 barrier/join、无 attempt 记录、无"选择性重做某阶段"的任何 API。多 role 协作在 2.0.7 服务层以 **team 机制**存在，但语义是"跨 session 异步消息协作"，不是 pipeline 内同步编排节点。唯一的并行是 agent 内部的并发工具调用。（A1）

**证据**：
- pipeline 模块全部内容 = 3 文件（U9/U13），`__init__.py` 仅导出 2 个名字；`_goal_pipeline.py` 全文 325 行中无 stage/parallel/barrier/retry-node 概念（U12 全文核对）。
- 1.x 编排原语不存在：P12（`MsgHub/fanout/sequential_pipeline/barrier` 本地零命中）；P11（无任何 `*Pipeline` 类）。
- 选择性重做：GoalPipeline 失败路径只有"反馈→整体重迭代"（L311-321）与新输入重置预算（L124-125）；无按阶段/节点重跑接口；官方测试清单（U16）亦无相关用例。
- 多 role（team 机制，[L2.0.7]）：`app/_tool/_agent_create.py`（`AgentCreate` 工具，默认 worker 模板 L30-40、参数 L108+）、`_agent_invite.py`、`_team_say.py`（`TeamSay` L78、name L91）、`_team_create.py`/`_team_delete.py`；`app/_types.py` L89-129 `SubAgentTemplate`（type/description/system_prompt_template，"All fields are pure data (no callables), so the template is fully serializable" L103-104）；`app/storage/_model/_agent.py` L112-127 `AgentRecord.source: "user"|"team"`（team worker "Has exactly one session"）；`SessionRecord.team_id` L210。leader/worker 通过 message bus inbox + wakeup 异步通信：`app/_service/_toolkit.py` L70-71（"a worker gets only TeamSay; anyone else gets the full leader-side toolset"）、L94-97（team tools 经 bus "push HintBlocks + wakeups"）；`SchedulerManager` docstring L27-38（同一 wakeup 路径）。
- 并行：仅 agent 内工具级并发 [L2.0.7] `agent/_agent.py` L1903 `_batch_tool_calls`、L1943 `_execute_sequential_tool_calls`、L1993 `_execute_concurrent_tool_calls`。GoalPipeline 严格串行（executor→verifier→executor…）。
- 官方对 pipeline 的一句话定位（[DEV] `docs/NEWS.md` diff，U7）："run multiple agents by a **fixed logic** behind one event stream"——固定逻辑，非可编排 DAG。

**不能确认**：官方是否有 pipeline 编排路线图（无 milestone/roadmap 证据被采集）；team 机制在真实负载下的并发上限与公平调度（未见源码级保证）。

### 项4 · pipeline state 是否可跨进程持久化 / 恢复

**结论**：**不能。** GoalPipeline 的全部自有状态（`_iters`、`_goal`、循环所处阶段、executor/verifier 对象引用）都是进程内存字段，官方未提供任何序列化、storage 接入或恢复机制；app 服务层（storage/ChatService）也完全不托管 pipeline（见项10）。跨进程可持久化/恢复的只有 **Agent 级 `AgentState`**（经由 app 服务层的 SessionRecord.state，见项5）——因此 GoalPipeline 的 HITL park→resume 仅在**同一进程、同一实例存活期**内成立；进程重启后即使把两个 Agent 的 AgentState 从 storage 恢复，pipeline 的迭代预算、goal 和循环相位也已丢失。（A1 事实；"重启后丢失什么"的具体后果为 I1，由 L88-91 内存字段 + 无序列化 API 直接推出）

**证据**：
- [DEV] `_goal_pipeline.py` L83-91：状态仅 `self.executor/self.verifier/self.verifier_reset_context/self.max_iters/self.max_retries/self._iters/self._goal`；全文件无 `state_dict/load_state_dict/serialize/model_dump/storage` 字样（U12 全文核对）。
- 官方示例 README（[DEV] `examples/pipeline/goal/README.md` L33-46 "Resuming"）：恢复方式是**再次调用同实例的 `reply_stream`** 并喂入结果事件（"`reply_stream` ends when a tool call needs human confirmation — nothing is left suspended waiting… Feed the answer back in to carry on"；"The iteration budget survives the round trip"）——描述的是进程内 round trip，未提任何跨进程场景。
- 路由依赖内存中 Agent 的 `state.reply_id`（L154-157）：`AgentState.reply_id` 本身可持久化（项5），但 pipeline 与两个 Agent 实例的绑定关系不可持久化。
- 对照：Agent 会话状态的跨进程持久化是官方提供的（[L2.0.7] `app/storage/_model/_session.py` L221 `SessionRecord.state: AgentState`；`app/storage/_base.py` L371-387 upsert_session(state)、L433-449 `update_session_state`；SQL 后端 docstring `app/storage/_sql/_storage.py` L3-17：SQLAlchemy 2.0 async，SQLite/Postgres/MySQL，naive UTC 跨节点可比）。
- GoalPipeline 测试全部基于内存 StubAgent（U16），无持久化/恢复用例。

**不能确认**：官方是否计划把 pipeline 纳入 app 服务层持久化（无证据）；用 AgentState 恢复 + 重建 GoalPipeline 实例的"民间恢复方案"能否复现 `_iters` 语义（官方未提供、未测试——平台若自建需自担验证成本，I1）。

### 项5 · AgentState、session 和 Chat service 的边界

**结论**：边界清晰且已在 **2.0.7 正式版**提供：`AgentState` 是纯 pydantic 状态容器（会话上下文+reply 上下文+权限/工具/任务/中间件上下文）；`Session` 是持久化、加锁、事件扇出的单位，`AgentState` 作为 `SessionRecord.state` 字段随 session 存储；`ChatService` 是"每回合临时装配 Agent 实例 → 驱动 reply_stream → 事件写 bus → 持久化回复与状态"的编排者，被 HTTP chat 端点与 wakeup dispatcher 共用。Agent 实例本身是短命的（每 chat turn / 每次调度触发重新装配）。（A1）

**证据**（[L2.0.7]，2.0.8-dev 中同构存在且行号已锚定）：
- `AgentState`：`state/_state.py` L178-265——`session_id`(L181)、`summary`(L185)、`context: list[Msg]`(L189)、`reply_context: ReplyContext`(L237；ReplyContext L151-175：`reply_id`、`cur_iter`、`structured_schema`（序列化为 JSON schema，L162-172）、`structured_output`)、`permission_context`(L243)、`tool_context`(L252；ToolContext L32：读文件缓存等)、`tasks_context`(L257；TaskContext L144-148)、`middle_context: dict`(L263-265，供 middleware 跨 reply 存数据)。docstring L179："The agent state that should be saved and loaded from storage"。[DEV] 对应：AgentState L204、ReplyContext L177、TaskContext L170、ToolContext L32、迁移 validator L223（U17）。
- Session：`app/storage/_model/_session.py`——`SessionSource(USER|SCHEDULE|CHANNEL)` L12-17；`SessionConfig` L114-176（`workspace_id` L117、`cwd` L134、`chat_model_config` L163、`fallback_chat_model_config` L166、`tts_model_config` L170、`knowledge_config: SessionKnowledgeConfig` L173，后者 L87-108 含 `knowledge_base_ids`+RAGMiddleware parameters）；`SessionRecord` L179-221（`user_id` L182、`agent_id` L185、`source` L188、`source_schedule_id` L191、`source_chat_id` L194、`source_channel_id` L205、`team_id` L210、`config` L218、`state: AgentState` L221）。[DEV] 增补：`SessionNaming` L181、SessionRecord L272、state L405（U17；+239-21 主要为自动命名与 channel origin，U7）。
- Agent 定义记录：`app/storage/_model/_agent.py` L65-105 `AgentData`（id/name/system_prompt/context_config/react_config/invite_config…，pydantic + `SkipJsonSchema` 供前端 schema 表单）；L112-129 `AgentRecord(user_id, source: "user"|"team", data: AgentData)`。
- ChatService：`app/_service/_chat.py` L98-111 docstring（"Run an agent against a session, persisting input/reply messages and updated agent state. Shared by the HTTP chat endpoint and the wakeup dispatcher… `bus.session_run` acquires a distributed lock (guaranteeing at most one chat run per session across all processes)… `session_publish_event` writes each event to both a replay log and a live Pub/Sub channel"）；`__init__` L113-128（storage/workspace_manager/scheduler_manager/background_task_manager/message_bus/resource_access_service/knowledge_base_manager/extra_agent_middlewares/extra_agent_tools/custom_subagent_templates/custom_agent_cls/extra_projectors/channel_clients）；`run()` L227-238；`_run_impl` L634、持久化点 `_persist` L1257、事件投影 `_project_event` L1308。"每回合装配"证据：`create_app` docstring `extra_agent_middlewares`（`app/_app.py` L209-224："Called once per agent assembly (i.e. per chat turn / scheduled trigger)"）。[DEV] 对应：ChatService L131、run L260、interrupt L646、新增 `_auto_name_session` L323（U17）。
- SessionService：`app/_service/_session.py` L98；`SessionStatus(RUNNING|IDLE|AWAITING_PERMISSION|AWAITING_EXTERNAL_RESULT)` L61-95（含优先级语义 docstring L70-76）；`derive_parked_status` L212-250（从**持久化的** `AgentState.context` 尾部 tool_call 状态推导 parked 状态；`ToolCallState.ASKING→AWAITING_PERMISSION`，`SUBMITTED→AWAITING_EXTERNAL_RESULT`；ToolCallState 枚举 `message/_block.py` L128-135：PENDING/ASKING/ALLOWED/SUBMITTED/FINISHED）。[DEV] 行号相同（U17）。

**不能确认**：多副本部署下 replay log 的保留期/容量策略（未读 message_bus 存储细节）；SessionRecord.state 的写入频率在长 reply 中途是否有中间快照（`_persist` 位于 reply 结束路径，中途崩溃恢复粒度未逐行核验——记 EVIDENCE_GAP）。

### 项6 · Planning Agent 如何创建/更新内部计划项

**结论**：2.0.x **没有独立的 "Planning Agent" 类**。计划能力 = `Task` 模型 + 四个内置工具（`TaskCreate/TaskGet/TaskList/TaskUpdate`）+ `AgentState.tasks_context`。任何普通 Agent 被装配这些工具后即可在 reply 过程中自建/更新计划项；计划项存放在该 agent 的 AgentState 内，随 session 持久化。`Task.blocks/blocked_by` 提供依赖图字段，但**全库无任何执行器消费它们**——依赖语义只是给 LLM 看的信息，不是调度契约。这些是 Agent 内部计划项，不是平台任务：无触发器、无调度、无跨 session 可见性、无独立 Run/生命周期。（A1；"不是平台任务"的定性为 I1，基于以下字段级证据）

**证据**（[L2.0.7]）：
- `Task` 模型：`state/_task.py` L11-39——`subject/description/metadata/created_at/state: Literal["pending","in_progress","completed"]/id/owner/blocks/blocked_by`。注意 state 枚举**无 failed/cancelled**。
- 工具实现：`tool/_task/_create_task.py`——`TaskCreate` L25-28（name="TaskCreate"）、描述 L77-79（"After creating tasks, use TaskUpdate to set up dependencies… Check TaskList first to avoid creating duplicate tasks"）、`call(_agent_state: AgentState, subject, description, metadata)` L83-130：直接 `_agent_state.tasks_context.tasks.append(task)`（L116），顺序数字 id（L99-108）；缺 AgentState 时抛 `DeveloperOrientedException`（L91-96）。`_update_task.py`：`owner` L43、`add_blocked_by` L39、用法示例 L123-130（claim by owner / mark blocked_by）、`call(_agent_state, …)` L137-149。`_list_task.py` L16-19、`_get_task.py`（TaskGet）。导出：`tool/__init__.py` L24-27、L58-61。
- 注册路径：`app/_service/_toolkit.py` 模块 docstring L4-7（"planning tools (Task*)"）+ `get_toolkit` docstring L61-62（来源顺序第 2 位："Planning tools (TaskCreate/TaskList/TaskGet/TaskUpdate)"）——即 app 服务层为每个 chat turn 统一装配。
- 依赖字段无消费者：P（blocked_by grep）——Task 工具族与定义点之外无调度/执行消费者（`_get_task.py:85-87`/`_list_task.py:62-63` 的展示型读取属 LLM 信息面，不构成调度契约；2026-09-08 复核修正 F-6）。
- 与 Agent 生命周期的关系：tasks_context 是 AgentState 字段（`state/_state.py` L257），AgentState 随 SessionRecord 持久化（项5）→ 计划项跨回合存活、随 session 存亡；没有独立于 session 的计划项存储。
- [DEV] 无变化：U7 中 `tool/_task/*`、`state/_task.py` 均未出现在 174 个变更文件中（`state/__init__.py` 仅 +A2AAgentState 导出）。

**不能确认**：官方对 owner 字段在多 agent team 场景下的协作语义（TeamSay 与 Task owner 是否联动，未见源码级约定）；计划项是否有官方 UI 投影（examples/web_ui 未逐文件核验——EVIDENCE_GAP）。

### 项7 · tool / MCP / skill / knowledge 的装配方式

**结论**：2.0.7 已提供完整装配链，两条路径：(a) **库级**——`Agent(toolkit=Toolkit(tools=…, skills_or_loaders=…, mcps=…, tool_groups=…))`，Toolkit 是工具/MCP/skill 的唯一入口；(b) **服务级**——`create_app` 注入 hubs/managers，`get_toolkit()` 每回合按固定顺序装配：workspace 内置工具（Bash/Read/Write/Grep…）→ Task* → ToolStop → Schedule* → team tools → 调用方 extras → channel tools，另加 workspace 发现的 skills 与 MCPs。knowledge 以 `KnowledgeBase` + `RAGMiddleware`（middleware 注入检索工具）方式挂到 agent，session 级配置 `SessionKnowledgeConfig`。（A1）

**证据**（[L2.0.7]）：
- Agent 构造：`agent/_agent.py` L115-129（`name, system_prompt, model: ChatModelBase, toolkit: Toolkit|None, middlewares, state: AgentState|None, offloader, model_config, context_config, react_config, injection_config`）；toolkit docstring L140-142："The toolkit used for registering tools, MCPs and skills as **the sole source**"；middlewares docstring L143-147（hook 点：reply、reasoning、permission checking、acting、model call、context compression、system prompt retrieval）。
- Toolkit：`tool/_toolkit.py` L66 `class Toolkit`、`__init__` L88-115（`tools`→"basic"组、`skills_or_loaders: Sequence[str|Skill|SkillLoaderBase]`、`mcps: list[MCPClient]`、`tool_groups`、模板参数）、`call_tool` L225。
- MCP：`mcp/_mcp_client.py` L25-59 `MCPClient(BaseModel)`——统一 stateful（显式 connect/close，STDIO 或 HTTP）/stateless（HTTP 每次调用临时 session）两种模式，`list_tools` 缓存；配置 `mcp/_config.py` `StdioMCPConfig` L9、`HttpMCPConfig` L44。[DEV] `mcp/_mcp_client.py` +141-28（含 runtime headers 支持，tests/mcp_runtime_headers_test.py +521，U7）。
- Skill：`skill/_base.py` `Skill` L8、`SkillLoaderBase` L23；`skill/_local_loader.py` `LocalSkillLoader` L16（目录型 skill）。
- Knowledge：`rag/_knowledge.py` `KnowledgeBase` L44；消费面 `middleware/_rag.py` `RAGMiddleware` L456 + `_SearchKnowledgeTool` L105 + `_SearchParams` L79；session 配置 `app/storage/_model/_session.py` `SessionKnowledgeConfig` L87-108；服务侧 `app/_service/_knowledge_base.py`（docstring L5-11：持久化/blob store/indexing pipeline 协调）、index worker/sweeper/consumer（`_index_worker.py` L219 等）；`create_app` 参数 `knowledge_base_manager/knowledge_parsers/knowledge_chunkers/blob_store/enable_index_worker`（`app/_app.py` L82-86、docstring L145-188："The chunker type and parameters are **pinned on the knowledge base record** and reconstructed by the index worker"）。[DEV] `middleware/_rag.py` +263-13（U7）。
- Workspace：`workspace/_base.py` `WorkspaceBase` L223、`list_tools` L554；`workspace/_local_workspace.py` `LocalWorkspace` L65、`list_tools` L141（内置 Bash/Read/Write/Grep 等由 workspace 提供——`get_toolkit` docstring L60 "Workspace builtins (Bash / Read / Write / Grep / …)"）。
- Hub 机制（市场/目录型供给）：`app/hub/_base.py` `HubBase` L10；`app/hub/_mcp/_base.py` `MCPHubBase` L9、`_card.py` `MCPCard` L10、`_github_hub.py` `GitHubMCPHub` L101；`app/hub/_skill/_base.py` `SkillHubBase` L26、`SkillArchive` L10、`_card.py` `SkillCard` L8、`_claw_hub.py` `ClawSkillHub` L75；经 `create_app(mcp_hubs=…, skill_hubs=…)` 注入（`app/_app.py` L87-88，docstring L189-192）。
- 服务级装配总入口：`app/_service/_toolkit.py` `get_toolkit` L38-77（7 类来源+顺序，见结论）；每回合调用（`create_app` docstring L209-224、ChatService init docstring L134-136 "Provides per-session workspace (tools, MCPs, skills) used during agent assembly"）。
- 权限面：`permission/_types.py` `PermissionMode(DEFAULT|ACCEPT_EDITS|EXPLORE|BYPASS|DONT_ASK)` L18/L81-85、`PermissionBehavior(ALLOW|DENY|ASK|PASSTHROUGH)` L88/L99-102；AgentState.permission_context（项5）；`agent/_agent.py` `_check_permission` L2147。

**不能确认**：MCPHub/SkillHub 的资源是否做版本 pin（MCPCard/SkillCard 字段未逐一读取——EVIDENCE_GAP）；skill 目录格式规范全文（`skill/_base.py` 未整读）。

### 项8 · pause / resume / interrupt / external result / cancel

**结论**：官方提供一套完整的 HITL 契约，分两层。**Agent/库层**（2.0.7 已有）：reply_stream 以事件"停车"（`RequireUserConfirmEvent`/`RequireExternalExecutionEvent` 后 generator 结束），以事件"续接"（`UserConfirmResultEvent`/`ExternalExecutionResultEvent`/`UserInterruptEvent` 按 `reply_id` 喂回）；没有独立 pause 原语，park 即 pause。**服务层**（2.0.7 已有）：ChatService.run 的 Case A/B 续接语义、interrupt 双路径（运行中→bus 广播→CancelDispatcher 取消 asyncio task→agent CancelledError 清理；parked→enqueue resume trigger 注入 UserInterruptEvent，幂等）、cancel_session_run（广播取消 chat run + 后台任务，轮询分布式锁，超时返回 False）。**Pipeline 层**（2.0.8-dev）：GoalPipeline 透传 park 事件并按 reply_id 把续接事件路由到 executor 或 verifier，中断事件转发给 parked 方——但仅进程内有效（项4）。（A1）

**证据**：
- 事件定义 [L2.0.7] `event/_event.py`：`RequireUserConfirmEvent` L427-437（reply_id + 待确认 tool_calls）、`RequireExternalExecutionEvent` L440-450、`ConfirmResult` L453-464（confirmed + tool_call + 可回写 `rules: list[PermissionRule]`，即用户可在确认时修改权限规则）、`UserConfirmResultEvent` L467-477、`UserInterruptEvent` L480-502（docstring L481-497：**仅对 parked reply 有意义**；"To interrupt a running (actively-generating) reply, cancel the underlying task instead — the agent handles that path via its own `CancelledError` cleanup"；收到后关闭全部 pending tool call、发 fallback assistant 消息、以 `ReplyEndReason.INTERRUPTED` 结束、不进入推理循环）、`ExternalExecutionResultEvent` L505-515（reply_id + `execution_results: List[ToolResultBlock]`）。[DEV] 行号：440/453/466/480/493/518（U17）。
- Agent 侧 [L2.0.7] `agent/_agent.py`：`reply_stream/reply` 输入 union 含三类续接事件（L256-266/L300-330，reply docstring L316-328 逐一说明语义）；`_check_incoming_event` L1657、`_handle_incoming_event` L1740、`_close_unfinished_tool_calls` L850。部分确认语义：reply_stream note L287-290（只收到部分确认/结果时，不会为未确认的 tool call 重发 require 事件）。
- ChatService [L2.0.7] `app/_service/_chat.py`：run docstring L239-277（Case A 新消息 / Case A 无输入 wakeup 清 inbox / Case B 续接 parked tool call / Case B UserInterruptEvent 中止 parked reply）；`interrupt` L519-576（双路径 + "the operation is idempotent" L538；锁检测 `is_locked(session_lock)` L560-562；resume trigger 携带 `UserInterruptEvent(reply_id=session.state.reply_id)` L569-576）；失败收尾 `_close_failed_reply` L290、`_notify_leader_of_failure` L342、`_report_failure` L430。[DEV] interrupt L646（U17）。
- 取消 [L2.0.7]：`app/_service/_session.py` `cancel_session_run` L256-300（docstring：广播到共享 cancel channel，每个进程的 CancelDispatcher 取消本地 chat-run task **和**该 session 的 BG tasks；轮询锁释放；timeout 默认 10s 返回 False 供级联删除继续）；`app/_manager/_cancel_dispatcher.py` L2-14 模块 docstring（两个订阅频道：session cancel / 单 BG task cancel——后者由 `ToolStop` 工具跨 worker 触发）、`CancelDispatcher` L28；`app/_manager/_chat_run_registry.py` `ChatRunRegistry` L23、`spawn` L36（进程内 asyncio task 注册表）。
- Wakeup 机制 [L2.0.7]：`app/_manager/_wakeup_dispatcher.py` `WakeupDispatcher` L65、kind 分派 L202/L234-235；`app/message_bus/_keys.py` `WAKEUP_KIND_WAKE` L33 / `WAKEUP_KIND_RESUME` L38 / `WAKEUP_KIND_MESSAGE` L45、`session_lock` L144、`session_cancel_channel` L221、`session_interrupt_channel` L231。
- GoalPipeline 侧 [DEV] `_goal_pipeline.py`：park 透传 L185-192/L259-267、break L219-221/L323-325、reply_id 路由 L146-161、interrupt 转发 L163-169；README（`examples/pipeline/goal/README.md` L33-46）与测试 `test_resumes_into_the_agent_that_parked`(L212)/`test_resume_keeps_the_iteration_budget`(L232)/`test_rejects_an_unknown_reply_id`(L261) 佐证。
- 预算（相邻治理面）[L2.0.7]：`middleware/_budget.py` `ReplyBudgetControlMiddleware` L21-30（每 reply 加权 token 预算，超限注入提示 L14/L89-92；预算状态存 `agent.state.middle_context` L104）。

**不能确认**：cancel 广播在 bus 断连/进程崩溃时的送达保证（未见 ack 机制；`cancel_session_run` 的 timeout→False 分支即官方对"等不到"的处理）；BG task 被取消后的幂等/补偿语义（未逐读 BackgroundTaskManager）。

### 项9 · event schema / streaming / structured output

**结论**：事件 schema 是 pydantic 化的封闭 union：`EventBase(BaseModel)` + `EventType(StrEnum, 28 值)` + `AgentEvent` TypeAlias（28 个事件类）（2026-09-08 独立复核实测修正，原误记 27/29）。streaming = `reply_stream` 异步生成器逐事件产出（start/delta/end 三段式覆盖 text/data/thinking/tool_call/tool_result），最终 `Msg` 可由事件流确定性重建（`Msg.append_event`，ChatService 借此持久化回复）。structured output = `reply_stream(structured_schema=PydanticModel, yield_final_msg=True)` → 内建工具 `GenerateStructuredOutput` 产出 → `Msg.structured_output: dict` + `Msg.finished_reason`。（A1）

**证据**（[L2.0.7]，[DEV] 行号已锚定）：
- `event/_event.py`：`EventType` L26-67（REPLY_START/END、MODEL_CALL_START/END、TEXT_BLOCK_{START,DELTA,END}、DATA_BLOCK_*、THINKING_BLOCK_*、HINT_BLOCK、TOOL_CALL_*、TOOL_RESULT_{START,TEXT_DELTA,DATA_DELTA,END}、EXCEED_MAX_ITERS、REQUIRE_USER_CONFIRM、REQUIRE_EXTERNAL_EXECUTION、USER_CONFIRM_RESULT、USER_INTERRUPT、EXTERNAL_EXECUTION_RESULT、CUSTOM）；`EventBase(BaseModel)` L70；各事件类 L83-549（`ExceedMaxItersEvent` L415-417 已标注 deprecated："still emitted for backward compatibility without semantics; use ReplyEndEvent.finished_reason"）；`CustomEvent` L518-549（服务层扩展位：name + 任意 JSON value，docstring 点名 task progress/team membership/permission updates 等用途）；`AgentEvent` union L552-581。[DEV]：EventType L26、EventBase L70、CustomEvent L531、union L565-594；2.0.8-dev 修改仅 DataBlock 两事件（+name/+url，U7 patch）。
- 重建：`message/_base.py` `Msg.append_event` L244 起（按 EventType 逐类累积 content/usage/error；MODEL_CALL_END 累加 usage——[DEV] 抽出 `append_usage` L515+）；`Msg` L71、`finished_reason: ReplyFinishedReason|None` L107、`structured_output: dict|None` L110、`Usage` L58。
- `types/_reply.py`：`ReplyFinishedReason(COMPLETED|INTERRUPTED|EXCEED_MAX_ITERS|ERROR)` L10-16；`ErrorType` L19-25（认证等致命错误分类）。
- structured output 实现：`agent/_structured_output_tool.py` `_GenerateStructuredOutput` L42-45（name="GenerateStructuredOutput"）、jsonschema `Draft202012Validator` + 默认值填充扩展 L20-39；`ReplyContext.structured_schema` 的序列化（类→JSON schema dict）`state/_state.py` L162-172。GoalPipeline 对其的依赖见项2（L181/L251，重提示文案点名该工具 L213-215/L285-287）。
- 服务层扇出：ChatService docstring L105-110（每事件写 replay log + live Pub/Sub）；`_project_event` L1308（EventProjector 机制，`extra_projectors` 参数 L126）。
- 流式续传事实：`SessionStatus` 推导只依赖持久化 context（项5），事件 replay log 供晚到订阅者（ChatService docstring L108-110）。

**不能确认**：事件 schema 的官方稳定性承诺（无任何 versioning 标注；见项12）；replay log 的裁剪/保留策略（message_bus 实现未逐读）。

### 项10 · pipeline / agent 如何接入 create_app 或服务层

**结论**：**Agent 接入 = 官方提供且完备**（create_app → FastAPI 全套路由/服务/manager，Agent 由 ChatService 每回合按 AgentRecord+SessionRecord 装配）。**Pipeline 接入 = 官方未提供**：`create_app` 无任何 pipeline 参数；ff8697ec 上 `app/_service/_chat.py`、`app/_app.py`、`app/deps.py`、`app/_lifespan.py` 中 "pipeline" 引用为零；`ChatService.run` 只接受 `agent_id`。pipeline 的官方接入点**只有 console**：`launch_console(agent: Agent | PipelineProtocol)`（2.0.8-dev 把 console 的参数类型从 `Agent` 扩成 `Agent | PipelineProtocol`）。也就是说，2.0.8-dev 的 pipeline 是"库/控制台级"构件，未进入 HTTP、session、持久化、锁、取消、事件扇出等任何服务层治理。（A1）

**证据**：
- `create_app` [L2.0.7] `app/_app.py` L78-103 签名（storage、message_bus、workspace_manager、knowledge_base_manager、knowledge_parsers/chunkers、blob_store、enable_index_worker、mcp_hubs、skill_hubs、enable_channel_worker、extra_credentials、extra_middlewares、extra_agent_middlewares、extra_agent_tools、custom_subagent_templates、**custom_agent_cls: Type[Agent]|None**（L96；docstring L242-245 只接受 Agent 子类）、resource_access_policy、channels、download_secret、title、version）→ 返回 FastAPI（L103/L273-283）；docstring L104-127（standalone 或 mount 到既有 app 两种用法）。[DEV] 增加 `enable_scheduler: bool = True`（L91；docstring L203-210：APScheduler jobstore 是内存态，多副本必须只留一个 True——官方自己声明的调度单点约束）。
- pipeline 零接入：U17 对 [DEV] `_chat.py/_app.py/deps.py/_lifespan.py` 的 `grep -in pipeline` 全部为空；U7 中 `_chat.py` 的 +160-11 为 session 自动命名（`_auto_name_session` L323、`_SessionTitle`/`_NAMING_PROMPT` 等），与 pipeline 无关（patch 全文核读）。
- console 接入 [DEV] `console/_console.py`：L8 `from ..pipeline import PipelineProtocol`、L19 `_run_reply(agent: Agent | PipelineProtocol, …)`、L96-97 `launch_console(agent: Agent | PipelineProtocol, …)`、docstring L118（"The agent or pipeline to interact with"）；U7 diff（+5-4）证实这是 2.0.8-dev 的类型扩展。[L2.0.7] 的 launch_console 仅接受 Agent（2.0.7 无 pipeline 模块）。
- 官方示例即以此方式运行：`examples/pipeline/goal/goal_pipeline.py` L72-74 `await launch_console(agent=pipe)`。
- Agent 服务层装配链（对照）：路由 `app/_router/_chat.py`/`_session.py`/`_agent.py` 等（目录清单 P13）→ ChatService（项5）→ `get_toolkit`（项7）→ `Agent(...)`（`custom_agent_cls` 可替换实现类，`app.state.custom_agent_cls` L293 [L2.0.7]/L301 [DEV]）。

**不能确认**：官方是否有把 pipeline 纳入 ChatService/存储的路线图（无证据）；A2AAgent（[DEV] `agent/_a2a_agent.py`，docstring L2 "A stateful client-side adapter for remote A2A agents"，`agent/__init__.py` L4 导出）是否会成为服务层跨 agent 调用的官方通道——其 657 行实现未逐行审计（超出 12 项范围，记 EVIDENCE_GAP）。

### 项11 · 官方示例是教学样例还是生产治理保证

**结论**：**教学/快速上手样例，不构成生产治理保证。** pipeline 官方示例显式使用 `PermissionMode.BYPASS` 绕过权限体系、单进程 `asyncio.run`、示例目录内 LocalWorkspace、终端 console 交互；README 自述为 "demo"。官方仓库同时存在更接近生产的构件（`examples/agent_service`、`examples/web_ui` 全栈示例、app 服务层的 permission/budget/resource_access_policy），但这些与 pipeline 示例是分离的——pipeline 没有对应的服务化/治理示例。测试（tests/pipeline_goal_test.py）为 StubAgent 单测，验证行为语义而非生产保证。（A1；"不构成生产保证"的定性基于示例自身内容，属 A1 可直接支持的表述）

**证据**：
- [DEV] `examples/pipeline/goal/goal_pipeline.py`：L38-42 与 L57-61 两处 `state=AgentState(permission_context=PermissionContext(mode=PermissionMode.BYPASS))`；L23-25 `LocalWorkspace(workdir=os.path.join(os.path.dirname(__file__), "workspace"))`；L30-35/L49-54 直接以 `DASHSCOPE_API_KEY` 环境变量构造模型凭据；L77 `asyncio.run(main())`；无任何 storage/message_bus/预算/审计接线。
- [DEV] `examples/pipeline/goal/README.md`：L6 "What the **demo** shows"；L23-28 Quickstart（export key + python 直跑）；L30-31 "The pipeline is handed straight to `launch_console`"。
- 示例目录全量（U10）：`a2a`（client.py/server.py，教学 A2A 互通）、`agent_service`（服务化示例，main.py，2.0.8-dev 中 +4-1 微调）、`console`、`long_term_memory/mem0`、`pipeline/goal`、`rag`、`web_ui`（完整 React 前端 + pnpm lock，2.0.8-dev 中大量演进）、`workspace`。
- 测试性质（U16）：`StubAgent`（L59）+ `IsolatedAsyncioTestCase`（L90），断言事件序列/预算/路由行为；无并发、崩溃恢复、持久化、权限用例。
- 对照的生产构件存在于库内而非示例：permission（项7）、`ReplyBudgetControlMiddleware`（项8）、`DenyAllResourceAccessPolicy` 默认（`app/_app.py` L246-251/L294-296 [L2.0.7]）。
- METADATA 自declare：`Classifier: Development Status :: 4 - Beta`（P5）。

**不能确认**：examples/web_ui 与 agent_service 是否被官方视为生产参考架构（README 未逐篇核读）；docs.agentscope.io 上是否有生产部署指南（U18 NETWORK_BLOCKED）。

### 项12 · 版本升级时必须冻结 / 迁移的 state schema

**结论**：官方**没有** schema 版本化或迁移框架（无 alembic、无 schema_version 字段、无迁移脚本目录）；只有两处点状向后兼容：`AgentState._migrate_legacy_reply_fields`（pydantic before-validator，把旧顶层 `reply_id/cur_iter` 迁入 `reply_context`）与 team `member_ids` 的读时懒迁移。包自我声明 Beta。2.0.7→2.0.8-dev 的 46 commits 已实际改动 AgentState/事件/存储模型 schema（详见下），因此平台若以 AgentScope 为运行时底层，必须自行冻结并迁移：AgentState JSON（含 Task/ReplyContext/ToolContext/PermissionContext/middle_context）、Msg/ToolCallBlock/ToolCallState、EventType/AgentEvent union、SessionRecord/SessionConfig（含 knowledge_config）、AgentData、structured_schema 的 JSON schema 形态。（A1 事实部分；"平台必须冻结的清单"为 I1 推断，依据是官方无保证 + 已观察到的跨版本 schema 变动）

**证据**：
- 点状迁移 [L2.0.7]：`state/_state.py` L192-210（"For backword compatibility" 注释 L192-194 + `_migrate_legacy_reply_fields` L195-210，docstring 明言"so that the states saved by previous versions load correctly"）；[DEV] 同 validator 在 L223（U17）。`app/storage/_utils.py` L45-105（team `member_ids` → `members` 懒迁移，读时原地改写并回写以终止迁移）。
- 无框架：`grep -rn "alembic|migrat|schema_version" app/storage/` 仅命中上述懒迁移注释（P13）；dist-info 无迁移工具；`pyproject.toml`（本项目侧）亦无相关依赖。
- Beta 声明：METADATA `Classifier: Development Status :: 4 - Beta`（P5）。
- 2.0.7→2.0.8-dev 已发生的 schema 变动（U7 compare + patch 核读）：
  - `state/_state.py` +53-27：`ToolContext.get_cache` 增加 `mtime` 参数、读缓存失效逻辑重写（patch 片段核读）；新增 `state/_a2a_state.py`（+23，`A2AAgentState`）并在 `state/__init__.py` 导出（+3）。
  - `event/_event.py` +15-2：`DataBlockStartEvent.name` 新增；`DataBlockDeltaEvent.data` 变可选 + `url` 新增（**已持久化事件的字段语义变化**：Msg.append_event 对应新增 URLSource 分支，message/_base.py patch L328+）。
  - `storage/_model/_session.py` +239-21：新增 `SessionNaming`（[DEV] L181）、`ChannelOrigin`；`storage/_sql/_tables.py` +14-2、`_mappers.py` +31（SQL 表结构漂移）；`storage/_base.py` +13-13。
  - `agent/_agent.py` +321-33、`agent/_config.py` +75-10（构造/配置面漂移）；`app/_app.py` +9（`enable_scheduler` 新参数，行为面：调度器多副本约束显式化）。
  - 本项目侧对照：运行时 pin `==2.0.7`（P6/P7），即上述漂移目前尚未进入本项目 venv；一旦升级到 2.0.8 正式版，storage 表与已存 AgentState/事件 replay 数据的兼容负担落在平台。
- 官方对持久化数据的兼容姿态仅有 validator 级（上文两处），无发布物层面的迁移说明（v2.0.7.post1 release notes 未采集到迁移章节——release body 未读取，记 EVIDENCE_GAP）。

**不能确认**：2.0.8 正式 tag 相对 ff8697ec 还会有多少 schema 变动（发布不存在，无法核对）；官方是否承诺 AgentState JSON 的前向兼容窗口（无任何声明）。

---

## 3. 三列表：官方提供 / 平台必须补齐 / 不能确认

> 覆盖 12 项契约；"官方提供"注明存在于哪个版本（2.0.7=已发布可装；2.0.8-dev=仅 main@ff8697ec）。

### 3.1 官方提供（A1）

| 能力 | 版本 | 关键证据 |
|---|---|---|
| PipelineProtocol（reply_stream 最小接口 + AgentEvent/Msg 输出） | 2.0.8-dev | [DEV] pipeline/_base.py L15-33 |
| GoalPipeline（executor+verifier 目标循环、结构化 report/verdict、HITL park/resume 路由、迭代预算、impossible 终态） | 2.0.8-dev | [DEV] pipeline/_goal_pipeline.py L55-325；tests L101-272 |
| AgentState pydantic 状态容器 + 旧格式兼容 validator | 2.0.7（2.0.8-dev 延续+扩展） | [L2.0.7] state/_state.py L178-265、L195-210 |
| Session=持久化/锁/事件扇出单位；SessionRecord.state 持久化 AgentState（SQL/Redis 双后端） | 2.0.7 | storage/_model/_session.py L179-221；storage/_base.py L371-449；_sql/_storage.py L3-17 |
| ChatService：每回合装配 Agent、Case A/B 输入语义、事件 replay+live 扇出、失败收尾 | 2.0.7 | app/_service/_chat.py L98-111、L227-288 |
| SessionStatus 四态 + 由持久化 context 推导 parked 状态 | 2.0.7 | app/_service/_session.py L61-95、L212-250 |
| Task 内部计划项模型 + TaskCreate/Get/List/Update 工具（tasks_context 直写、随 session 持久化） | 2.0.7 | state/_task.py L11-39；tool/_task/_create_task.py L83-130；_toolkit.py L61-62 |
| Toolkit/MCPClient(stateful+stateless)/Skill+Loader/KnowledgeBase+RAGMiddleware 装配链；get_toolkit 七类来源；MCPHub/SkillHub | 2.0.7 | tool/_toolkit.py L88-115；mcp/_mcp_client.py L25-59；middleware/_rag.py L456；_toolkit.py L38-77 |
| HITL 事件对（RequireUserConfirm/RequireExternalExecution ↔ UserConfirmResult/ExternalExecutionResult/UserInterrupt）+ ConfirmResult 可回写权限规则 | 2.0.7 | event/_event.py L427-515 |
| interrupt 双路径（cancel 广播 / resume 注入）+ cancel_session_run + CancelDispatcher + WakeupDispatcher | 2.0.7 | _chat.py L519-576；_session.py L256-300；_cancel_dispatcher.py L2-45 |
| 事件 schema（EventType 28 值 / AgentEvent 28 成员 pydantic union）+ delta 流式 + Msg.append_event 重建 + CustomEvent 扩展位 | 2.0.7（2.0.8-dev 微调 DataBlock） | event/_event.py L26-67、L552-581；message/_base.py L244+ |
| structured output（structured_schema + GenerateStructuredOutput + Msg.structured_output/finished_reason） | 2.0.7 | agent/_agent.py L256-266；agent/_structured_output_tool.py L42-45；types/_reply.py L10-16 |
| create_app 服务层（FastAPI 路由/存储/总线/调度/渠道/知识/工作空间/权限/预算 middleware/resource_access_policy） | 2.0.7（2.0.8-dev +enable_scheduler） | app/_app.py L78-296 |
| console 接入 pipeline（launch_console 接受 Agent \| PipelineProtocol） | 2.0.8-dev | [DEV] console/_console.py L96-97 |
| team 多 agent 协作（AgentCreate/AgentInvite/TeamSay/SubAgentTemplate，bus 异步） | 2.0.7 | app/_tool/*；app/_types.py L89-129 |
| 官方示例与测试（pipeline/goal 示例、10 个 GoalPipeline 单测、web_ui/agent_service 示例） | 2.0.8-dev | examples/pipeline/goal/*；tests/pipeline_goal_test.py |
| A2AAgent（远端 A2A agent 客户端适配器） | 2.0.8-dev | [DEV] agent/_a2a_agent.py L2；agent/__init__.py L4 |

### 3.2 平台必须补齐（官方不提供，A1 证明缺失）

| 缺口 | 对应契约项 | 缺失证据 |
|---|---|---|
| 多 stage / DAG / 条件分支 / 循环编排抽象 | 项3 | pipeline 模块仅 3 文件 2 导出（U9/U13）；无 stage 概念全文核对（U12） |
| pipeline 内并行分支与 barrier/join 聚合 | 项3 | 同上；唯一并发是 agent 内工具级（_agent.py L1993） |
| 选择性重做（单阶段/节点级 attempt 重跑） | 项3 | GoalPipeline 仅整体反馈重迭代（L311-321），无 attempt 模型 |
| pipeline state 跨进程持久化与崩溃恢复（_iters/_goal/循环相位） | 项4 | 纯内存字段（L83-91），无序列化 API，storage 无 pipeline 实体 |
| pipeline 的服务层托管：HTTP 触发、session 绑定、事件扇出、锁、取消、预算、权限接线 | 项10 | create_app 无 pipeline 参数；app 层四文件 pipeline 零引用（U17）；官方接入点仅 console |
| Flow 级版本/发布/回滚（PipelineDefinition 的冻结与快照） | 项3/10/12 | pipeline 是代码构造对象，无任何定义序列化/版本化机制 |
| schema 冻结与迁移层（AgentState JSON、Msg、事件 union、storage 表、structured_schema） | 项12 | 官方无版本化/迁移框架（仅两处点状 validator），Beta 声明，2.0.7→dev 已现 schema 漂移 |
| 生产化治理接线（pipeline 场景的 permission/budget/audit——官方示例以 BYPASS 绕过） | 项11 | examples/pipeline/goal L38-42/L57-61 |
| 平台任务体系（触发/调度/看板/跨 session 可见）——官方 Task 只是 agent 内部计划项 | 项6 | Task 无触发器/调度消费；blocks/blocked_by 无调度/执行消费者（展示型读取属 LLM 信息面） |

### 3.3 不能确认（证据不足，不得写成事实）

| 事项 | 原因 |
|---|---|
| 2.0.8 正式版发布时间、最终 tag 内容及其与 ff8697ec 的差异 | 版本不存在（PyPI 404、无 tag）；main 持续变动 |
| docs.agentscope.io pipeline/overview 页面内容 | NETWORK_BLOCKED（U18：WebFetch ECONNRESET ×2 + curl HTTP 000）；仅 NEWS.md 链接可证其存在 |
| GoalPipeline `max_retries`/`verifier_reset_context` 声明但未使用的官方意图（bug or 未接线） | 源码事实确定（仅 L63/65/74/79/85/87 出现），意图无 issue/文档证据 |
| Task.blocks/blocked_by 的预期执行语义 | 字段存在、可被 TaskUpdate 写入，但无任何调度/执行消费者源码（展示型读取属 LLM 信息面） |
| ChatService 长 reply 中途崩溃时的状态恢复粒度（是否有中间快照） | `_persist` 在结束路径；中途语义未逐行核验（EVIDENCE_GAP） |
| MCPHub/SkillHub 供给资源的版本 pin 语义 | MCPCard/SkillCard 字段未逐一读取（EVIDENCE_GAP） |
| A2AAgent 的治理完备性（权限/预算/审计是否贯穿） | 657 行实现未逐行审计，超出 12 项范围 |
| replay log / 事件持久化的保留与裁剪策略 | message_bus 存储实现未逐读 |
| 官方是否存在 pipeline 服务化的路线图 | 未采集到 milestone/roadmap 证据 |

---

## 4. 对"我方把 AgentScope 当唯一运行时底层"既有拍板的契约层影响

（只列事实性约束，不做架构决策；架构选择属后续阶段 04/05。）

1. **版本基线是双轨的**：可安装、可 pin、已被本项目 lock 的是 2.0.7（registry wheel）；一切"2.0.8 能力"（PipelineProtocol/GoalPipeline/A2AAgent/enable_scheduler/session 自动命名）只存在于未发布 main。若"唯一运行时底层"包含 pipeline 能力，则在 2.0.8 正式版发布前，生产环境无法通过 registry 合法获得该能力——现有 AUDIT-HANDOFF U05 裁定（正式版前只允许沙箱 spike）与今日事实仍然自洽。
2. **pipeline 契约面极小且不含治理**：官方给平台的唯一承诺是 `reply_stream(inputs) -> AsyncGenerator[AgentEvent | Msg]` 这一个方法形状。Run/ChildInvocation/父子关联/attempt/预算/权限/审计/取消传播/持久化，全部不在 pipeline 契约内。任何 AgentFlow 类产品语义都由平台层定义并自证。
3. **官方 app 服务层与我方 server 存在职责重叠的既成事实**：agentscope.app 自带 FastAPI 路由、SQL/Redis 存储、message bus、分布式 session 锁、cron 调度器、IM channel 网关（Feishu/Discord/DingTalk）、知识库索引 worker、工作空间管理、权限与预算 middleware。"唯一运行时底层"意味着必须显式回答：这些官方服务面哪些启用、哪些由 MoreThanCorn server 替代（此为契约边界事实，非本阶段决策）。
4. **调度器有官方声明的单点约束**：`enable_scheduler` docstring 明言 APScheduler jobstore 为内存态，多副本必须仅一个进程持有定时器（[DEV] app/_app.py L203-210）。平台若依赖官方调度，多副本拓扑受此约束。
5. **状态恢复保证只到 Agent 会话级**：跨进程可恢复的是 SessionRecord.state（AgentState）+ 事件 replay log；pipeline 相位/预算不可恢复。平台的"恢复"承诺只能建立在会话级状态之上，或自建 pipeline 状态外置。
6. **schema 无稳定性承诺**：Beta 分级 + 46 commits/174 文件的版本间漂移（含 SQL 表、事件字段、AgentState 结构）+ 无迁移框架 ⇒ "唯一底层"的升级动作必然伴随平台侧快照/迁移工程；2.0.8 正式发布后需按 AUDIT-HANDOFF 既定闸门重新对照 tag 审计（该要求至今未过期）。
7. **多 role 的官方路径是异步 team，而非编排节点**：若产品需要"Flow 节点=role"的同步编排，官方现状（team via message bus + GoalPipeline 双 agent 循环）都不直接提供，需平台自建（与项3缺口一致）。
8. **HITL/取消语义可复用且有精确契约**：reply_id 路由约定（GoalPipeline L146-161）、Case A/B 输入分类（ChatService.run docstring）、interrupt 幂等双路径、cancel 广播+锁轮询——这些是平台构建统一 Run 治理时可直接对齐的官方语义，无需发明。
9. **A2A（2.0.8-dev）出现**：跨 agent/跨进程调用开始有官方协议适配器（A2AAgent + examples/a2a + 812 行单测），未来"Agent 调 Agent/Flow"的官方通道可能出现分化（team tools vs A2A vs pipeline），平台选型时需重新审计（本轮未深查，见 §3.3）。

---

## 5. EVIDENCE_GAP 与 NETWORK_BLOCKED 汇总

### NETWORK_BLOCKED

| 目标 | 现象 | 处置 |
|---|---|---|
| `docs.agentscope.io/latest/en/building-blocks/pipeline/overview` | WebFetch ECONNRESET ×2；curl HTTP 000 ×1 | 重试后仍失败，如实记录。官方文档内容未核验；仅以 [DEV] docs/NEWS.md 中的官方链接证明该页存在 |
| `pypi.org/pypi/agentscope/json`（全量）及 `/simple/`、`/project/` 页 | WebFetch 60s 超时 ×3、Connect Timeout ×1 | 改用 per-version JSON 端点（200/404 判定）+ GitHub releases/tags 双源交叉，结论不受影响 |
| `api.github.com/.../tags` 首次调用 | ECONNRESET ×1 | 按规程重试一次成功（U3） |
| `raw.githubusercontent.com`（多个文件）经 WebFetch | 60s 超时 ×3 | 改用只读 curl GET 成功（U11-U17），全部记录 |

### EVIDENCE_GAP

1. GoalPipeline `max_retries`/`verifier_reset_context` dead params 的官方意图（未查 issue 区）。
2. ChatService 长 reply 中途崩溃的恢复粒度（中间快照有无）。
3. MCPCard/SkillCard 的版本 pin 字段。
4. A2AAgent 实现的治理完备性（未逐行审计）。
5. message bus replay log 保留/裁剪策略。
6. examples/web_ui、agent_service 的官方定位（生产参考 or 教学）。
7. v2.0.7.post1 release notes 是否含迁移说明（release body 未读取）。
8. 官方 pipeline 路线图/milestone。
9. Task 计划项在 web_ui 中的投影方式（未核验前端示例源码）。

---

## 6. G4 · AgentScope 证据闸门自检表

| 闸门条款 | 自检结果 | 说明 |
|---|---|---|
| 所有版本和能力结论可定位到 tag/commit 和源码行 | 通过 | 版本事实定位到 PyPI per-version 端点响应码/时间戳、GitHub tags/releases API、compare API、dist-info 文件；能力结论均给出 [L2.0.7]（本地安装版）或 [DEV]（ff8697ec，= 采集时 main HEAD，compare identical）文件+行号；探针全清单见 §0 |
| 没有把 main 分支能力冒充已发布 2.0.8 | 通过 | 全文将 "2.0.8" 一律表述为 **2.0.8-dev@ff8697ec（未发布：PyPI 404、无 tag）**；PipelineProtocol/GoalPipeline/A2A/console 集成/enable_scheduler 均显式标注"仅 2.0.8-dev"；同时明确本项目实装为 2.0.7 正式版，且 2.0.7 中无任何 pipeline 代码（P10/P11） |
| 没有把 GoalPipeline 外推成完整 WakerFlow 产品 | 通过 | 项2/项3/项4/项10 明确：单 executor+verifier 固定循环、无 stage/并行/barrier/选择性重做/版本化/持久化/服务层托管；§3.2 将 Flow 产品语义全部列入"平台必须补齐" |
| 没有把 Planning 内部任务项外推成平台任务 | 通过 | 项6 明确 Task=AgentState.tasks_context 内的 agent 内部计划项，无触发/调度/跨 session 可见性，blocks/blocked_by 无调度/执行消费者；§3.2 明列"平台任务体系"为平台补齐项 |
| 没有把内存字段外推成持久化恢复保证 | 通过 | 项4 明确 GoalPipeline._iters/_goal 为进程内存字段、无序列化、重启即失；持久化恢复保证仅归于 AgentState/SessionRecord（app 服务层，2.0.7 已发布），两者严格分界 |
| （附加）未依赖二手博客作为技术结论依据 | 通过 | 全部 A1 证据来自：本地已安装包源码、官方仓库 API/raw 源码、官方 tests/examples/NEWS、PyPI 官方端点；docs.agentscope.io 不可达已记 NETWORK_BLOCKED 而非转引二手来源 |
| （附加）RESEARCH_ONLY 边界 | 通过 | 仅创建本文件；未改代码/lockfile/requirements/docs/v2-design；未安装依赖；未运行有副作用脚本；远端源码仅内存管道读取未落盘 |

---

*报告完。交叉引用：任务书 §6（12 项清单）、§3（证据等级）、G4；既有裁定核对对象：docs/v2-design/AUDIT-HANDOFF-agentscope-plan.md L36/L89/U05、11-agentscope-full-integration.md L7/D02、12-event-driven-workorder-pipeline.md L138。*
