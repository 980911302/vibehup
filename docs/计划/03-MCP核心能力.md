# 步骤 03 · MCP 核心能力（产品的另一半身体）

> 目标：把 MCP 从「7 个只读工具」升级为完整操作面，闭合「人机同步闭环」。本步骤原始签约 **14 个**（R8 校正为 15），此后逐轮扩充，**现行 27 个**（读取 11 + 写入 16）——现行清单以本文 §3.2.1 与 `server/src/mcp/server.ts` 的 `TOOL_NAMES` 为准。AI 能读全部上下文、能写全部状态、能上传自己的日志截图、每一次写入都打点审计。核心设计是 **Token 经济学**：让 AI 用最少的 token 办最完整的事。

## 3.1 涉及文件

### 新建

| 文件 | 职责 |
| --- | --- |
| `server/src/mcp/context.ts` | McpContext 类型：解析 stdin 环境中的 API Key → 密钥实体 + scope 集合 + 调用方身份 |
| `server/src/mcp/scopes.ts` | scope 常量和 `hasScope(ctx, scope)` 守卫 |
| `server/src/mcp/tools-extended.ts` | 新增 8 个工具的实现（list_notes/search/create_bug/add_bug_comment/upload_attachment/list_tasks/update_task/purge_trash） |
| `server/src/services/usage.ts` | recordToolCall(ctx, tool, latencyMs, bytesOut, result) → UsageEvent + ApiKey.lastUsedAt |
| `server/src/mcp/token-budget.ts` | 统一输出整形：列表截断、长文本截断并附提示、大小统计 |

### 修改

| 文件 | 改动 |
| --- | --- |
| `server/src/mcp/tools.ts` | 7 个既有工具全部接入 ctx：scope 校验 + 用量打点 + 输出整形 |
| `server/src/mcp/server.ts` | registerTool 数量 7→15（原文写 14，R8 校正；现行 27）；工具描述重写（描述是给 AI 的 prompt，必须写清使用时机） |
| `server/src/mcp-entry.ts` | 启动时从 `VIBEHUB_API_KEY` 环境变量构建 ctx（无密钥 = 本地信任模式全权限） |
| `server/src/services/bugs.ts` | 暴露 createBugFull（含指派/标签/模板）、addComment、listComments |
| `server/src/services/attachments.ts` | uploadFromBuffer(actorCtx, projectId, buffer, fileName, mime) 供 MCP 上传 |

## 3.2 工具矩阵（14 个，原始签约；现行 27 个见 §3.2.1）

| # | 工具 | Scope | 读/写 | Token 策略 |
| --- | --- | :-: | :-: | --- |
| 1 | `get_project_context` | context:read | 读 | 默认 20 缺陷/20 任务/5 便签，附 `summary` 数字先行 |
| 2 | `list_bugs` | context:read | 读 | 默认 20 条 + has_more；字段仅 id/title/severity/status/assignee/labels/updated_at |
| 3 | `get_bug_detail` | context:read | 读 | 长字段（actual_result 等）>500 字符截断并附 `truncated:true` + 提示用 read_attachment_text |
| 4 | `list_notes` | context:read | 读 | 默认 10 条；content >300 字符截断 |
| 5 | `search` | context:read | 读 | 五类实体各 5 条；结果只回必要字段 |
| 6 | `read_attachment_text` | attachment:read | 读 | 默认 200 行 + has_more；grep 模式先行号 |
| 7 | `inspect_image_asset` | attachment:read | 读 | 默认降采样 1080；base64 需显式声明；>4MB 拒绝并建议降 dimension |
| 8 | `update_bug_status` | bug:write | 写 | 回填后只回变更字段，不回全量 |
| 9 | `add_bug_comment` | bug:write | 写 | AI 修复过程记录/追问（如「已定位到 NPE，需确认期望行为」） |
| 10 | `create_bug` | bug:write | 写 | AI 发现的问题自己建单；支持 attachment_ids 关联已上传产物 |
| 11 | `upload_attachment` | attachment:write | 写 | **AI 把日志/截图贴回工单**：base64 入，落盘+元数据，回 id/url |
| 12 | `append_scratchpad` | note:write | 写 | 既有 |
| 13 | `list_tasks` / `update_task` | task:read / task:write | 读写 | 列表默认 20；更新回变更字段 |
| 14 | `purge_trash` | admin | 写 | 清理超期回收区（管理员 scope，防误触） |

> 说明：13 号含两个工具函数名，合计 14 个可调用工具。

### 3.2.1 后续扩充（现行 27 个：读取 11 + 写入 16）

> 现行清单以 `server/src/mcp/server.ts` 的 `TOOL_NAMES` 为唯一出处，每个工具所需 scope 以 `server/src/mcp/tool-scopes.ts` 的 `TOOL_SCOPES` 为唯一出处。

| 轮次 | 新增工具 | Scope | 说明 |
| --- | --- | :-: | --- |
| R8 | （无新增）上表实为 15 个：13 号含两个工具名，原文「合计 14」算术有误 | — | 见 PROGRESS §4 |
| R79 | `create_task`（16 个） | task:write | AI 建任务；同时上线状态流转协议（`workflow.ts`） |
| R80 | `get_task_detail` | task:read | 描述默认 500 字符截断，`full: true` 取全文；带 `allowed_next_statuses` / `next_step` |
| R80 | `delete_task` / `delete_bug` / `delete_note` / `delete_attachment` | 各自的写权限 | 用户决定：删除跟着对应写权限走，不单设删除权限；工具描述要求 AI 删除前先确认 |
| R80 | `update_note` | note:write | 改内容 / 标签 / 置顶 |
| R80 | `list_skills` / `download_skill` | context:read | 查看技能（名称+描述）/ 下载全文；下载按 40K 字符分批，`pending` 文件带 `path` 再取，大文件按 `next_offset` 分段 |
| R80 | `upload_skill` / `delete_skill` | skill:write（新 scope） | 同一范围（项目 / 通用）同名即覆盖 |
| R84 | `create_upload_url` | attachment:write | 试用反馈：本地文件签名直传——返回 curl 命令，AI 在终端执行，文件内容不经过对话；10 分钟有效、只能用一次 |
| R84 | （改）`upload_attachment` / `inspect_image_asset` | — | 上传新增 `content` 文本直传（与 `data_base64` 二选一，`file_type` 可推断，`bug_id` 定项目）；看图默认返回 MCP 图片内容块，模型直接看到截图 |

**任务流转（R80，R83 加验证中）**：`todo → doing → review → verifying → done`，不能跳级；`review/verifying/done → doing` 为打回，必须带 `reopen_reason`；`doing → todo`、`verifying → review` 为放回；未完成的可 `cancelled`，取消后只能回 `todo`。

**缺陷流转（R83）**：`open → in_progress → resolved → verifying → verified`，`verified` 是修复完成的终点；`closed` 只用于重复/不修/无法复现，必须带 `resolution_notes`，可从 `open/in_progress/resolved` 直接关；`verifying → resolved` 为放回。每次流转记录操作人（MCP 为密钥名）与时间；`get_project_context` 增加 `verifying_bugs` / `verifying_tasks`（带 `status_actor`、`status_changed_at`）与 `stale_items`（验证中 >2 小时、进行中 >24 小时），`awaiting_verification` 只含 `resolved`。规则唯一出处为 `server/src/services/tasks.ts` 的 `TASK_TRANSITIONS`，MCP 侧提示在 `workflow.ts`，技能说明在 `skills/vibehub-mcp/SKILL.md` §3。`get_project_context` 增加 `review_tasks` 与 `skills`（名称+描述）。

## 3.3 Token 经济学（`token-budget.ts` 契约）

```ts
export interface Budget { listLimit: number; textFieldMax: number; noteMax: number }

// 统一整形规则（所有工具输出必经）：
// 1. 列表类：slice(0, limit) + has_more + next_cursor
// 2. 字符串字段：>上限 → 截断 + `...（已截断，完整内容共 N 字符）`
// 3. 统计行固定在最前：{ total, returned, has_more }
// 4. 输出整体 JSON.stringify 后 > 64KB → 强制再截断列表半数并附 warning 字段
```

**写进每个工具的 description（给 AI 的 prompt 工程）**：

```
「返回已按 Token 经济学校形：默认最多 20 条，has_more 为 true 时用 page 继续；
长文本自动截断到 500 字符，需要完整内容时用 read_attachment_text 分片读取。」
```

## 3.4 Scope 鉴权与上下文

```ts
// mcp/context.ts
export interface McpContext {
  mode: 'local' | 'keyed';       // local=stdio 无密钥（单机信任）；keyed=携带 vhk_ 密钥
  apiKeyId: string | null;
  scopes: Set<string>;           // local 模式 = 全部 scope
  actorLabel: string;            // 审计用：'owner@local' 或 'cursor-main(vhk_live_7Kd9)'
}

export async function resolveMcpContext(env = process.env): Promise<McpContext>
// 从 env.VIBEHUB_API_KEY 读密钥：哈希查库 → 校验未撤销/未过期 → 解析 scopes
// 查不到/过期 → 直接退出进程并 stderr 说明（MCP 启动即失败，绝不静默降权）
```

每个工具的 handler 包装：

```ts
function guard(scope: Scope, fn: (ctx: McpContext, args: T) => Promise<R>) {
  return async (args: T) => {
    const ctx = await resolveMcpContext();
    if (!hasScope(ctx, scope)) return err('缺少 scope: ' + scope + '，请在 Web 端「密钥」页调整');
    const t0 = Date.now();
    const result = await fn(ctx, args);
    await recordToolCall(ctx, toolName, Date.now() - t0, sizeOf(result), result.ok);
    return result;
  };
}
```

## 3.5 写入审计（闭环②的账本）

MCP 每次写操作除 UsageEvent 外，同时落地业务痕迹：

- `update_bug_status` / `create_bug` / `add_bug_comment` → 写 `BugComment(authorType='ai', authorId=apiKeyId)`，内容含 diff（`open → resolved`）+ resolution_notes + commit。
- `upload_attachment` → `Attachment.uploadedBy = apiKeyId`（标记 AI 产物），Web 端文件页显示金色「AI」徽章。
- 全部写操作完成后 `eventBus.publish` → 同进程 SSE 即时推；跨进程由 Web 轮询兜底（5s）。

## 3.6 双传输模式（容器化部署的关键，见《容器化部署规范》§7）

| 模式 | 适用 | 连接方式 | 鉴权 |
| --- | --- | --- | --- |
| **stdio**（本地信任） | 同机开发、源码部署 | IDE 拉起子进程 `mcp-entry.ts` | 无密钥=全权限；或 `VIBEHUB_API_KEY` |
| **SSE**（容器部署） | docker 单容器、团队集中节点 | IDE 直连 URL | `Authorization: Bearer vhk_xxx` 握手校验 |

### SSE 端契约

```
GET  /mcp/sse            建立 SSE 流（握手：校验 Bearer 密钥 → scope → 绑定 ctx）
POST /mcp/messages        JSON-RPC 消息（session_id 由 SSE 握手分配）
```

实现要点：

- Fastify 路由挂载 `SSEServerTransport`（`@modelcontextprotocol/sdk/server/sse.js`），每个连接一个 transport 实例 + sessionMap；
- 握手失败：HTTP 401 + 人话 message（「密钥不存在/已撤销/已过期，请在 Web 端密钥页处理」）；
- 与 stdio **共用同一份工具注册与 guard/打点逻辑**（`createMcpServer()` 工厂 + transport 无关）；
- 容器内 URL 形如 `http://<服务器IP>:3210/mcp/sse`。

### IDE 配置（两种模式对照）

```json
// 容器部署（SSE）——团队成员的唯一配置
{ "mcpServers": { "vibehub": {
  "url": "http://10.0.0.8:3210/mcp/sse",
  "headers": { "Authorization": "Bearer vhk_live_xxx" }
} } }

// 同机开发（stdio）
{ "mcpServers": { "vibehub": {
  "command": "npx", "args": ["tsx", "src/mcp-entry.ts"],
  "cwd": "<repo>/server",
  "env": { "DATABASE_URL": "postgresql://...", "VIBEHUB_API_KEY": "vhk_live_xxx" }
} } }
```

密钥创建向导（步骤 07 密钥页）最后一屏根据部署形态二选一生成对应 JSON，一键复制。

### 3.6.1 MCP Events（R87）

ChatGPT Work 通过 Streamable HTTP `/mcp` 连接；旧 `/mcp/sse` 保持兼容 IDE 客户端。事件名来自 `core/events.ts` 的 VibeEvent，筛选条件目前支持 `project_id`；负载仅发送 `project_id`、`entity_id` 与可选 `status`，不推送实体正文。Work 提供的 callback URL 必须是 HTTPS 公网地址，服务端先做 challenge 验证，再以 Standard Webhooks HMAC 签名投递。

订阅保存在 `mcp_event_subscriptions`，签名密钥以 `JWT_SECRET` 派生的 AES-256-GCM 加密。事件投递经 PG LISTEN/NOTIFY，覆盖 Web 服务与独立 stdio MCP 进程的业务写入；过期、撤销或已停用创建人的密钥不再收到事件。服务通过 `server/discover` 声明 MCP Events 版本，提供 `events/list`、`events/subscribe`、`events/unsubscribe`。

Work 的事件方法与 SDK 工具会话分离：事件订阅可直接调用；后台运行的普通工具请求可能省略 `initialize` 或携带服务重启前的会话 ID。HTTP 路由每次重新鉴权后，只复用同密钥 SDK 会话；无可用会话时内部引导新 SDK 会话，并同步改写 `headers`/`rawHeaders`。已知会话与密钥不匹配返回 403，标准 `initialize` 始终建立新会话。

#### 可信内网出站中转（R87 连接修复）

当部署主机到 Work 回调域名的 DNS/TLS 失败时，可通过 `VIBEHUB_MCP_EVENT_RELAY_URL` 与 `VIBEHUB_MCP_EVENT_RELAY_TOKEN` 配置独立出站中转；这不改变 `events/subscribe` 的 challenge 校验流程。独立进程 `dist/mcp-event-relay.js` 使用 Node.js 22，无额外依赖，凭证与监听地址见远端部署文档。中转只允许 `connectors.api.openai.com` HTTPS 443，以 HTTPS DNS 获取真实公网地址并固定 IP，保留证书校验、禁止重定向，签名正文与签名头原样传递。本机需要 Clash 等代理时，可配置 `VIBEHUB_MCP_EVENT_RELAY_PROXY` 指向 loopback HTTP 代理，CONNECT 使用已验证的目标 IP，TLS SNI/证书继续校验原域名。认证令牌只存环境文件；不在日志记录 callback URL、正文或签名头。公网 DNS/HTTPS 连接可用必须在实际中转主机上验证，内网互通不等于 OpenAI 出站可用。

## 3.7 验收标准

- [ ] `tools/list` 返回与 `TOOL_NAMES` 等长的工具数（**现行 27**；原始签约 14 为历史基线）；每个 description 含 Token 经济学说明
- [ ] 无密钥本地模式：全部工具可用，审计 actorLabel=`local`
- [ ] 密钥模式：仅 `context:read` 的密钥调 `update_bug_status` → `isError:true` 且 message 指明缺哪个 scope
- [ ] 过期/已撤销密钥 → MCP 进程启动即失败，stderr 有人话错误
- [ ] `create_bug` 后 DB 有 bug + 对应 BugComment(authorType='ai')
- [ ] `upload_attachment` base64 入 → 文件落盘 + 元数据 uploadedBy=密钥 id
- [ ] `list_bugs` 对 100 条数据默认只回 20 条且 `has_more:true`；`get_bug_detail` 超长字段截断并带提示
- [ ] 每次调用 ApiKey.lastUsedAt 更新、UsageEvent 有记录（tool/latency/bytes_out/result）
- [ ] stdio 模式下 stdout 只有 JSON-RPC（日志全走 stderr）——现有测试断言保留
- [ ] SSE：无/错密钥 → 401 人话错误；合法密钥完成 initialize + tools/list
- [ ] SSE 与 stdio 两模式的工具行为一致（同一测试用例双传输参数化跑）

## 3.8 验证命令

```bash
cd vibehub/server && npx vitest run src/mcp
# 端到端：用测试客户端依次调用全部工具（现行 27 个，含一个超权调用），断言见 3.7
node /tmp/mcp-smoke.mjs   # 步骤 05 提供的脚本
```
