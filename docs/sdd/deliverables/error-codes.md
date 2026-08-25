# 错误码表（SDD D-5 交付物）

统一错误响应形态：`{ "code": "...", "message": "...", "path"?: "...", "detail"?: {...} }`；HTTP 状态与业务状态一致（不再出现 200 包业务失败）。

| code | HTTP | 触发点 | 含义与处置 |
| --- | --- | --- | --- |
| `REVISION_CONFLICT` | 409 | `PUT /api/agents/{aid}`（expectedRevision 不匹配）、`PUT /api/workflows/{wid}/draft` | 乐观锁冲突；前端刷新后重试 |
| `VALIDATION_FAILED` | 409 | `POST /api/agents/{aid}/versions` | 发布校验失败；`issues[]` 明细 |
| `DEPENDENCY_INVALID` | 409 | `POST /api/agents/{aid}/versions` | 依赖冻结失败（缺失/停用资源）；`issues[]` 明细 |
| `NO_RELEASED_VERSION` | 422 | `POST /api/agents/{aid}/run`（trigger=schedule/api 且无发布版本） | 定时/外部触发必须基于已发布版本 |
| `VERSION_NOT_FOUND` | 404 | `POST /api/agents/{aid}/releases` | 版本不存在或不属于该 Agent |
| `BAD_ENVIRONMENT` | 422 | `POST /api/agents/{aid}/releases` | environment 必须是 sandbox/prod |
| `NO_FAILURES` | 422 | `POST /api/agents/{aid}/evolution/candidates` | 近期无失败运行，无需进化 |
| `GENERATE_FAILED` | 502 | 进化候选生成 / AI 生成 Prompt | LLM 调用失败；稍后重试 |
| `NAME_TOO_LONG` | 400 | Agent 创建/更新 | 名称超过 20 字（与前端/数据库约束同源） |
| `RUN_ERROR` | 409 | `POST /api/agents/{aid}/run`（递归检测等） | 运行创建失败 |
| 404 通用 | 404 | 各资源详情 | 资源不存在（任务/规则/质检结果/样本） |

## 与调研的对应

- 调研 09 §3.1 指出 QuickService 两种 envelope 都可能 200 包失败——自研统一为上表形态，HTTP 状态即业务状态。
- 发布必须携带版本语义（版本 id / 草稿 revision），不接受裸版本字符串（调研 13 §8）。
