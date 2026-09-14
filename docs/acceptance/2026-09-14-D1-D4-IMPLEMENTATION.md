# 2026-09-14 D1–D4 拍板项实施交付

- 拍板来源：用户 09-14「按照推荐给我画出页面原型吧」+ 追加「d3 为什么不单独页面去做？字段映射操作量很大的 / d3 最好能增加一些 icon 代表类型 / 其他的同意」。
- 原型：`docs/v2-design/prototypes/audit-rework-d1-d4-v1.html`（v1 提交 ad0791b；D3 v2 独立页+icon 提交 5a088fc）。
- 判定：**READY_FOR_ACCEPTANCE**。`./scripts/gate.sh --live` 全绿（EXIT=0）。

## D1 · 浅色对比度文本角色 token（已实施）
- `src/index.css`：light 与 light-parchment 新增 `--status-success-text:#237A4E` / `--status-warning-text:#8F6410` / `--status-danger-text:#BE4343`；light `--text-tertiary` #838280→**#737270**（3.84→4.81:1）。羊皮纸 tertiary 现值已达标不动；**dark/dark-parchment 的 -text=原值（零变化）**。
- 组件切换：task-board `LANE_CHIP` 字色读 -text（色点继续原站值，新增 dot 字段）；wf-connections 生命周期/健康 tailwind 硬色 → `text-(--status-*-text)` token。
- 门禁：`scripts/audit_contrast.py` 配对改测 -text token（原站值仅作图标/色点/图表，非文本豁免）→ **四主题正文级违规 14→0**。

## D2 · Connections 桌面表格主视图（已实施）
- `wf-connections.tsx`：桌面（≥lg）密集表格主视图，窄屏保留卡片。列：名称（两行+truncate+title 全文）/协议（icon）/鉴权/生命周期/健康（含「·待验证」迁移标记+title）/操作**常显图标按钮**（Pencil/Play/RefreshCw/Trash2 + aria-label+title）。
- 设置壳窄上下文适配：`table-layout:fixed` + 列宽百分比；环境/凭据/最近检查三列 `min-[1600px]` 才显示（窄上下文不截断不竖排）；外层 overflow-x 保险。
- 后端：`GET /api/connections` DTO 增 `lastTestAt`（最近检查列数据源）。
- 协议 icon：Globe/Database/Sparkles/Plug（lucide），列表与数据源页同套。
- 截图实证：`d2-impl-connections-table.png`（操作全可见、归档行只读、无截断竖排）。

## D3 · 数据源独立详情页（已实施，用户拍板抽屉→独立页+icon）
后端（迁移 `g058dsarch0001`：data_source.archived）：
- `GET /api/v2/data-sources/{id}` 单源读取；
- `PATCH /{id}`：名称/config（polling url 格式+**保存时过 egress**）/status 暂停恢复/`archived:false` 解除归档（归档源其余只读）；
- `DELETE /{id}`：**归档语义**不物理删；被未归档路由/legacy trigger/历史事件引用 → 409 `SOURCE_REFERENCED` + references 清单；
- `POST /{id}/regenerate-token`：旧 token 即刻失效、新 token 仅返回一次（测试实证旧 token 401/新 token 200）；
- `GET /api/v2/event-deliveries?sourceId=`：治理页事件流水（event→source 反查）。
前端 `src/pages/data-source-detail.tsx`（路由 `/data-sources/:sid`）：
- 页头：类型 icon 软底方块 + 名称 + kind/status/archived 徽章 + 暂停/测试事件/立即拉取(polling)/删除；
- 左列：**字段映射行编辑器**（键←路径行、添加/删除行、键重复前置拒绝、保存 PATCH）/ 过滤条件编辑器（op 枚举 fail-closed）/ 接收配置（webhook 地址+鉴权+限速；polling url/间隔可编辑）；
- 右列：Token 卡（掩码+重新生成一次性展示对话框+复制+强提醒）/ 事件路由（rev/启停/归档）/ 事件流水（结果 icon：CircleCheck/Copy/Filter/OctagonAlert/CircleX/Clock + failed/dead 重试按钮 + route_outcomes 证据注记）；
- 列表页：类型 icon 徽章 + 「管理」按钮跳详情页（非抽屉）。
测试 `server/tests/test_d3_datasource_governance.py` ×5 全绿。

## D4 · 双「数据源」边界 + 术语表（已实施）
- `ui-terms.ts`：`IA_BOUNDARY`（两页说明条文案+互跳链接）+ `GLOSSARY` 八条（中文主名/英文/适用域/边界，含「数据资产禁止再译作数据源」「自动任务≠分析任务」已拍板分词）——文案单一事实源。
- 数据接入页与资源页数据资产 tab 顶部说明条（brand-soft 底+跳转链接）。截图 `d4-impl-*.png`。

## 门禁证据（可复现）
```
./scripts/gate.sh --live   → ALL GATES GREEN (含活体)，EXIT=0
  pytest 578 / vitest 76(14文件) / tsc -b+build ✓ / eslint --max-warnings=0 ✓
  层1 0/0/0 / 层2 P0=0 P1=0 / 层3 P0=0 P1=3(历史行) / 层4 162控件0无效果 / 返工实证 V1-V4 ✓
python3 scripts/audit_contrast.py → 四主题正文级违规 0
```

## 交签截图（docs/acceptance/assets/2026-09-14-d1-d4-impl/）
1. `d1-impl-taskboard-chips.png` — 新字色徽章（light）
2. `d2-impl-connections-table.png` — 表格主视图+常显图标操作
3. `d3-impl-detail-light.png` / `d3-impl-detail-dark.png` — 数据源详情页双主题
4. `d4-impl-datasources-list.png` / `d4-impl-assets-banner.png` — 边界说明条
5. 原型对照：`../2026-09-14-d1-d4-prototypes/`（v2 独立页原型）

## 遗留登记（不静默）
- Docker 真实构建验证（本机无 Docker）；独立 Worker 进程入口；beui CodeBlock 换 PrismLight（vendor-markdown 瘦身）；check-no-prod-mock 扫描器假阳性校准；Reader registry 与 type 声明对齐（建议冻结能力口径）；外部真库端到端验收（报告 §9）；EventBridge/CloudEvents P0.5 待用户 D1–D7。
- 演示数据源（工单系统 Webhook（演示）/告警平台轮询（演示））截图后已物理清理（marker 删除，DELETE 2）。
