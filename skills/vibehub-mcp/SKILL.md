---
name: vibehub-mcp
description: 用 VibeHub MCP 读写团队的缺陷（bug_ 开头）、任务（tsk_ 开头）和团队技能，并按规范流转状态。凡是要看、修、验证、验收 VibeHub 里的缺陷或任务，要用或上传团队技能，或者用户提到 vibehub、看板、缺陷、任务、修好了、验证过了、关单、验收、技能时使用。核心规矩：谁经手谁流转，做完当场改状态，不等人提醒。
---

# VibeHub：缺陷与任务的状态流转

**看板上的状态就是团队看到的事实。** 修好了没改 resolved，别人看到的就是「还没修」；验证过了没关单，它就永远挂在待验证。所以：

> **动手就改状态，做完当场流转，不等人提醒。每轮回复前自查一遍。**

## 1. 开工

1. `get_project_context(project_slug="白泽团队")`：看 `reminders`（该流转却还没流转的存量，照做）、`open_bugs`、`awaiting_verification`（待验证或待关闭）、`doing_tasks`、`review_tasks`（待验收）、`todo_tasks`，以及 `skills`（本项目和全团队通用的技能，只有名称和描述）。
2. 系统里只有一个项目时可以不传 `project_slug`；有多个项目时必须传，不要猜。
3. 看细节：`get_bug_detail` / `get_task_detail`（都会给出 `allowed_next_statuses` 和 `next_step`）、`list_tasks`、`search`。附件用 `read_attachment_text` / `inspect_image_asset`。

## 2. 缺陷：open → in_progress → resolved → verified → closed

不能跳级，一次只走一步，需要时连续调用。每次 `update_bug_status` 都会返回 `next_step`，照着做。

| 什么时候 | 谁来 | 怎么调 |
|---|---|---|
| 开始定位或修复 | 修的人 | `status=in_progress`（**开工第一件事**） |
| 修完、自测通过 | 修的人 | `status=resolved`，`resolution_notes` 写**根因、改了什么、怎么自测的**；有提交就带 `commit_hash`，没提交就写明改动在哪个分支、哪些文件 |
| 按复现步骤验证，不再复现 | 验证方：幕僚、报告人或验收方 | `status=verified`，`resolution_notes` 写在哪个环境、怎么验的 |
| 验证通过，并且修复已在最终环境生效或不需要发布 | 验证方或幕僚 | `status=closed`。验证时就在最终环境的，verified 之后紧接着 closed |
| 在测试环境验证通过，但生产还没发 | 验证方 | 停在 `verified`；发布后由运维或幕僚改 `closed` |
| 验证没通过 | 验证方 | `status=open`，**必须**填 `reopen_reason`（写清楚现象） |
| 重复、不修、无法复现 | 幕僚或经手人 | `in_progress` → `resolved`（`resolution_notes` 写「重复：bug_xxx」「不修复：原因」或「无法复现：试过的步骤」）→ `closed` |

**自测不算验证。** 修的人停在 resolved。用户明确说「验证过了」「没问题了」「可以关了」时，由当前 AI 代为流转 verified，符合条件的再改 closed。

## 3. 任务：todo → doing → review → done（外加 cancelled）

不能跳级，一次只走一步。每次 `update_task` 都会返回 `allowed_next_statuses` 和 `next_step`，照着做。

| 什么时候 | 谁来 | 怎么调 |
|---|---|---|
| 开始做 | 做的人 | `update_task(status=doing)` |
| 做完，自测通过 | 做的人 | `update_task(status=review)`（待验证，等人验收） |
| 验收通过 | 验收方；用户说「验收过了」「没问题」时由当前 AI 代为流转 | `update_task(status=done)` |
| 验收没通过 / 已完成的要返工 | 验收方 | `update_task(status=doing)`，**必须**填 `reopen_reason`（写清楚哪里不行） |
| 做到一半被卡住 | 做的人 | 保持 `doing`，在回复里说明卡在哪、等谁 |
| 不做了 | 经手人（先和用户确认） | `update_task(status=cancelled)`；以后要重做改回 `todo` |
| 做的过程中拆出新的待办 | 做的人 | `create_task`（马上要做的可以直接建成 `doing`，可带 `labels`） |
| 验收类任务 | 验收方 | 验收做完就走到 `review` → `done`；没过的项用 `create_bug` 建缺陷 |

**自己做的不算验收。** 做的人停在 `review`。

`update_task` 的 `description` 是整段替换，而 `list_tasks` 返回的描述会截断；要改描述先 `get_task_detail(full=true)` 取全文。`labels` 也是整组替换。

## 4. 每轮回复前自查

1. 本轮碰过哪些 `bug_` / `tsk_`？每个的状态和实际情况一致吗？
2. 开始修的缺陷改 `in_progress` 了吗？修完的改 `resolved`、写了 `resolution_notes` 吗？
3. 开始做的任务改 `doing` 了吗？做完的改 `review` 了吗？用户说验收过了的改 `done` 了吗？
4. 用户说验证过了的，改 `verified` / `closed` 了吗？
5. 在回复末尾列出流转记录，例如：

```
VibeHub：bug_ab12 in_progress → resolved（commit 1a2b3c）；tsk_cd34 doing → review
```

用户的请求哪怕没提 VibeHub，只要做的事对应看板上的某个缺陷或任务，也照样流转。

## 5. 团队技能

团队把可复用的做法沉淀成技能（Claude Code skill：SKILL.md + 附带文件），挂在某个项目下或设为全团队通用。

| 什么时候 | 怎么调 |
|---|---|
| 开工时想知道团队有哪些约定 | `get_project_context` 的 `skills`，或 `list_skills`（只有名称和描述） |
| 某个技能和手头的事相关 | `download_skill(name=...)`，按原目录结构写到返回的 `install_dir`（`.claude/skills/<name>/`）后照着用 |
| 下载结果 `complete=false` | 标了 `pending` 的文件带 `path` 再调 `download_skill`；单个大文件按 `next_offset` 分段取 |
| 总结出一套值得复用的做法，用户同意沉淀 | `upload_skill`：`skill_md` 开头的 frontmatter 必须有 `name`（小写字母、数字、连字符）和 `description`；缺省挂当前项目，`scope="global"` 为全团队通用；同一范围同名即覆盖 |
| 技能过时 | 用户确认后 `delete_skill` |

## 6. 权限边界

- **状态流转不算「写 vibehub」。** 角色职责里写的「vibehub 由幕僚统一写」「不写 vibehub」，只管便签（`append_scratchpad`）和新建记录。**自己经手的缺陷和任务，所有角色都自己流转状态。**
- 没经手、也没人让你处理的单子，不要去改。
- 新建缺陷或任务前先 `search` 查重，确认是新问题再建。缺陷要写清复现步骤、期望结果和实际结果。
- 工具返回 scope 或权限错误时，如实报告缺哪个权限，不要绕过。
- `purge_trash` 会永久删除文件，只有用户明确要求清理回收站时才调。
- `delete_bug` / `delete_task` / `delete_note` / `delete_attachment` / `delete_skill` 删除后不可恢复：除非用户明确要求删除，否则先向用户确认。缺陷的不修、重复、无法复现走状态流转（resolved 写原因后 closed），不要删。
- MCP 密钥、密码、token 不要写进任何记录、代码或日志。

## 7. 常见报错

| 报错 | 原因 / 做法 |
|---|---|
| 「不允许从 open 直接改为 resolved」 | 不能跳级：先调一次 `in_progress`，再调 `resolved` |
| 「从 resolved 重开到 open 需要填写重开原因」 | 回流要带 `reopen_reason` |
| 「不能从「待办」直接改为「待验证」」 | 任务也不能跳级：先 `doing`，做完再 `review` |
| 「从「待验证」打回「进行中」需要写明原因」 | 任务打回要带 `reopen_reason` |
| 「SKILL.md 需要以 --- 包起来的 frontmatter 开头」 | 上传技能时 `skill_md` 开头要有 `name` 和 `description` |
| 「未指定 project_slug，且有多个进行中的项目」 | 按报错里列出的 slug 选当前仓库对应的项目 |
| 提交号参数不生效 | 参数名是 `commit_hash`，不是 `git_commit_hash` |
| 上传附件失败 | `upload_attachment` 不收文件路径，要传 `data_base64` + `file_name` + `file_type` |
| 便签在项目下查不到 | `append_scratchpad` 没传 `project_slug`，落成了全局便签 |

## 8. 工具与权限（26 个）

| 工具 | 用途 | scope |
|---|---|---|
| `get_project_context` | 项目状态简报、流转提醒、技能清单 | context:read |
| `list_bugs` / `get_bug_detail` | 缺陷列表 / 详情（含可走的下一步） | context:read |
| `search` / `list_notes` | 全局搜索 / 便签 | context:read |
| `list_skills` / `download_skill` | 查看技能 / 下载技能全文 | context:read |
| `read_attachment_text` / `inspect_image_asset` | 读文本附件 / 看图 | attachment:read |
| `update_bug_status` | 缺陷状态流转 | bug:write |
| `create_bug` / `add_bug_comment` / `delete_bug` | 建缺陷 / 记修复过程 / 删缺陷 | bug:write |
| `list_tasks` / `get_task_detail` | 任务列表 / 详情（含可走的下一步） | task:read |
| `create_task` / `update_task` / `delete_task` | 建任务 / 任务流转与修改 / 删任务 | task:write |
| `append_scratchpad` / `update_note` / `delete_note` | 写 / 改 / 删便签 | note:write |
| `upload_attachment` / `delete_attachment` | 上传 / 删除附件 | attachment:write |
| `upload_skill` / `delete_skill` | 上传 / 删除技能 | skill:write |
| `purge_trash` | 清回收站（永久删除） | admin |

持有 `admin` scope 的密钥可以调所有工具。
