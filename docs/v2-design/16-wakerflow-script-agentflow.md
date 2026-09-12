# 16 号稿：脚本编排 AgentFlow（WakerFlow 语义对齐）设计方案

> 版本：v1.1
> 日期：2026-09-12
> 状态：`APPROVED / IMPLEMENTATION_BASELINE`（D1–D3 已拍板，P1 开工）
> 用户拍板（2026-09-12）：「就按照你说的来」=立项脚本编排方向：Python 脚本为唯一事实源、
> 五原语注入、Canvas 降为投影；**D1=子进程沙箱一步到位、D2=DAG 冻结共存、D3=NL 生成 P4 后置**。
> 上位关系：运行/触发/执行事实模型以 `docs/product-domain/execution-automation-batch-spec.md`
> 为准（本稿不改动其已冻结结论，仅申请 §8.2 增补一节，见 §12）；doc11 v6.1 维持上位架构。

---

## 0. 结论与拍板记录

产品定义：**AgentFlow 升级为双形态**——既有声明式 DAG 形态保留（冻结，不再发展），
新增「脚本编排」形态：脚本（Python）是唯一事实源，脚本内用五个编排原语驱动单/多 Agent
串行、并行、循环执行；画布降为脚本的可视化投影（只读 + 点击跳行）。

| 拍板点 | 结果 |
|---|---|
| D1 沙箱 | **子进程沙箱一步到位**（用户选择，强于推荐的受限解释器） |
| D2 双形态 | DAG 冻结共存：既有 DAG flow 原样可跑可看，新建默认推荐脚本形态 |
| D3 NL 生成 | P4 后置；原型期手写 golden 脚本走通全链（真实 LLM 额度另批） |

## 1. 调研对齐（先行证据）

活体 127.0.0.1:19830 只读实测（2026-09-12），证据落盘
`research/morethancorn/10-qoderwake-product-research/`：

- `13-wakerflow-script-semantics.md` —— 语义核证；
- `wakerflow-script-evidence-20260912.json` —— `GET /api/agents/{wakerId}/workflows/{id}`
  原始响应：`script`（9.6KB JS 源码）+ `meta.callSites[]`（primitive/label/line/column）
  + `digest` + `inputSchema/outputSchema` + `generationSessionId`；
- `screenshots/20260912-wakerflow-canvas-projection.png` —— 画布=阶段卡套 worker 卡/
  用户决策卡、parallel 三卡并排、底部按阶段锚定的 AI 调整输入框；
- `screenshots/20260912-wakerflow-script-editor.png` —— 脚本视图=可编辑代码编辑器，
  右上角出现「保存」，右下角字数配额。

关键事实：WakerFlow 定义体是一段**可执行 JS 模块**，画布是 `callSites` 的投影而非独立
定义；串=顺序 await、并=parallel()、循环/条件=原生控制流；`worker()` 经
`resolve:{kind:'waker', wakerId}` 驱动任意 Waker（多 agent）；`askUser()` 为 HITL。
**doc11 v4.1 决策点13「NL 生成但产物结构化」据此修正为：产物=代码，结构化阶段序列是投影。**

## 2. 目标与非目标

目标：用户手写（P4 后为 NL 生成）一段 Python 定义多 agent 串/并/循环流程 → 输入参数 →
运行 → 画布逐步点亮 → 中途人工确认（HITL）→ 结构化交付物落 `run.output`，全程按既有
事实模型可观测。

非目标（本期）：不做分布式编排；不做节点级断点续跑（恢复=整 run 重跑，与 F0 一致）；
不做脚本内平台工具直连（工具走各 Agent 的 Release 清单）；不做 DAG↔脚本双向转换；
不做多脚本 import 复用；不做持久化挂起（§7 登记边界）。

## 3. 领域模型与存储

复用既有实体，不新增表：

| 实体 | 变化 |
|---|---|
| `AgentFlowVersion.definition` | JSONB 判别形态：DAG（现状 `{nodes, edges}`）或 `{kind:"script", script:str, meta:{inputSchema, outputSchema, phases[], scope_agent_id?}}`；`content_digest` 照用 |
| `AgentFlowRelease` / 发布链 | 不变（release 仍指向 version） |
| `AgentFlowRun` / `AgentFlowNodeRun` / `AgentSessionIndex` | 不变——脚本执行的每个 worker/askUser 调用落 NodeRun 行，Session 关联照旧（F0 增量落库直接复用） |
| 触发 | 不变——automation target=agentflow 的 schedule/api/event/manual 全部对脚本形态生效 |

NodeRun 映射：`node_id = worker/askUser 的 label`（缺省用调用点序号），`attempt` 在
run 重跑时递增（沿用 uq(run_id,node_id,attempt)），`session_id` 由 stage 事件回填。

## 4. 脚本契约（完整 Python，子进程隔离下放开语法白名单）

```python
META = {
    "inputSchema": {...}, "outputSchema": {...},
    "phases": ["生成周会议程", "确认与修订", ...],
    "scope_agent_id": "缺省 waker（可选）",
}

async def run(ctx):
    phase, log, worker, askUser, parallel = ctx.primitives
    phase("生成周会议程")
    agenda = await worker(f"…{team}…", schema=AGENDA_SCHEMA,
                          waker="<platform agent id>", label="设计通用周会议程草案")
    for round in range(2):                        # 循环=原生
        check = await askUser("…", options=["采纳", "调整"])
        if check.skipped or check.value.startswith("采纳"):
            break
    results = await parallel([lambda: worker("…", schema=S1), ...])
    return {"agenda": agenda, "checklists": results}
```

D1=子进程沙箱后**不再做语法白名单**——子进程内是完整 Python。保留的契约与产品约束：

- 模块必须定义 `async def run(ctx)`，返回值即 flow 输出（对照 `meta.outputSchema` 由
  平台校验，不一致→run failed/OUTPUT_SCHEMA_ERROR）；
- `worker(waker=...)` 取值必须是平台 Agent id；平台保存时用 ast 静态扫描所有
  `waker=` 常量实参 + `meta.scope_agent_id`，逐一预解析运行时绑定，缺绑定→保存失败
  （fail fast，与 DAG 节点 agent 校验同思路）；
- 脚本大小上限 64KB；`meta.phases` 与脚本 `phase()` 调用不一致时以调用为准并告警；
- 超长循环由 run deadline 兜底（§8）。

## 5. 五原语运行时映射（全部落在既有机制上）

| 原语 | 语义 | 我方机制 | 现状 |
|---|---|---|---|
| `worker(prompt, *, schema=None, waker=None, label=None, phase=None)` | 驱动一个 Waker 执行 Prompt，schema 校验结构化输出 | 复用 DAG 节点执行件：per-waker release 绑定（`_node_runtime_binding` 同源）+ `ChatService.run`/`structured_run_core`（schema 校验+grace 重试内建）；每调用新建 Session→NodeRun(running)→SessionIndex→终态回写 | F0 通道复用 |
| `parallel([fn,…])` | 并发扇出，子项异常返回 None 不连坐（脚本自行 filter） | `asyncio.gather`（子进程内）；run 取消→子进程被杀（§8） | 已有 |
| `phase(title)` | 观测分组 | runtime 向平台发 `phase` 事件；执行记录/看板按 phase 聚合（P3 UI 落地） | 事件流已有 |
| `askUser(prompt, *, options=None, default=None)` | HITL，返回 `{value, skipped}` | 见 §7 | 新增挂起语义 |
| `log(msg)` | 过程日志 | `log` 事件 | 已有 |

## 6. 执行引擎（子进程沙箱拓扑）

```
平台(8120)                          运行时(8301)                         沙箱子进程
agentflow_executor                  POST /mtc/script-run (SSE)           app.script_sandbox
  kind=script 分支                    ├─ spawn 子进程(env清洗+rlimits      读 manifest(stdin 首行)
  ast 静态扫描 waker→                  │  +一次性令牌)                     exec(script)
  预解析绑定(_build_script_body)       ├─ stdin/stdout 行 JSON RPC          │ 五原语=RPC
  rt.script_run_stream(body) ─SSE─▶   ├─ RPC worker → 复用 DAG 节点执行     ▼
  消费 stage/phase/log/flow:complete  │    （Session/结构化输出/internal   用户代码
  （F0 增量落库零改动）                 │    token 注册同 flow_runner）     串/并/循环
                                      ├─ RPC askUser → Future 挂起(P2)     (asyncio)
                                      ├─ deadline 到点 SIGKILL             │
                                      └─ flow:complete → SSE 终态 ◀──────── return 输出
```

- 事件契约沿用 DAG 形态：`stage:{label}`（start 带 session_id/end 带 status）+
  `flow:complete`，另增 `phase`/`log` 两类事件——**平台增量落库、Flow SSE 代理、看板
  lane、前端轮询零改动生效**；
- 平台 `start_run` 分支：kind=script → 静态扫描+绑定预解析（失败即 failed 并 422）→
  入 `agentflow-execution` job → worker 内 `execute_agentflow_run` 走脚本分支（与 DAG
  共用 queued/running/终态、attempt 递增、崩溃重跑语义）。

## 7. askUser 挂起/恢复（HITL，P2）

- 子进程 `askUser` RPC → runtime 建 Future + 向平台发 `needs_input` 事件 → 平台落
  NodeRun(status=waiting) + approval 记录 → 前端复用 ApprovalCard 展示；
- 用户答复 `POST /api/v2/agentflows/runs/{rid}/inputs/{node_run_id}`（`{value}` 或
  `{skipped:true}`）→ 平台透传 runtime resume → Future 完成 → RPC 返回 `{value, skipped}`；
- 超时：跟随 run deadline，到期按 skipped 结算；
- 崩溃恢复：run 整体重跑（与 F0 一致）；waiting 不跨进程持久——**原型期已知边界**。

## 8. 沙箱（D1=子进程，已拍板）

**隔离模型**：脚本在独立子进程执行，崩溃/资源失控/死循环不波及运行时；原语只能经
stdin/stdout 行 JSON RPC 调用，通道持一次性随机令牌（父进程校验，无令牌的请求一律拒绝）。

加固清单（P1 落地）：

1. spawn 清洗：最小 env（不继承平台凭据/LLM key；断言 `MTC_INTERNAL_TOKEN`、数据库
   URL 等关键变量不在子进程 env）；cwd=临时目录；关闭多余 fd；
2. rlimits（`preexec_fn` + `resource`）：CPU 时间、地址空间（AS）、打开文件数（NOFILE）；
3. deadline：平台侧到点 SIGKILL 子进程，run 结算为 failed/timeout；
4. 子进程崩溃/非零退出 → run failed（error 保留子进程 stderr 摘要）；
5. RPC 令牌校验 + 单飞行请求 id 匹配（乱序/伪造 id 拒绝）。

**威胁模型诚实交底**：子进程内是完整 Python，对宿主文件与网络的访问无法在进程内彻底
禁止——生产部署必须以 Linux namespace/容器收口网络（登记为部署要求）；dev/单租户阶段
的前提=脚本编辑仅 operator（沿用 `require_operator`）+ 内部部署不公网（与 Spec §16
功能优先安全边界一致）。P4 NL 生成上线前该前提不得放宽。

## 9. Canvas 投影

- 生成：`ast.parse` 遍历模块收集五原语调用点 →
  `callSites:[{primitive, label, phase, lineno, col_offset}]` 存入 `definition.meta`
  （与 QoderWake 同构）；
- 渲染（P3）：阶段列布局（视觉沿用现有 agentflow 画布卡片规格），parallel 组内并排，
  askUser 卡独立形态；**只读**；运行中卡片叠加 NodeRun 实时状态（复用 F0 SSE/轮询）；
- 交互：点击卡片 → 脚本编辑器滚动到对应 `lineno` 高亮（投影与代码联动，不做画布反向编辑）。

## 10. NL 生成与 AI 共编（D3=P4 后置）

- `POST /api/v2/agentflows/generate-script {brief, currentScript?}` → 平台既有 LLM 连接
  通道 → `{script, name, description}` → §4 契约静态校验（入口/meta/waker 绑定/大小），
  不过则带错误自动重生成（≤2 轮）；
- 前端：brief 输入（新建页/画布底部按阶段锚定调整框）→ diff 预览 → 确认存为新版本；
- 真实 LLM 调用耗额度：联调/验收前须用户批准。

## 11. 前端信息架构与组件基线

- 页面不新增：`agentflow-detail` 的 画布|脚本 toggle 语义升级——script 形态下
  脚本视图=CodeMirror（`@uiw/react-codemirror`+`@codemirror/lang-python`，**依赖已在
  仓内**）+保存=新版本；画布=§9 投影；版本历史/输入参数/运行/执行记录组件全部复用；
- 组件基线交底：编辑器=CodeMirror（已引入，非新基线）；画布卡片=现有 agentflow 画布
  卡片规格沿用；不引入 monaco/自研编辑器。

## 12. 与既有文档的关系（P5 回写）

1. `execution-automation-batch-spec.md` §8.2 增补「脚本形态」小节：DAG 与脚本同为
   AgentFlow 版本形态，执行事实模型不变；§8.2「业务批量节点」条款不受影响——
   `parallel` 是控制流并行，不是业务批次（不产生 TaskRun/AnalysisItemRun 语义）；
2. doc11 v6.1 决策点13 修正随下次 doc11 修订回写；
3. 本稿不推翻 Spec 任何已冻结决策；触发/Invocation/幂等/预算仍以 Spec 为准。

## 13. 验收标准

- AC-S1 串行 golden：三 phase 串行脚本，NodeRun/SessionIndex 执行中逐步可见（F0 探针法）；
- AC-S2 并行 golden：`parallel` 三 worker 并发可证（时间重叠），单子失败降级 None、
  其余成功，run 终态正确；
- AC-S3 循环+HITL golden：`for`+`askUser` 两轮修订脚本，ApprovalCard 出现、答复后继续、
  skipped 分支 break、deadline 到期按 skipped 结算（P2）；
- AC-S4 沙箱负向（子进程版）：RPC 无令牌/伪造 id 拒绝；deadline 到点 SIGKILL 且 run
  failed；子进程主动 crash → run failed 且 stderr 入 error；子进程 env 断言无平台凭据；
  CPU/内存超限被 rlimit 终止；
- AC-S5 投影（P3）：callSites 单测与手工标注一致；画布点击跳行；代码修改后投影重算；
- AC-S6 NL 生成（P4）：brief→脚本→契约校验→真实运行通过（额度批准后）；
- AC-S7 回归：DAG 形态与全量门禁不破坏（pytest 504+ 基线续绿、vitest/tsc/build 绿）；
  视觉逐屏人工签字（画布/脚本/运行记录三态，P3）。

## 14. 实施切片

- **P1（进行中）** 沙箱子进程+RPC 协议+运行时 script-run 端点+平台 kind=script 分支
  （子进程五原语语义 hermetic 单测：串/并/循环/降级；平台分支 F0 探针法测试；AC-S4 部分）；
- **P2** askUser 挂起/恢复+平台 approval 接线（AC-S3）；
- **P3** 投影画布+脚本编辑器前端（AC-S5/AC-S7 视觉部分）；
- **P4** NL 生成与 diff 预览（AC-S6，额度批准后）；
- **P5** Spec §8.2 增补+doc11 决策点13 回写+验收文档收口+真实运行时冒烟（额度批准后）。

## 15. 五维自检结论（执行前五查）

1. **疏漏**：脚本 64KB 上限、run deadline 兜底、编辑权限 operator、automation 触发对
   脚本形态天然生效、子进程网络访问的生产收口登记——均已入 §3/§4/§8；
2. **逻辑冲突**：与 Spec §8.2 批量条款、§6 触发分类逐条核对无冲突（§12 显式声明）；
   与 F0 异步/增量机制正交且复用；
3. **漏功能点**：版本 diff 视图、脚本导入导出、持久化挂起——列入 §2 非目标/后备，
   不 silent-cut；
4. **验证点稳固**：子进程语义 hermetic 单测（stub 传输层，串/并/循环全覆盖）+平台分支
   F0 探针法+沙箱负向五类+真实运行时冒烟（额度批准）；
5. **北极星用户故事**：「贴一句需求→生成脚本→填参数运行→画布逐阶段点亮→弹确认卡
   采纳→交付物按 outputSchema 落库、看板可查」——P4 后端到端成立。

## 16. 风险

| 风险 | 处理 |
|---|---|
| 子进程网络/文件访问（完整 Python） | 生产=namespace/容器收口（部署要求登记）；dev=operator-only+内部部署前提（§8 威胁模型） |
| RPC 协议成为第二套契约 | 协议最小化（行 JSON+五原语+done/need_input），事件契约完全复用 DAG 形状 |
| askUser 长挂 | Future 挂起无线程占用；deadline 兜底；看板 waiting lane 已有 |
| LLM 生成脚本质量不稳（P4） | 契约静态校验+自动重生成≤2+人工编辑兜底；产物永远走版本链可回滚 |
| 双形态并存心智成本 | 新建默认推荐脚本形态；DAG 既有资产原样可跑可看 |
| 挂起不持久（进程重启丢 waiting run） | 原型期登记已知边界；生产化另立项 |
