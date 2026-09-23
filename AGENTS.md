# AGENTS.md — VibeHub 工程契约

> 本文件是 VibeHub 工程的**契约层**：所有参与施工的 Agent（定时构建、人工会话）在动手前必须加载本文件。
> 契约优先级：本文件 > 步骤计划文档 > 规范文档细则。契约与现实冲突时修订本文件，并在 `docs/计划/PROGRESS.md` §4 登记。

---

## 0. 项目一句话

人类在 Web 端粘贴截图即录缺陷；AI 通过 MCP 直读上下文并回填修复状态。团队单机版，Docker 单容器部署（PostgreSQL + pgvector 内置）。

> **当前阶段（R77 起）：试用冻结期**——新功能一律冻结，只做试用反馈 / 验证 / 加固；新增用户可见功能、入口或配置项即算新功能，不得施工。卡片 39（全局截图入口）与卡片 51（看板表格视图）已按 R78 决定**彻底移除**，不再重开、不再列入任何看板。详见 `docs/计划/09-真实试用与范围冻结.md`。

## 1. 权威文档索引（施工前必读）

| 文档 | 作用 |
| --- | --- |
| `docs/计划/PROGRESS.md` | **进度驾驶舱**：看板/日志/偏差/下一轮起点指令。每轮开始读、结束更新 |
| `docs/计划/00~08` | 九份步骤计划：数据模型→认证→MCP→缺陷域→测试→前端壳→页面→验收 |
| `docs/计划/09` | **当前阶段**：真实试用与范围冻结（R77 起）——冻结范围、试用方式、达标标准、解冻规则 |
| `docs/规范/00` | UI 主题风格规范（token / 动效 / 组件到帧规格） |
| `docs/规范/01` `02` | 前端 / 后端工程规范 |
| `docs/规范/03` | 容器化部署规范（单容器 pgvector） |
| `docs/商业产品计划.md` | 商业背景（不直接指导施工） |

## 2. 架构契约

- 后端分层严格单向：`routes → services → core`；routes 禁止直连 Prisma；services 禁止 import Fastify 对象。
- MCP 与 routes **平级**共用 services；MCP stdout 只走 JSON-RPC，日志一律 stderr。
- 前端数据唯一入口 `lib/api.ts`；页面只消费 `hooks/use-vibehub.ts`；跨页状态用 Provider，URL 状态用 searchParams。
- 事件：业务写成功后 `eventBus.publish`，负载扁平 `{type, projectId, entityId}`；**实时推送契约（R52 更新）**：publish 同时发 PG `pg_notify`（通道 `vibehub_events`，异步且失败隔离）——SSE 端点用独立 pg Client `LISTEN` 单通道推送，MCP stdio 等跨进程写入 <1s 可达（不再依赖轮询兜底）；失败隔离（NOTIFY/LISTEN 断只丢加速不炸进程，pg Client 必须挂 error 监听器）；前端 5s 轮询保留为双保险。
- **AI 活动流契约（R60）**：`GET /api/activity/recent` 全员可读（刻意不挂 requireRole——让非管理员感知「AI 读了什么」是特性目的）；数据经 service 层 select 脱敏（仅 key_name/key_prefix/工具名/耗时，禁 keyHash/salt/明文）；管理员完整用量仍在密钥页 keyUsage。
- **计量契约**：所有 UsageEvent / 审计写入必须 `await`（logEvent 内部已 try-catch 不抛）；禁 `void logEvent(...)` 即发即弃——会导致紧随的用量查询漏账（R11 竞态教训）。
- **SSE 鉴权契约**：浏览器 `EventSource` 不支持自定义头，`/api/events` 免全局守卫，路由内校验 `?token=<access_token>`；无/错 token 401。
- **附件原文件访问契约（R76）**：`<img>`/新标签页同样带不了 Authorization 头——`/api/attachments/:id/raw` 免全局守卫，路由内「签名链接（`exp`+`sig`，HMAC 以 `asset:` 前缀与 JWT 共用密钥）或 Bearer」二选一；`public_url` 一律由 `serializeAttachment` 按**记录 ID** 签发（12h 分桶，轮询不闪烁），前端禁止自拼未签名 raw 地址；建附件时记录 ID = 落盘 ID（`createAttachment({ id })`，历史上二者不一致致 public_url 404），存量错误 publicUrl 由序列化层纠正。下发必带 `X-Content-Type-Options: nosniff` + `CSP: default-src 'none'; sandbox`，仅图片白名单与 text/plain 可 inline，html/svg 等强制 `attachment`——上传方 MIME 不可信，防止在应用同源执行脚本读走 localStorage 令牌。
- **静态导出契约（output: 'export'）**：① 页面禁止用 `next/navigation` 的 `redirect()/notFound()`——预渲染期抛错会产出 `__next_error__` 页；根路径跳转用客户端 `window.location.replace` + `<meta refresh>`；② Fastify 托管 out/ 必须 `extensions: ['html']`，否则 `/login`、`/board` 这类干净 URL 回退 index.html 造成重定向死循环。

## 3. API 契约

- REST + snake_case JSON；响应必须经 `core/serialize.ts` 序列化，**禁止裸出 Prisma 模型**（曾致前端崩溃）。
- 错误体统一：`{ "error": { "code", "message" } }`，message 必须是人话并指出下一步。
- 错误码枚举（不得随意新增）：`VALIDATION_ERROR / NOT_FOUND / UNAUTHORIZED / FORBIDDEN / EMAIL_TAKEN / INVALID_CREDENTIALS / ACCOUNT_DISABLED / TOKEN_REUSED / LAST_OWNER / INVALID_TRANSITION / PAYLOAD_TOO_LARGE / INTERNAL_ERROR`。新增须经本文件登记。
- 写操作返回更新后实体；分页 `{items,total,page,page_size}`；MCP 分页 `has_more + next_cursor`。
- **认证响应结构契约**：`/auth/me` 返回 `{ user, stats }` 嵌套（扁平 user 字段 + stats 是反模式，曾致前端恢复登录态把 undefined 当 user）；`/auth/login|register` 返回 `{ user, access_token, refresh_token, expires_in }`。
- **刷新令牌契约（R76）**：一次性轮换 + 重放整族吊销不变；但同一旧令牌在 10s 宽限期内重复提交且令牌族仍存活 = 并发竞态，照常签发不吊销（多请求/多标签同时刷新曾致用户每 15 分钟随机掉线）；登出吊销**整个令牌族**（否则宽限期内并发签出的同族令牌可让已登出会话复活）。
- 状态码：200/201/204/400/401/403/404/409/413/429。
- **multipart 上传顺序无关契约（R53）**：`/api/upload` 的文件 part 与 project_id 等字段到达顺序客户端不保证，路由必须两段式（遍历落盘收集 → 字段齐后建记录），禁止「文件先到就抛缺少字段」（容器 curl 实测抓到，已有回归用例）。

## 4. 数据契约（PostgreSQL + pgvector）

- 单机单团队：**不建 organizations 表**，角色挂在 User（owner/admin/member/viewer）。
- 多态关联用 `entity_type + entity_id`，不建外键（附件表既有约定）。
- `notes.tags` 为原生 `String[]`；数组/JSON 字段的解码函数集中在 service 层。
- 向量能力：`Embedding` 表 + raw SQL 向量列 + HNSW 索引；`EMBEDDING_PROVIDER=none` 默认关闭，降级纯关键词。**Embedding provider 契约（R49 登记）**：枚举 `none | dashscope`（OpenAI 兼容模式，`EMBEDDING_BASE_URL` 指向 `.../compatible-mode/v1`）；列宽由卡片 28 迁移改为 `vector(1024)`（text-embedding-v3），后续维度以 `EMBEDDING_DIM` 为准且必须与列宽一致；`EMBEDDING_API_KEY` 只进 `.env`/部署环境变量，禁写入任何文档与代码默认值；请求可选带 `dimensions` 参数（`EMBEDDING_SEND_DIM`）与 base64 文本（`EMBEDDING_USE_BASE64`，响应为 float32 小端 base64）。**raw SQL 物理列名陷阱**：`embeddings` 表混合命名——`entityType/entityId/model/dim/embedding` 为 camelCase 物理名，`created_at/updated_at` 为 snake_case（唯二带 @map 的列），写裸 SQL 前先 `\d 表名` 核对。
- **embedding 写路径契约（R51）**：bug/note 的 create/update 成功后 `await upsertEntityEmbedding`（与 UsageEvent 同属「必须 await」族，防漏写竞态），但内部 try-catch 隔离——外部 API 失败只丢语义索引、禁断业务主流程；delete 时 `deleteEntityEmbedding` 同步清理防幽灵命中。测试与 acceptance 门禁环境强制 `EMBEDDING_PROVIDER=none`（hermetic 禁打外网）；客户端单测用 vi.mock 覆盖 `config.embedding` 开启态。**语义相似阈值（R57）**：`similarEntities` 默认过滤 cosine 距离 ≥0.5 的低相关命中——无阈值时任何查询都会返回近邻，垃圾查询也出「语义命中」分组（卡片 34 实测抓到）。
- 迁移只准 `prisma migrate` 生成，禁手写 SQL 迁移（raw SQL 仅限 vector 列并注释原因）。
- **连接契约（双库分离，R64）**：测试库 = 容器 `vibehub-test-db`（`postgresql://postgres:test@127.0.0.1:55432/postgres`，pg16，**破坏性**——vitest 每用例 resetDb TRUNCATE 全表，只供测试/acceptance.sh）；验收/开发库 = 容器 `vibehub-dev-db`（`postgresql://vibehub:vibehub@127.0.0.1:55433/vibehub`，pg16，**持久**——命名卷 `vibehub-dev-pg`，用户验收数据、常驻服务默认连此库；`bash server/scripts/dev-db.sh` 起/复用）；`server/.env` 的 DATABASE_URL 指向验收库；`TEST_DATABASE_URL` 环境变量指向测试库（test-setup.ts 读取）。两库同镜像同迁移， schema 幂等。
- **.env 加载契约（R57）**：非 Docker 环境下 `server/.env` 是全部配置（DATABASE_URL/JWT_SECRET/EMBEDDING_*/REGISTRATION_OPEN）的**唯一来源**——`config.ts` 的 loadDotEnv 必须把 `server/.env` 作为首个候选（与 Prisma Client 按 schema 旁 .env 加载的约定同源）；漏加载会静默降级（JWT 每次重启随机→全员掉登录、EMBEDDING 关闭、SSE LISTEN 拿 dev.db 兜底），且因库仍可用而极难察觉。
- **禁止演示数据**：任何环境不得残留 seed/演示数据。

## 5. MCP 契约

- 14 工具（读取 7 + 写入 7）契约见 `docs/计划/03`；工具签名不得随意变更，变更须登记 PROGRESS §4。
- 每个工具经 `guard(scope, fn)`：scope 校验 → 执行 → `recordToolCall` 打点 → Token 经济学校形。
- **MCP 上下文传递契约（R69）**：上下文一律经 `mcpStore`（AsyncLocalStorage）传递——SSE 路由在握手 keyed ctx 内 `run()` 消息处理；`guard` 取 store 上下文、无 store 才回落 env 解析（stdio）。**禁止**在 HTTP 进程里对每次调用单独 `resolveMcpContext()`——无 VIBEHUB_API_KEY 环境变量会静默落到 local 全权：scope 校验被绕过（限权密钥可调写操作）+ 用量打点 api_key_id 为 NULL。
- Token 经济学：列表默认 20 条 + has_more；长文本字段 500 字符截断并提示；图片默认降采样 1080；base64 需显式声明且 ≤4MB。
- 双传输：stdio（`VIBEHUB_API_KEY` 可选，无密钥=本地全权）+ SSE（`GET /mcp/sse` 握手 + `POST /mcp/messages?sessionId=xxx`，Bearer 必需，session 即凭据；容器部署形态）。
- scope 枚举：`context:read / attachment:read / attachment:write / bug:write / note:write / task:read / task:write / admin`；新建密钥默认仅 `context:read`。
- **密钥生命周期契约**：明文仅创建/轮换响应返回一次；库存 SHA-256 哈希；默认 90 天过期；轮换 = 签新密钥 + 旧密钥 expiresAt 压至 now+24h（宽限期语义，复用 expiresAt 字段，不新增列）；撤销即时生效（SSE 长连接由 guard 每次调用按 ID 复核密钥状态与 scope，R76）；`$queryRaw` 必须用物理列名（snake_case），非 Prisma 字段名。
- **成员与密钥联动（R76）**：密钥校验连带检查创建人状态——账号禁用则其密钥随之停用（可逆，恢复账号即恢复）；移除成员在同一事务内先吊销其创建的全部密钥再删用户（`createdBy` 为 SetNull，否则离职人员密钥继续有效）。
- **项目解析契约（R76）**：工具未传 `project_slug` 时，仅当只有一个进行中（未归档）项目才自动选择，否则 `VALIDATION_ERROR` 并列出可选 slug；**禁止**按 MCP 服务进程 cwd 猜项目或静默回落到最近更新的项目（容器内 cwd=/app、stdio 为 vibehub/server，均与 IDE 工作区无关，会把 AI 写入落进别的项目）。

## 6. 前端契约

- 颜色/圆角/阴影/时长/缓动一律 token（`globals.css` 唯一来源）；组件内禁止裸 HEX。
- 动效铁律：只动 transform/opacity；退出快于进入；`prefers-reduced-motion` 降级；装饰动画只允许三处（登录聚光/AI 流光/空状态浮动）。
- 暗色 Midnight 默认 + 纸白 Daylight；登录页恒定 Daylight。
- 单文件 ≤300 行、单函数 ≤50 行、props ≤7；基础组件 forwardRef + cva + cn()。
- 快捷键宪法：C 新建 / ⌘K 命令面板 / ? 帮助 / G+字母导航 / J K X 列表操作 / Esc 逐层退出。
- **移动端入口契约（R62）**：<900px（触屏主场景）看板顶栏常驻「＋录缺陷」按钮（快捷键触屏不可达）；对话框基座 `w-[calc(100vw-2rem)] max-h-[85vh] overflow-y-auto` 保证小屏不溢出；粘贴区文案与主按钮按 `pointer: coarse` 分支（触屏无剪贴板，走常驻「选择截图/文件」大按钮）。
- **图标宪法（R58）**：全站图标一律使用 `lucide-react` 组件，禁 emoji（空态/营销位/计数徽章）与 CSS `content` 字符图标（AI 徽章、星尘标识）——后者已全部上移为 JSX 组件（`Sparkles` 等），`globals.css` 不再出现 `content: '字符'` 图标规则。新增图标从 lucide 选型（PascalCase），尺寸/描边用 props，颜色走 token。
- **认证后导航用硬导航（R59）**：登录/注册成功后必须 `window.location.replace(target)`——`router.replace` 与 setUser 同刻提交会被 React 批处理吞掉（R50/R59 二次复现，表现为 token 已写但停在中转页）；静态导出生效下硬导航即普通跳转。
- **路由守卫竞态防护（R54）**：`(app)/layout` 守卫踢回登录页前必须确认 localStorage 无 token——登录成功后的 `router.replace` 可能在 React 提交新上下文前触发导航，守卫读到旧上下文（user=null）会把用户踢回，与 setUser 赛跑；有 token = 刚登录/恢复中，应等待而非踢回（失效 token 由启动流程清理后自然踢回，不会卡死）。
- **令牌刷新协调契约（R76）**：401 刷新一律经 `lib/token-refresh.ts`（同标签单飞 + localStorage 采用 + Web Locks 跨标签互斥 + 15s 超时），**禁止**任何地方直调 `/auth/refresh`（启动恢复流程亦然）；令牌读取 localStorage 优先、`storage` 事件跨标签同步；只有刷新被拒（401/403）才登出，网络抖动/服务重启不踢人。前端纯函数测试：`cd server && npx vitest run --root ../web`。

## 7. 容器化契约

- 单容器：`pgvector/pgvector:pg16`（ARG PG_IMAGE 声明于文件首部，全局作用域）基底 + Node 22 + supervisord 双进程；只暴露 3210，5432 不对外。
- **启动序列契约（R53）**：entrypoint 只 `exec supervisord`（PG 由 supervisord 管理，entrypoint 先等 PG 会死锁）；supervisord 并行起 postgres(pri 10) 与 vibehub(pri 20)；「等 PG→建 vector 扩展→migrate deploy」三段在 `dist/bootstrap.js` 内完成（bootstrap 导入 index.ts 的 main）。
- **DATABASE_URL 运行时组装（R53）**：entrypoint 用 `${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}` 拼装后 export——构建期 ENV 展开拿不到 `-e` 注入的密码。
- **架构相关安装（R54）**：Node tarball 按 `dpkg --print-architecture` 选 x64/arm64（Apple Silicon 上 x64 ELF 会 Rosetta SIGTRAP）；Prisma generator `binaryTargets` 必须含 `linux-arm64-openssl-3.0.x`（M 系 Mac 构建目标，缺了运行期找不到查询引擎）；`debian-openssl-3.0.x` 是 x86_64 目标名，勿混用。
- 静态产物路径：monorepo `../web/out`、容器 `web/out`、`web-dist` 三候选（index.ts 已兼容）。
- 卷分离：`/var/lib/postgresql/data`（库）+ `/data`（附件）。
- 备份：`pg_dump` + `/data` rsync；升级靠 migrate 幂等。

## 8. 测试与验证契约

- 测试库 = 一次性 pg 容器（`scripts/test-db.sh`，`TEST_DATABASE_URL` 指向 55432），与生产同引擎；禁 sqlite 分支。
- 每个 bugfix 先写复现用例；services 行覆盖 ≥80%。
- **门禁契约**：后端提交前必须 `bash scripts/acceptance.sh` 退出码 0（tsc+vitest 88 用例+HTTP 冒烟 14 项）；该脚本是唯一权威门禁，个人判断不作为通过依据。
- 声称"完成/通过"前必须当场跑验证命令并引用输出（verification-before-completion 技能同此要求）。

## 9. 技能治理契约（Skill Governance）

1. **可技能化判断**：出现≥2 次的重复工作流（起库迁移、MCP 冒烟、双主题自查、验收跑测…）必须评估做成技能；技能放 `~/.zcode/skills/<name>/SKILL.md`。
2. **任务后确认更新**：每轮施工结束必须复盘已有技能是否与现实不符（命令/路径/契约变更），不符即更新——**技能必须与 AGENTS.md 和计划文档保持一致**。
3. **新契约进本文件**：新错误码/新表/新约定出现时更新本文件并在 PROGRESS §4 登记。
4. **加载顺序**：执行任务时先按需加载技能（vibehub-build / TDD / verification / debugging 等），再加载本 AGENTS.md 契约，最后才动手。
5. **技能即真相**：禁止技能与文档"双轨制"；改行为必须同步技能。

## 10. Git 契约

- Conventional Commits（`feat(auth): ...`）；分支 `feat/fix/refactor/docs-xxx`；提交前本地三连（tsc / vitest / build）。
