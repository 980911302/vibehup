---
name: vibehub-mcp
description: 用 VibeHub 精简版 9 个 MCP 工具读写团队缺陷（bug_ 开头）、任务（tsk_ 开头）、附件、随手记与团队技能，并严格按状态机流转。凡是要看、修、验证、验收 VibeHub 里的缺陷或任务，或使用团队技能时加载。核心规矩：谁经手谁流转，做完当场改状态，不等人提醒。
---

# VibeHub：9 工具高内聚协同与状态流转规范

**看板上的状态就是团队看到的事实。** 动手就改状态，做完当场流转，每轮回复前自查一遍。

## 1. 开工冷启动（1 次调用到位）

1. 调 `get_project_context(project_slug="...")`：
   - **身份与成员**：`me`（你代表谁、持有哪些 scope）+ `members`（团队 active 成员，`writable=true` 的可接手工作项，只读成员不可作为负责人）。
   - **项目记忆与技能**：`memory`（项目一句话 + 置顶决策笔记）+ `skills`（本项目与通用技能的名称和描述）。
   - **在办与待办**：`reminders`（优先照做）、`open_bugs`、`awaiting_verification`（待验证缺陷）、`verifying_bugs` / `verifying_tasks`（验证中：谁在验、验了多久）、`stale_items`（停留过久项）、`doing_tasks`、`review_tasks`、`todo_tasks`。
2. 只有一个活跃项目时可省略 `project_slug`；多项目时**必须传**当前代码仓库对应的 `project_slug`。
3. 查重、筛选列表或看详情：
   - `search(q="关键词", project_slug="...")`：关键词/拼音/语义查重（建卡前必查）；不传 `q` 则按 `type`（`bug`/`task`/`note`）、`status`、`label` 分页列出项目内条目。
   - `get_work_item(id="bug_xxx" | "tsk_xxx", full=false)`：读取完整描述、附件清单、交付证据与 `allowed_next_statuses` / `next_step`（需要改长描述前传 `full=true` 取全文）。
   - `read_attachment(attachment_id="att_xxx")`：自动按 MIME 识别——图片直接返回降采样视觉图片块，日志/文本支持 `offset_line`、`limit_lines` 与 `grep_keyword`。

## 2. 缺陷流转：`open → in_progress → resolved → verifying → verified`

统一调 `update_work_item(id="bug_xxx", ...)`，**严禁跳级**，`verified` 是修复完成的终点：

| 什么时候 | 谁来 | 怎么调 `update_work_item` |
|---|---|---|
| 开始定位或修复 | 修的人 | `status="in_progress"`（可附 `comment` 记录初步判断） |
| 修完且自测通过 | 修的人 | `status="resolved"`，`resolution_notes` 写根因、改动、自测方式，传 `commit_hash` 与 `evidence`（commit / pr_url / tests / screenshots；非代码交付写 `no_code_reason`） |
| 开始验证 | 验证方 | `status="verifying"`（先改再动手，让团队看到有人在验；**修复者自测不算验证**） |
| 验证通过 | 验证方 | `status="verified"`，`resolution_notes` 写验证环境与步骤 |
| 验证不通过 / 问题复发 | 验证方 / 发现人 | `status="in_progress"`（或 `"open"`），**必填** `reopen_reason` |
| 验不了交给别人 | 验证方 | `status="resolved"`（退回待验证），或传 `assignee_id` + `handoff_reason` 转交 |
| 重复 / 不修 / 无法复现 | 经手人 | `status="closed"`，**必须**在 `resolution_notes` 写明原因（`closed` 只用于不修复的结局，不要删单） |

## 3. 任务流转：`todo → doing → review → verifying → done`（另可 `cancelled`）

同样统一调 `update_work_item(id="tsk_xxx", ...)`，**严禁跳级**：

| 什么时候 | 怎么调 `update_work_item` |
|---|---|
| 开始做 | `status="doing"` |
| 做完且自测通过 | `status="review"`，尽量带 `evidence`（自己做的不算验收） |
| 开始验收 | `status="verifying"` |
| 验收通过 | `status="done"`（用户明确说「验收过了」时可代为先 `verifying` 再 `done`） |
| 验收不通过 / 返工 | `status="doing"`，**必填** `reopen_reason` |
| 验不了放回 | `status="review"` |
| 取消不做 / 重新启用 | `status="cancelled"` / 从 `cancelled` 改回 `status="todo"` |
| 拆出新缺陷或新任务 | 先 `search(q=...)` 查重，再 `create_work_item(type="bug" \| "task", ...)` |

## 4. 附件、随手记与技能

- **传附件（`upload_attachment` 二合一）**：
  - 短文本（堆栈、JSON、日志片段）：直接传 `content="原文"`，立即落盘返回 `attachment.id`（**禁止**手写 base64）。
  - 本地文件（截图、压缩包、大日志）：**不传** `content` 和 `data_base64`，直接返回一次性 `curl -sS -T '<本地路径>' '<upload_url>'` 命令，在终端执行即可直传，文件内容不经过对话。传 `work_item_id` 可直接挂到对应缺陷或任务。
- **写随手记（`append_note`）**：暂存排查草稿或架构备忘（单项目自动归属该项目，多项目必传 `project_slug`）。
- **用团队技能（`get_skill`）**：看到 `get_project_context.skills` 中有相关技能时，调 `get_skill(name="...")` 取回全文并写到 `.claude/skills/<name>/`（`complete=false` 时对 `pending` 文件带 `path` / `offset` 续取）。
- **边界**：删除工单/附件/技能与清理回收站仅限人类在 Web 端操作；MCP 密钥、密码、token 严禁写入任何记录或代码。

## 5. 9 个核心工具速查表

| 工具名 | 用途 | 外层 scope（内部按实体细化） |
|---|---|---|
| `get_project_context` | 一次拿到 `me`、`members`、`memory`、在办/待验收工单、`reminders`、`skills` | `context:read` |
| `search` | 传 `q` 关键词/语义检索；不传 `q` 按 `type`/`status`/`label` 分页列条目 | `context:read` / `task:read` |
| `get_work_item` | 读取 `bug_` 或 `tsk_` 完整详情、附件与 `allowed_next_statuses`（支持 `full=true`） | `context:read` / `task:read` |
| `create_work_item` | 新建缺陷（`type="bug"`）或任务（`type="task"`） | `bug:write` / `task:write` |
| `update_work_item` | 状态流转、填 `evidence`、写 `comment`、转交 `assignee_id`、改字段四合一 | `bug:write` / `task:write` |
| `read_attachment` | 图片自动回传降采样视觉块；文本支持行号分片与 `grep_keyword` | `attachment:read` |
| `upload_attachment` | 传 `content` 直存文本；留空返回一次性 `curl -T` 本地文件直传命令 | `attachment:write` |
| `append_note` | 追加项目随手记（Markdown + 标签） | `note:write` |
| `get_skill` | 按名称或 ID 分批拉取技能 `SKILL.md` 及附带脚本 | `context:read` |

每轮回复末尾请列出本轮流转记录，例如：`VibeHub：bug_ab12 in_progress → resolved（commit 1a2b3c）；tsk_cd34 doing → review`。
