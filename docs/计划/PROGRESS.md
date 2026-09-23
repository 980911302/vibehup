# VibeHub 构建驾驶舱（PROGRESS）```
状态：🧊 试用冻结期（R77 起，见 docs/计划/09）：新功能冻结；卡片 51 / 39 已按 R78 彻底删除；R76/R77/R78 在分支 fix/p0-review 待用户合并
下一步：先查 F0（验收库 trial 标签未关闭缺陷，有则优先处理）；无则执行 §2 冻结期清单最上方未完成项（当前为 F1 补验）
前置：仓库已纳入 git（main=R75 基线；fix/p0-review=R76/R77/R78，待用户合并）——每轮结束按 AGENTS.md §10 提交；
      测试库 vibehub-test-db(55432)；dev 库 vibehub-dev-db(55433) 承载用户真实数据与试用数据（勿 TRUNCATE、勿写测试数据）；
      起库脚本可自动拉起已停止的容器；服务已在跑（后端 :3210 连验收库、前端 dev :3211）；浏览器回归统一走 Playwright E2E（`tests/e2e/`，经 acceptance.sh 第 5 步），不再依赖不稳定的 IAB
加载顺序：vibehub-build 技能 → vibehub/AGENTS.md → docs/计划/09（冻结范围）→ 对应卡片的归属文档
F0 查询（只读）：docker exec vibehub-dev-db psql -U vibehub -d vibehub -c
      "SELECT id, title, status FROM bugs WHERE 'trial' = ANY(labels) AND status IN ('open','in_progress') ORDER BY created_at"
边界：冻结期禁止新功能（新增用户可见功能/入口/配置项即算）；新想法只登记 §4「试用后评审」
R76 须知：附件图片只用 serializeAttachment 返回的签名 public_url（禁自拼 /raw）；刷新令牌只能经 lib/token-refresh.ts；
      MCP 工具多项目时必须传 project_slug；MCP stdio 子进程必须显式传 DATABASE_URL（否则继承 server/.env 的 dev 库）
```


> **本文件是 VibeHub 团队单机版改造工程唯一的状态真相源。** 每轮构建（定时任务或人工）开始前必读，结束后必须更新。
> 权威依据：《计划/00-总览》+ 步骤 01-08 + 《规范/》四份 + **`vibehub/AGENTS.md` 工程契约**。任何偏离必须在 §4 偏差调整记录中说明，禁止静默跑偏。

---

## 1. 当前状态（每次运行结束更新）

- **当前步骤**：🧊 **试用冻结期（R77 起）**——新功能冻结，按 `docs/计划/09` 真实试用 10 个工作日；R78 已把冻结期清单 F1–F8 全部做完，除 F0（试用反馈）外无待办
- **当前子任务**：R78 完成（删卡片 39/51 + F1–F8 全部落地 + 交付镜像 1.3 重建 + 服务已起）；**试用起始日：待用户开始实际使用时填写**
- **环境状态**：双库容器在跑（dev 55433 持久卷 / test 55432 破坏性）；**服务已启动**——后端 :3210（连验收库）+ 前端 dev :3211（/api 代理 3210）；`vibehub:1.3` 为唯一交付镜像（含 R76/R77/R78 全部修复，1.2 已删）
- **代码基线**：R78 后全绿：vitest 180/180 + web 单测 12/12 + 冒烟 14/14 + E2E 3 用例 + 备份恢复演练 10/10 + 双端 tsc 0 错误 + next build 通过；`acceptance.sh` **PASS=19 FAIL=0**；git：main（R75 基线）→ fix/p0-review（R76/R77/R78 共 12 个提交，待用户合并）

## 2. 看板（工程进度）

### 待办（R77 起为「试用冻结期」清单：只做验证 / 加固 / 试用反馈，禁止新功能；按序取，F0 常驻最高优先）

| # | 卡片 | 归属 | 验收 |
| --- | --- | :-: | :-: |
| F0 | 试用反馈缺陷（常驻）：验收库中带 `trial` 标签且未关闭的缺陷，按录入先后处理（查询见 §5；修复后在 VibeHub 回填状态） | 09 | 复现用例 TDD + acceptance.sh |
> R78 已把 F1–F8 全部做完（详见「已完成」）；除 F0 外无待办。冻结期边界不变：新功能仍一律不施工。

### 已移除（R78 用户决定，不再重开、不再列入任何看板）

| # | 卡片 | 处理 |
| --- | --- | --- |
| 39 | 全局截图入口（浏览器扩展） | **删除**：R77 已砍（MCP 密钥调 REST 实测 401，「零后端改动」前提不成立），R78 连评审文档一并移除 |
| 51 | 看板表格视图（卡片 50 剩余部分，⌘⇧V 列表模式） | **删除**：需求未经真实使用验证，R78 移除，不占冻结区 |

### 进行中

（无）


### 已完成

- **冻结期清单 F1–F8**（R78 ✅ **全部完成**，逐一验证如下）：
  - **F1 补验**：`server/tests/e2e/regression.spec.ts` 两条浏览器用例补齐卡片 49（创建带指派→卡片首字头像→详情改派→看板同步）与卡片 50（TSV 多行粘贴→4 行解析/3 可导入/1 跳过→确认→看板出现）；R76 缩略图断言（`naturalWidth > 0`）在 F3 闭环用例内 —— Playwright 实测通过，**长期挂账的「IAB 环境跳过」至此清空**
  - **F2 语义索引写路径**：`updateBug`/`updateNote` 比较语义文本（标题/步骤/期望/实际、内容/标签），未变即跳过外网；`embedText` 加 `AbortSignal.timeout(EMBEDDING_TIMEOUT_MS=5000)`，超时由 upsert 内部隔离不阻断业务（拖拽改状态不再等 DashScope）——5 条 TDD 用例
  - **F3 核心闭环 E2E**：`server/tests/e2e/core-loop.spec.ts` 一条链路五段断言（合成粘贴录入→缩略图真实解码→MCP stdio 读取→按状态机 in_progress→resolved 回填 commit→看板卡片落「已解决」列）；接入 `acceptance.sh` 5/6 步（清库+起服务+产物新鲜度+传 DATABASE_URL）；新 devDependency `@playwright/test` 已登记 §4
  - **F4 登录防暴力**：`/auth/login` 按「邮箱+IP」滑动窗口计数失败尝试（成功清零），达阈值 429 `RATE_LIMITED` + 人话 + `Retry-After`；新错误码与契约入 AGENTS.md §3 —— 7 条 TDD 用例
  - **F5 SSE 加固**：新增 `services/sse-listener.ts`（进程内共享单条 LISTEN 连接 + 引用计数 + 自愈重建 + 连接代次防竞态），`routes/events.ts` 只注册回调；请求日志序列化器把 `?token=` 抹为 `[已脱敏]` —— 7 条 TDD 用例 + 门禁两条运行时实证（日志有脱敏行、无 JWT 明文）
  - **F6 交付镜像**：`vibehub:1.3` 重建（含 R76/R77/R78 全部修复）；容器冒烟：health/root/login 200 + MCP SSE 401 + 注册 Owner + 建项目建缺陷 + 迁移 15 表；旧 `vibehub:1.2` 已删（R70 约定不留含已知漏洞镜像）
  - **F7 备份恢复**：`scripts/backup.sh`（pg_dump -Fc + 附件卷 tar，含 dump 可读性校验与 manifest）+ `scripts/restore-drill.sh`（测试库上「备份→清库→恢复→核对」）—— 演练 **PASS=10 FAIL=0**
  - **F8 文档纠偏**：README 用例数 99/133→173 + 前端单测 12 行、pg17→pg16 示例、删卡片 39 重开指引；AGENTS.md 工具数 14→15、门禁契约去掉硬编码用例数

- **卡片 1**（本轮 ✅）：provider 切 postgresql；删 sqlite 迁移历史；init 迁移 `20260921164543_init` 已应用，10 张表；`notes.tags`/`api_keys.scopes` 升级原生数组；验证：migrate status up to date + 四表 count=0 + tsc 0 错误

- **卡片 2**（本轮 ✅）：Bug 扩展 assigneeId/priority/dueDate/labels/reopenedCount + 三索引；Project archivedAt/createdBy；Task assigneeId；Note pinnedAt/createdBy；验证：随卡片 1 迁移一并落地，tsc 0 错误

- **卡片 3**（R2 ✅）：BugComment/BugTemplate/SavedView/Embedding 四模型 + 迁移 `20260921165354_team_domain_models`；vector 列与 hnsw 索引按「migration 内 raw SQL」方案落地（修正 R1 的 setup 脚本决策，见 §4 R2）；验证：14 表齐全、`embeddings.embedding` 为 vector(1536)、`Embedding_embedding_idx` 为 hnsw、migrate status up to date、tsc 0 错误

- **卡片 4**（R3 ✅ 剩余部分）：README 删除全部 seed/prisma:seed 引导；快速启动改为「空系统起步，首位注册用户为 Owner」表述；目录结构表 seed.ts 行移除、表数更正为 14。验证：`grep -c seed README.md` = 0

- **卡片 5**（R3 ✅）：config.paths.trash + config.attachmentTrashDays；storage.moveToTrash（保留相对路径入 trash）/ purgeOlderThan（超期清理+空目录回收）；index.ensureDirs 建 trash 目录。**修复真 bug**：文件系统时钟可能快于系统时钟导致 mtime 为"未来"、ageDays 为负使同轮文件漏清——钳制 `Math.max(0, …)`。验证：三场景冒烟（purge(0) 清理/ purge(30) 保留/ 幂等）× 2 轮全 PASS

- **卡片 6**（R4 ✅）：core/errors.ts 扩展 8 个认证错误类型；core/serialize-user.ts（PublicUser 禁出 passwordHash）；services/audit.ts（logEvent 计量）；services/auth.ts（register 首位 Owner + 注册开关 / login 防枚举 / refresh 一次性轮换 + family 重放检测 / logout / me+stats / changePassword 吊销全会话）；plugins/authenticate.ts（根实例 decorate）；routes/auth.ts（/api/auth/* 白名单）；index.ts 业务路由统一挂守卫；config 补 jwtSecret/registrationOpen/accessTokenTtlSec/refreshTokenTtlDays。验证：15 项冒烟全 PASS（Owner 引导、409/400/401 形态、轮换、重放连带吊销、改密吊销、UsageEvent 落账、无 password_hash 泄漏）

- **卡片 7**（R5 ✅）：services/users.ts（listUsers 拼音检索 / createUserByAdmin 一次性明文 / updateUser LAST_OWNER+不能改自己 / removeUser 不级联业务数据 / transferOwnership 互换）；routes/users.ts（/api/users CRUD + transfer-ownership，Admin+ 用 requireRole）；index.ts 接线。验证：12 项冒烟全 PASS（403 矩阵/LAST_OWNER/角色互换/拼音命中/一次性明文可登录/移除不级联/无 password_hash）

- **卡片 8**（R6 ✅）：attachments service 增加 uploadedBy 入参与 mine 过滤；序列化带 uploaded_by；multipart/base64 两条上传路由从 request.user 落归属；守卫核查 8 路由全过；SSE 因 EventSource 限制改 query.token 鉴权（契约已入 AGENTS.md）；web hook 加最小 token 骨架。验证：14 项冒烟全 PASS（归属/mine/八路由 401-200/SSE token）

- **卡片 9**（R7 ✅）：mcp/scopes.ts（8 scope 常量+hasScope+admin 通配）；mcp/context.ts（local/keyed 双模式，密钥无效抛 McpContextError）；mcp/usage.ts（recordToolCall：UsageEvent+lastUsedAt）；mcp/token-budget.ts（paginate/truncateText/enforceSizeBudget：20 条默认/500 字符/64KB）；mcp-entry.ts 启动前解析上下文，无效密钥 exit 1。验证：16 项冒烟全 PASS + 无效密钥 exit code 1 + local 模式 stdin EOF 优雅退出

- **卡片 10**（R8 ✅）：mcp/guard.ts（scope→执行→整形→打点统一包装）；tools.ts 7 工具接入（briefBug 补 priority/labels/assignee、get_bug_detail 长字段 500 字符截断+tip、list_bugs paginate 整形）；mcp/tools-extended.ts 新增 8 工具（list_notes/search/create_bug/add_bug_comment/upload_attachment/list_tasks/update_task/purge_trash）；server.ts 注册 **15 个工具**（比 03 文档矩阵多 1——文档「13 号含两个工具名合计 14」算术有误，实为 15，已登记 §4）；services 补齐 bug-comments.ts / search.ts（search 路由重构消除直连 Prisma 架构违规）/ attachments.uploadFromBuffer。验证：stdio 冒烟 16 项 PASS（15 工具清单/空库人话错误/校验/local 全通/keyed scope 拒绝三类/打点/lastUsedAt/stdout 纯净）

- **卡片 11**（R9 ✅）：context.ts 抽出 loadKeyedContext（双传输共用）；routes/mcp-sse.ts（GET /mcp/sse Bearer 握手+401 人话；POST /mcp/messages sessionId 转发+404；每连接独立 McpServer+sessionMap）；index.ts 挂 /mcp（不经用户守卫）。验证：SSE 冒烟 10 项 PASS（无/错密钥 401/流建立/endpoint sessionId/initialize+tools/list=15/工具调用/未知 session 404）

- **卡片 12**（R10 ✅）：bugs.ts 状态机（BUG_TRANSITIONS 唯一真理源+assertTransition 人话+reopenedCount+状态变化自动写评论流+actor 区分 user/ai）+ v2 字段透传（priority/assignee/due/labels/reopen_reason）+ createBug 模板填充；新服务 bug-templates（惰性三默认）/saved-views（默认唯一+同名冲突）/bug-import（CSV 导入导出，BOM，逐行校验部分失败）；routes/bug-extras.ts（batch 六动作+评论+模板+视图+import/export）；serialize 补 8 字段；MCP update_bug_status 落 ai actor。验证：14 项冒烟 PASS（非法迁移人话/重开计数+评论流/批量部分成功/CSV round-trip/模板惰性/权限 403/视图冲突）

- **卡片 13**（R11 ✅）：scripts/test-db.sh（起/复用 pg16 容器）；test-setup.ts 重写（TEST_DATABASE_URL+migrate deploy+CREATE EXTENSION vector+test-data 隔离）；test-helpers.ts（resetDb TRUNCATE/createUser/authHeaders/createApiKey）；测试重写 7 文件 88 用例（auth 17/users 11/bug-domain 19/core-services 15/mcp 16/rbac 3/api 13 + 既有）全绿两轮稳定。**过程中抓修 3 个真缺陷**：tasks service createTask 缺 assigneeId 透传；projects 路由缺 requireRole（member/viewer 竟能建项目，违反角色宪法）；logEvent 即发即弃竞态导致用量漏账（统一 await）；另有随机一次性密码 ~8% 概率不含数字不满足自家策略（重采样修复）。验证：vitest 88/88 ×2 轮

- **卡片 14**（R12 ✅）：scripts/acceptance.sh 一键门禁（起库→tsc→vitest→起服务 3456→HTTP 冒烟 14 项→TRUNCATE 清理→退出码）；破坏性自测通过（改坏断言 → FAIL=2、exit 1）。验证：bash scripts/acceptance.sh = 14 PASS/0 FAIL、exit 0。**踩坑修复**：macOS bash 3.2 下 `$PORT）` 全角括号并入变量名——全脚本改 `${VAR}` 显式定界

- **卡片 15**（R14 ✅）：后端加 GET /api/auth/config（注册开关）；前端 lib/auth.tsx（AuthProvider+localStorage+401 refresh 重放+失效清态）、lib/api.ts 全量重写（TokenAccessors 注入/统一错误/全 API 面）、api-types.ts（v2 全字段）、(auth)/login 页（白泽观智印刷品规格：网格+聚光+玻璃卡+Tab 滑块+强度条+协议勾选）、(app)/layout 守卫（redirect 回跳）、(app)/board 占位。**抓修 2 个部署级 bug**：redirect() 静态导出抛错产 __next_error__（改客户端跳转）；@fastify-static 缺 extensions:['html'] 致干净 URL 死循环。浏览器回归 6 项全过（守卫/注册/强度条/登录回跳/错误人话/token 持久化）

- **卡片 16**（R15 ✅）：globals.css 双主题 token 体系（Midnight/Daylight+9 关键帧+应用壳类）；lib/theme.tsx（localStorage+data-theme）、lib/toast.tsx（撤销插槽+倒计时进度条+堆叠让位+同 key 合并）、lib/shortcuts.ts（useHotkeys 序列支持 G 前缀+16 项 GLOBAL_HOTKEYS 注册表）；ShortcutsHelp（? 面板 16 行）、CommandPalette 重写（⌘K 搜索/键盘导航/Enter 触发/主题动作）；(app)/layout 壳（品牌/搜索/帮助/主题/用户卡/登出）。**抓修 3 个真 bug**：accessor 闭包过期（改 ref）、catch 分支 refresh 未同步 ref、**/auth/me 前后端响应结构不一致**（后端扁平致恢复态 user=undefined 无限踢回登录页）。浏览器回归 12 项全过（登录/刷新×2/主题×3/帮助/⌘K+Enter/G+P/登出/登出后守卫）

- **卡片 17**（R16 ✅）：components/layout/Sidebar.tsx（7 项导航+Admin+ 过滤+折叠 232→64px 只动 width+文字 140ms 淡出+金色指示条+localStorage 持久化+<900px overlay 抽屉+Esc/导航自动关）、UserCard.tsx（首字头像+角色徽章+退出）；(app)/layout 重构为 vh-shell/body/main 三段式；globals.css 补侧边栏与抽屉样式（UI 规范 §2.1）；files/tasks/projects/keys/members/settings 六占位页。验证：浏览器 8 项（7 导航渲染/折叠动画+文字透明/刷新持久化+导航高亮/抽屉触发+品牌隐藏+Esc 关+导航自动关跳转）

- **卡片 18**（R17 ✅）：hooks/use-vibehub.ts 重写（useAuth 接入+SSE query.token+5s 轮询兜底+templates）；BugCard（严重度左缘 3px 色条/逾期红/↻重开/💬评论/AI 星尘徽章/缩略图）；BugBoard 重写（五列+拖拽 draggingRef+非法列 shake+多选 ⌘/Shift+范围选）；BugDetailDialog 重写（完整字段/附件网格/AI 上传徽章/活动流+评论输入/状态按钮含重开 prompt）；CreateBugDialog 重写（粘贴上传/模板填充/⌘↵）；BatchBar（滑入+改状态/加标签/删除）；ProjectSwitcher（拼音检索+新建）；board/page.tsx（筛选条/搜索/空态/C 快捷键/全局 paste/右键菜单）。**IA 缺口登记**：随手记（notes）无独立页——暂未规划，见 §4。验证：浏览器 11 项全过（C 打开/粘贴上传/⌘↵ 发送+缩略图/拖拽改状态/右键 3 项/活动流自动评论+作者/手动评论/批量栏/五列+切换器）

- **卡片 19**（R18 ✅）：files/page.tsx（我的/全部 Tab+用量条+类型筛选+搜索+整页拖拽接收+全局 Ctrl+V）；components/files/FileGrid.tsx（AI 上传徽章+关联缺陷角标+per-file 删除权限）；TextViewer 重写（新 token+ERROR 红/grep mark）；图片灯箱（←→/Esc/信息栏）。验证：浏览器 7 项全过（空态/粘贴上传+缩略图+用量/灯箱+Esc/文本 ERROR 红+grep 1 行 mark/我的全部切换/删除+Toast）

- **卡片 20**（R19 ✅）：后端补 assignee_id 透传（tasks create/update）+ projects archived_at（service/序列化/路由）；tasks/page.tsx（三列+Enter 添加+下拉流转+转缺陷 Toast）；projects/page.tsx（表格+slug 等宽复制+归档/恢复+删除输入名称确认+数据说明+Admin+ 权限）；store 加 refreshProjects。**抓修 2 个问题**：GET /api/projects 裸出 Prisma 模型（camelCase）致前端 created_at.slice 崩溃——序列化補 counting/archived_at（AGENTS.md 契约又一次立功）；归档后列表不刷新。验证：浏览器 7 项全过（任务 3 列/Enter 添加/下拉流转/转缺陷 Toast+任务清零/项目表格+slug 复制/归档↔恢复/删除确认含数据说明+按钮禁用）

- **卡片 21**（R20 ✅）：components/keys/KeyWizard.tsx（三步创建向导：名称→Scope 清单（每项旁注工具名）→有效期；第 3 步一次性明文金色描边卡+复制+MCP 配置 JSON 一键复制+红色警告；KeyUsageChart 30 天按日柱状图）；keys/page.tsx（Bento 概览：活跃/峰值 QPM/scope 种类/状态；表格：掩码 vhk_live_JDJ1••••••••+scope 药丸+配额条+最后使用（闲置提示）+状态；行操作：用量/轮换/撤销；Admin+ 权限）。验证：浏览器 6 项全过（空态/向导三步+明文+配置 JSON+警告/列表掩码+药丸/轮换 1→2 行/撤销状态/用量空态）

- **卡片 22**（R21 ✅）：后端新增 SystemSetting 模型+迁移+services/system.ts+routes/system.ts（GET 登录可见/PATCH 仅 Owner）+register 改用设置表（env 兜底）；members/page.tsx（成员表格：头像/角色下拉即改/状态/统计/行操作禁用移除+LAST_OWNER 防护置灰/注册开关 Switch 运行时生效/复制注册链接/关闭时建号区+一次性密码/Owner 转让危险区）；settings/page.tsx（个人资料/改密+强度条/主题切换/系统回收站天数）。验证：浏览器 6 项全过（角色即改 Toast/注册开关关→建号区/建号一次性密码+3 行/禁用→已禁用+启用钮/设置三区块/改密 Toast）

- **卡片 23**（R22 ✅）：deploy/supervisord.conf（postgres user=postgres priority 10 + node priority 20，stdout 日志）/entrypoint.sh（pg_isready 60s 等待→CREATE EXTENSION vector→migrate deploy→exec supervisord）；Dockerfile 四阶段（server 构建→server 精益生产树 npm ci --omit=dev→web 静态导出→pgvector 基底+Node 22 官方 tarball+supervisor；ARG PG_IMAGE 默认 pg16 可切 pg17；HEALTHCHECK；双 VOLUME；ENTRYPOINT）；docker-compose.yml（POSTGRES_PASSWORD/JWT_SECRET 必填占位、双卷、只暴露 3210）；.env.example；README 部署章节重写（5 分钟跑起来/双传输 MCP/15 工具矩阵/备份升级/环境变量）。**验证降级登记**：本机 Docker Hub 拉取停滞（pg17 40min 无进展），镜像构建未完成；改为 ①Dockerfile/compose/entrypoint 静态检查 ②entrypoint 五步序列在真实 pgvector 容器模拟执行（pg_isready→CREATE EXTENSION→migrate deploy→node 启动→health→MCP SSE 401→注册 Owner 建项目→重启数据持久化）全部通过

- **卡片 25**（R23 ✅ **工程收官**）：四场景端到端总验收 30/30 全过——A 身份治理（首用户 Owner/成员列表/注册开关 403/RBAC 403）；B 人的闭环（上传截图 attachment_id/uploaded_by/建缺陷关联/状态机合法+非法/重开 reason+reopened_count/活动流 4 条）；C AI 闭环（密钥一次性明文/tools=15/get_project_context/AI 贴回日志/分片 grep 1 行/降采样 base64 540px/评论/MCP 链路状态机生效+回填 commit/撤销后启动 exit 1）；D 治理（我的文件过滤/删自己 204/移除成员数据保留/Owner 转让角色互换/用量 8 条）；验收脚本沉淀为 server/scripts/final-acceptance.mjs；最终浏览器形态确认（七导航+五列看板+Owner 用户卡）

- **卡片 26**（R13 ✅）：services/api-keys.ts（createKey 一次性明文+默认最小 scope+90 天、listKeys 掩码、rotateKey 轮换+旧密钥 24h 宽限（expiresAt 压缩语义，不新增列）、revokeKey 即时生效、keyUsage 按日聚合 raw SQL）；routes/api-keys.ts（Admin+ 权限）；index 接线。验证：11 个新用例全过 + acceptance.sh **99 用例 + 14 冒烟 exit 0**。抓修：$queryRaw 误用 Prisma 字段名致 42703（改物理列名）

- **卡片 27**（R50 ✅）：随手记独立页落地，补 R17 IA 缺口。后端 TDD 三能力（先红后绿）：`serializeNote` 输出 pinned_at / `updateNote({pinned})` 置顶开关 / `listNotes` 置顶浮顶（pinned_at desc nulls last）+ PATCH 路由透传；前端 (app)/notes/page + NoteWall（瀑布流 columns + 底部标签过滤栏）+ NoteCard（ReactMarkdown+remark-gfm 渲染 / 行内编辑 / 置顶 / 删除）+ NoteComposer（N 键 / ⌘↵ 发送 / 标签解析）；Sidebar 加「随手记 G N」入口（顺带修正 GLOBAL_HOTKEYS 有 g t 展示但 layout 未接线的既有缺口）；⌘K 面板加导航行；删 v1 遗留 ScratchpadWall.tsx（旧 lib/types 依赖）。**用户当场验收两项附带修复**：桌面端顶栏与侧边栏双 VibeHub 品牌（globals.css 品牌显隐写反，改为桌面隐藏/移动显示）、Next dev 指示标浮动 N 图标（next.config devIndicators:false）。验证：后端 vitest 105/105（新增 6 用例，红→绿两态均观测）+ web tsc 0 错误 + next build 通过（/notes 静态导出）+ 浏览器回归 9 项全过（空态/N 新建+Markdown 渲染/置顶浮顶+多置顶倒序/标签筛选恢复/行内编辑/删除 Toast/G N 导航高亮/⌘K 面板导航）

- **卡片 28**（R51 ✅）：语义检索激活（用户配置：DashScope text-embedding-v3，dim=1024，OpenAI 兼容模式）。后端 services/embedding.ts（TDD 9 用例红→绿：请求形态 model+dimensions+base64、float32 base64 解码、维度校验、截断、upsert ON CONFLICT、cosine 排序相似查询）+ config.embedding 八项读取；迁移 `20260922113638_embedding_dim_1024`（dim 默认 1536→1024，向量列宽自愈式 raw SQL：ADD COLUMN IF NOT EXISTS + 先删索引再 ALTER TYPE 再重建 hnsw）；bugs/notes 写路径接入（create/update 后 await upsert，delete 清理；内部失败隔离）；services/search.ts 增 similar 语义分区（⌘K 与 MCP search 透传）；resetDb 补 embeddings 表。**真实 DashScope 冒烟通过**：两条便签落 1024 维真实向量，查询「浏览器兼容性问题」语义命中缺陷便签（d=0.24）压过无关便签（d=0.62）。验证：vitest 114/114 + tsc 0 错误 + acceptance.sh 14/14 exit 0 + 真实 API 冒烟 PASS

- **卡片 29**（R52 ✅）：跨进程实时推送落地（不引 Redis，按 R49 登记的 PG NOTIFY 方案）。core/events.ts：publish 后 `pg_notify('vibehub_events', payload)`（异步、失败隔离、payload 扁平小 JSON）；routes/events.ts：SSE 改用独立 pg Client `LISTEN` 单通道（替代进程内 eventBus 订阅——同进程写入也走此通道天然去重；pg Client 挂 error 监听器防 PG 重启炸进程；LISTEN 失败降级轮询不阻断）；依赖新增 pg@8.23；前端 5s 轮询按边界保留为双保险。TDD 6 用例红→绿（createBug/createNote/updateBug 通知内容断言、payload 扁平与 8KB、失败不发通知、打点路径不发 vibe 事件）。**双进程冒烟通过**：进程 A 起服务，进程 B（独立 tsx 进程，模拟 MCP stdio）createBug → SSE 收到正确的 bug.created（bugId 匹配），送达发生在 B 进程退出前的 600ms 窗口内（<1s 达标；精确毫秒受冒烟脚本 stdout 管道/文件时间戳投递延迟干扰测不准，实测事件在 writer 打印时就已入 SSE 流）。验证：vitest 120/120 + tsc 0 错误 + acceptance.sh 14/14 exit 0

- **卡片 30**（R53 ✅）：Docker 单容器真实验收（补 R22 降级缺口）。`docker build` 成功（1.43GB）——过程中抓修 **6 处真 bug**：①`ARG PG_IMAGE` 写在第三个 FROM 之后作用域归属前一 stage，FROM 展开为空 → 提至文件首部；②`.prisma` 路径按 workspaces 提升布局改为根 `node_modules/.prisma`；③**entrypoint/supervisord 启动死锁**（entrypoint 先等 PG 再 exec supervisord，而 PG 恰由 supervisord 管理，永远等不到）→ 等待/建扩展/迁移下沉 `dist/bootstrap.js`，entrypoint 只 exec supervisord；④DATABASE_URL 构建期 ENV 拿不到运行时密码 → entrypoint 运行时拼装；⑤Node 写死 x64 在 arm64 基底上 Rosetta SIGTRAP → 按 `dpkg --print-architecture` 选架构；⑥Prisma 引擎目标名错（debian-* 是 x86_64 命名）→ binaryTargets 加 `linux-arm64-openssl-3.0.x`。**顺带抓修产品级 bug**：`/api/upload` multipart 顺序依赖（文件 part 先于 project_id 字段到达即 400，curl 默认顺序必踩）→ 两段式重写 + TDD 回归用例。**验收**：容器 healthy + health/login/root 200 + 容器内四场景 15/15（A 身份/B 人闭环/C AI 闭环含 MCP SSE 握手/D 治理）+ `docker restart` 后数据持久且迁移幂等；主机侧 vitest 121/121（修 1 个置顶排序 flakes：timestamp(3) 同毫秒不可区分，测试加间隔）+ acceptance.sh 14/14 + **final-acceptance.mjs 总验收 30/30** + tsc 0 错误

- **卡片 31**（R54 ✅）：登录回跳竞态修复。根因（代码级定位 + R50 症状吻合）：登录成功后 click handler 的 `router.replace` 在 React 提交新上下文**之前**触发导航，(app)/layout 守卫读到旧上下文（user=null、ready=true）把用户踢回 /login，与随后的 setUser 效果赛跑，偶发踢回赢（10 次浏览器复现未稳定重现——竞态窗口窄）。修复：守卫踢回前先确认 localStorage 无 token（有 token=刚登录/恢复中→等待；失效 token 由启动流程清理后自然踢回，不卡死）。验证：tsc 0 错误 + 连续 10 次登录全部落 /notes + 登出正确踢回 /login（token 已清）+ 垃圾 token 深链 3s 内踢回不卡死；契约入 AGENTS.md §6

- **卡片 32**（R54 ✅ **无缺陷关闭**）：R50「Toast 无 CSS」观察项经浏览器实测为**误报**——样式写在 toast.tsx 底部 `<style jsx global>`，而 styled-jsx 在 App Router 客户端组件中实际生效（先前只 grep 了 globals.css 未做运行期验证）。实测证据：.vh-toast-stack computed=position:fixed/bottom:40px/z-index:90；.vh-toast=280x42、圆角 14px、阴影、bg 正常；进度条 animation=vh-toast-countdown 正在运行（getAnimations 计数 1）。Toast 功能完好，无代码变更

- **卡片 33**（R56 ✅）：首启向导与空状态行动化。新建 components/onboarding/OnboardingWizard.tsx 三步向导（①建项目——名称+slug 自动建议+「AI 靠它匹配仓库」人话解释 ②创建 MCP 密钥引导——解释最小权限+跳转密钥页+稍后再说 ③邀请成员——复制注册链接+进入看板），localStorage('vibehub_onboarded') 防重复，(app)/layout 登录后自动弹出 + 监听 'vibehub:open-onboarding' 事件供空态唤起；空态四要素补齐：看板（无项目）/文件（无项目）/任务（无项目）改「图标+人话+主按钮+快捷键提示」并干掉 window.prompt、FileGrid「还没有文件」加「去录一笔缺陷」按钮、⌘K 无结果改人话+语义提示。验证：tsc 0 错误 + next build 通过 + 浏览器回归 6/6（注册自动弹向导/建项目到第二步含 slug 自动建议/跳密钥页落旗/不重复弹/刷新保持/文件空态按钮跳转）。**排障记录**：dev server 被 `next build` 覆盖 .next 导致 React 事件失灵（Tab 点击无反应），重启 dev 恢复——教训已入 vibehub-build

- **卡片 34**（R57 ✅）：⌘K 语义搜索显性化。api-types 补 `similar` 字段；CommandPalette 消费 globalSearch.similar：独立「✦ 语义相似（AI）」分组（金色星尘+「理解你的说法，不只是字面匹配」说明+「AI 语义命中」行尾标），12 行预算为语义组预留（标题计入），空分组不渲染，分组标题 Enter 无操作（runRow 守卫）；search service 增 cosine 距离阈值 0.5（cards 28 边界修正，登记 §4）——无阈值时垃圾查询也返回近邻（实测抓到）。**顺带抓修真 bug**：config.ts 的 .env 候选路径不含 `server/.env`（与 Prisma 同源约定相悖）→ 非 Docker 环境 EMBEDDING_*/JWT_SECRET 静默丢失（JWT 随机致重启全员掉登录、SSE LISTEN 降级 dev.db、语义检索关闭），修为首选候选。验证：TDD 阈值（方向向量+过滤断言，红→绿）+ vitest 121/121 + acceptance.sh 14/14 + web tsc/build + 浏览器回归（口语化查询「登录按钮点了没反应」命中 Safari 便签出分组/无意义查询无分组且友好空态/登出还原）

- **卡片 35**（R59 ✅）：角色化导航简化。NAV_ITEMS 分 primary/more 两组：日常五项平铺，密钥/成员/设置收进「更多」折叠区（ChevronDown 旋转 150ms、展开态 localStorage 持久化 `vibehub_nav_more`、落在次要路由自动展开）；非管理员看到管理项为**锁定态**（Lock 图标+「需管理」+点击 toast「需要管理员权限」）保留可发现性；设置页偏好区新增「简洁模式」开关（隐藏「更多」入口，`vibehub_nav_simple` 持久化， lib/nav-prefs 模块 + `vibehub:nav-prefs` 事件跨组件同步）。**顺带抓修复真 bug**：注册/登录成功后 `router.replace` 与认证状态更新同刻提交被 React 批处理吞掉（R50 后第二次复现，R54 守卫修复未覆盖此「导航根本不发生」变体）→ 改 `window.location.replace` 硬导航彻底消灭该竞态类。验证：tsc + next build + 浏览器回归 9 项（注册硬导航落板/默认折叠/展开/刷新保持/锁定 toast 不跳转/简洁模式开关+刷新保持/关闭恢复+自动展开/Owner 无锁全显）

- **卡片 36**（R60 ✅）：AI 活动可见流。后端 services/activity.ts（usage_events 的 mcp.tool_call 倒序 + Prisma include select 脱敏：只出 key_name/key_prefix，禁出 keyHash/salt）+ routes/activity.ts（GET /api/activity/recent，**全员可读**不挂 requireRole——本特性就是让非管理员感知 AI 活动）；前端 components/activity/ActivityPanel.tsx（右侧滑出 320px，只动 transform，10s 自刷新，Esc/遮罩关闭，空态引导）+ api 层接线。TDD 8 用例红→绿（脱敏断言/倒序/非 MCP 过滤/本地模式/limit/member 可读/401/空库）。**入口位置偏差登记 §4**：锚点写在 board 筛选条，实测无项目时看板是空态根本没有筛选条 → 入口移至顶栏 Sparkles 图标（系统级功能更合理）。验证：tsc + next build + vitest 129/129 + acceptance.sh 14/14 + 浏览器回归（面板 3 条活动/工具名+密钥名+前缀+相对时间+失败徽章/Esc 关闭）

- **卡片 37**（R61 ✅）：上传进度与失败重试。api.uploadFile（XHR 单文件 + onprogress 百分比 + 60s 超时兜底——挂起必须变失败）；hooks/use-file-upload.ts（逐文件并行队列：uploading/done/error 三态，done 1.5s 自动消失，失败可单独 retry）；components/files/UploadProgressStrip.tsx（金色 2px 进度 scaleX 只动 transform、失败红框+重试按钮、完成打勾）；接入文件页三入口（拖拽/粘贴/选择）+ CreateBugDialog 粘贴区（onUpload prop 改 projectId 自理上传）。验证：tsc + next build + 浏览器回归（9.5MB 上传 0%→100%→完成采样/停机失败态红框+重试+Toast/恢复后重试→完成→自动消失/看板 C 对话框路径）。**顺带修复**：XHR 无超时会在代理挂起时永久卡 uploading → 加 60s ontimeout；错误文案人话化（非 JSON 响应→「服务暂时不可达」）

- **卡片 38**（R62 ✅）：移动端录缺陷路径。board 顶栏 <900px 常驻「＋录缺陷」按钮（`hidden max-[899px]:inline-flex`——触屏无 C 快捷键）；dialog 基座小屏适配（`w-[calc(100vw-2rem)] max-h-[85vh] overflow-y-auto`——375px 下 343px 居中不溢出）；CreateBugDialog 触屏文案分支（`pointer: coarse` 时改「点下方按钮选择截图或文件」+ 常驻大按钮，桌面端保留 Ctrl+V 引导）。验证：tsc + next build + 375px iframe 实测（录缺陷按钮可见且不溢出/对话框 343px 适配/触屏文案分支经产物级验证——见 §4 IAB 视口局限）

- **卡片 40**（R64 ✅）：验收库与测试库分离（§4 R57 遗留项转正）。新建持久容器 `vibehub-dev-db`（pg16, :55433, vibehub/vibehub）+ 全量迁移（15 表）；`server/.env` DATABASE_URL 切验收库；`TEST_DATABASE_URL` 继续指向破坏性测试库 `vibehub-test-db`(:55432)；契约入 AGENTS.md §4 双库条款；README 快速启动与 test-db.sh 头注标明破坏性。**生存证明**：验收库建用户 → 跑 vitest 129/129 → 用户毫发无损（count=1）→ acceptance.sh 14/14 后验收库 users=0 未受影响。R57「跑测试清空用户数据」类事故根治

- **卡片 41**（R65 ✅）：验收库卷持久化加固（卡片 40 的补丁）。`vibehub-dev-db` 重建挂命名卷 `vibehub-dev-pg`（原无卷——删容器即丢全部验收数据）；新增 `server/scripts/dev-db.sh`（起/复用+建 vector 扩展+输出连接串，镜像 test-db.sh 约定）；README 双库起库引导；AGENTS.md 连接契约补卷说明。**容器重启证明**：docker restart 后 projects 计数不变（1→1）；端到端验证注册/建项目往返通过

- **卡片 42**（R67 ✅）：交付镜像刷新。R53 的 vibehub:1.0 之后二/三期代码（置顶/语义检索/实时推送/导航重构/上传改造/AI 活动/移动端）全部未进镜像——重建 `vibehub:1.1`（1.43GB，build 0 错误）；容器冒烟全过：healthy + health/注册 201/建项目 201/建缺陷 201+看板可见/校验 400/MCP SSE 无密钥 401/login 静态页 200。镜像留存、冒烟容器已删

- **卡片 43**（R68 ✅）：README 刷新（卡片 39 仍阻塞）。事实核对后全面对齐：功能总览补随手记置顶/首启向导/AI 活动可见流/语义检索/角色化导航/移动端入口/上传进度（陈旧表述「5s 轮询兜底」等清零）；项目结构补 scripts/bootstrap/新目录；测试段 33→129 用例 + 四场景 30 项 + 门禁三连；路线图去重并将 Redis/语义检索/SSE 从「规划」挪到「已交付」；环境变量补 EMBEDDING_* 与双库起库引导 | grep 验证陈旧表述 0 残留；关键数字与实况核对一致（15 工具/14 表/129 用例/15 表含迁移表） | 卡片 39 仍等用户三决策。**技能治理**：① 无新模式；② 技能无需更新；③ 无新契约 |

- **卡片 44**（R69 ✅，**安全级修复**）：容器全量验收 + SSE 上下文传递修复。动机：把权威四场景验收搬到交付镜像 vibehub:1.1 上跑（脚本扩展 `BASE_URL`/`MCP_TRANSPORT=sse` 双传输）。首跑 29/30 暴露**真 bug**：SSE 传输下 `guard` 每次调用单独 `resolveMcpContext()`，HTTP 进程无 VIBEHUB_API_KEY → 全部落 local 全权上下文——**scope 校验被静默绕过**（限权密钥可调写操作）+ 用量打点 api_key_id 全 NULL。修复：新增 mcp/context-store.ts（AsyncLocalStorage），SSE 路由在握手 keyed ctx 内包裹消息处理，guard 优先取 store、回落 env（stdio 行为不变）；TDD 4 用例（越权拒绝/授权放行/打点归属/stdio 回落）红→绿。重建 vibehub:1.2，容器 SSE 全量验收 **30/30**（D6 total=8）；vitest 133/133 + acceptance.sh 14/14；契约入 AGENTS.md §5

- **卡片 48**（R74 ✅）：全站术语中文化。bug 状态 → 待处理/进行中/已解决/待验证/已关闭（api-types.ts BUG_STATUS_LABELS + BatchBar option + lib/types 残留 map 三处）；任务 → 待办/进行中/已完成；角色 → 拥有者/管理员/成员/只读（members + UserCard）；优先级英文值 → PRIORITY_LABELS。验证：英文残留 grep 零命中 + tsc + build 通过（浏览器回归随卡片 49 轮次同因跳过）

- （R75 ✅ 部分交付）：Excel 式速录。① 轻量默认字段：CreateBugDialog 重写（整 300 行）——标题必填即可发送，复现步骤/严重度/指派/模板收进 BugFormExtras 折叠件；② TSV 批量导入：lib/tsv-import.ts 解析器（TDD 6 用例红→绿：中英文严重度别名/空行跳过/坏行 error 标注/单行退化）+ TsvImportPanel 预览确认 + 对话框粘贴分流 + 逐条创建成败汇总。**表格视图当时未做（后按 R78 移除，不再施工）**。验证：解析器 6/6 + tsc 0 错误 + next build 通过；浏览器回归因 IAB 环境连续两轮故障跳过（如实标注未冒充）

- **卡片 49**（R74 ✅，浏览器回归按用户指示跳过）：缺陷指定负责人。后端：Bug.assignee 关系 + FK（ON DELETE SET NULL）+ listBugs/getBug/getBugBoard include + serializeBug 摘要；TDD 先红后绿（关联查询/未指派 null/改派/外键校验）；**抓修双库事故**：migrate dev 生成的迁移误 DROP pgvector 列（Prisma 不感知 raw SQL 列），按 R2 模式在迁移末尾补回 raw SQL 并手工修复两库 + 校验和；两处旧测试因假用户 ID 撞新外键改为真实用户。前端：创建对话框指派下拉（成员加载）、详情页负责人 chip + 改派下拉、卡片负责人头像（未指派虚线 +）、优先级标签中文化。验证：vitest 136/136 + acceptance.sh 14/14 + tsc 双端 0 错误 + next build 通过；**浏览器回归（创建带指派→卡片头像→详情改派）因 IAB 工具连续取消未能执行，用户指示跳过，留待环境恢复后补验**

- v1：Fastify+Prisma(SQLite) 服务、7 MCP 工具、Next.js 单页看板、33 用例绿、浏览器实测通过 → v2 将按步骤 02-08 重构

- v2 预备：core/password.ts（含本轮修复的 promisify 编译错误）、core/jwt.ts、core/tokens.ts 已写好未接线

## 3. 运行日志（每次构建追加一行，最新在下）

| 时间 | 动作 | 验证 | 下一步 |
| --- | --- | :-: | :- |
| R1 | 卡片1+2：schema 切 postgresql 终态（Bug 扩展/Project 归档/原生 tags 数组），删 sqlite 迁移重建 init（10 表）；起 vibehub-test-db 容器(pg16,55432)并 CREATE EXTENSION vector；修 core/password.ts promisify 编译错误；.env 切 pg+3 配置项 | migrate status up to date；users/bugs/projects/notes count=0；tsc 0 错误 | 卡片 3（四模型+vector 列）。**技能治理**：①「起测试库容器」已第 2 次接触，评估后决定不固化技能（命令已常驻 §5，避免双轨）；② vibehub-build 技能无需更新（流程与现实一致）；③ AGENTS.md 已增补数据库连接契约（见 §4） |
| R2 | 卡片3：追加四模型并生成 team_domain_models 迁移；vector 列+hnsw 索引以 migration 末尾 raw SQL 落地（修正 R1 setup 脚本方案）；migrate reset 重放两笔迁移；顺带清 seed（seed.ts + 两个 package.json 的 seed 配置，因阻塞 reset 流水线）；修正 01 文档 §1.3.1 过期 labels 片段 | migrate status up to date；14 表齐全；embeddings.embedding=vector(1536)；Embedding_embedding_idx=hnsw；tsc 0 错误 | 卡片 4 剩余（README 删引导）+ 卡片 5（storage trash）。**技能治理**：① prune 类操作（删 seed/清脚本）两次出现但属一次性工程动作，不固化技能；② vibehub-build 技能第 5 步「验证」可补充一句「migrate reset 前确认 seed 已清」——与本轮教训匹配，已更新技能；③ 无新契约（向量列方案已在 §4 留痕，AGENTS.md 数据契约原文即认可 migration 内 raw SQL，无需改） |
| R3 | 卡片4剩余：README 清 seed 引导（grep=0）；卡片5：trash 路径与 moveToTrash/purgeOlderThan 落地；冒烟发现并修复 mtime 负年龄导致同轮文件漏清的 bug（钳制 ageDays≥0） | 三场景冒烟 ×2 轮全 PASS（purge(0)=1 / purge(30)=0 保留 / 幂 etc）；tsc 0 错误；README seed 残留 0 | 步骤 01 收官，下轮进卡片 6（认证接线，步骤 02）。**技能治理**：① 冒烟脚本模式不固化技能（将被卡片 13 的 vitest 取代）；② vibehub-build 技能已补 R3 教训（tsx -e 的 CJS 陷阱）；③ 无新契约 |
| R4 | 卡片6：认证全链路接线（errors 8 类型/serialize-user/audit/auth service/authenticate 装饰器/routes/index 守卫/config 补齐）；修复 Fastify 装饰器封装不可见问题（改根实例 decorate）；15 项 curl 冒烟全 PASS 后清理冒烟数据恢复空库 | 15 PASS / 0 FAIL（Owner 引导/轮换/重放连带吊销/改密吊销/UsageEvent/无 password_hash）；tsc 0 错误 | 卡片 7（成员管理）。**技能治理**：① 「冒烟脚本模式」第 2 次出现，评估后不单独固化技能（将被卡片 13 vitest 取代），已将冒烟模板写入 vibehub-build；② 技能已补 R4 教训（Fastify 装饰器必须根实例 decorate）；③ 无新契约 |
| R5 | 卡片7：成员管理全链路（users service+route+接线）；修正冒烟对 JWT 角色时效的预期（改角色后需重登）；12 项冒烟 PASS 后清库 | 12 PASS / 0 FAIL；tsc 0 错误 | 卡片 8（守卫收尾+附件归属）。**技能治理**：① 冒烟模式已固化于 vibehub-build 模板，无新技能；② 技能已补 R5 教训（角色变更后重登再验）；③ 无新契约 |
| R6 | 卡片8：附件 uploaded_by 落库+mine 过滤+序列化；守卫核查 8 路由；SSE 改 query.token 鉴权（EventSource 不能带头）+web 最小 token 骨架；14 项冒烟 PASS 后清库 | 14 PASS / 0 FAIL；tsc（前后端）0 错误 | 卡片 9（MCP 四模块）。**技能治理**：① 无新模式；② 技能已补 R6 教训（SSE token 鉴权与冒烟方式）；③ AGENTS.md 已增补 SSE 鉴权契约并登记本章 |
| R7 | 卡片9：MCP 四模块+entry 启动即失败；keyHash 无唯一索引改用 findFirst（密码学碰撞可忽略，免迁移）；16 项模块冒烟 PASS 后清库 | 16 PASS / 0 FAIL；tsc 0 错误；无效密钥 exit=1、local 模式 EOF 优雅退出 | 卡片 10（工具接入+新增 7 工具）。**技能治理**：① 无新模式；② 技能无需更新（无新环境坑）；③ 无新契约（scope 枚举与 Token 经济学参数 03 文档/AGENTS.md 已有） |
| R8 | 卡片10：15 工具矩阵落地（guard 包装/既有 7 整形/新增 8）；补 bug-comments、search service（修 search 路由 Prisma 直连违规）、uploadFromBuffer；stdio 冒烟 16 项 PASS 后清库 | 16 PASS（含 tools/list=15、三类 scope 拒绝、打点、stdout 纯净）；tsc 0 错误 | 卡片 11（SSE 传输）。**技能治理**：① 无新模式；② 技能无需更新；③ 无新契约（工具矩阵与 guard 流程均 03 文档既有） |
| R9 | 卡片11：MCP SSE 传输落地（握手/会话转发/401-404 人话）；context 抽 loadKeyedContext 双传输共用；10 项 SSE 冒烟 PASS 后清库 | 10 PASS / 0 FAIL；tsc 0 错误 | 卡片 12（缺陷域）。**技能治理**：① 无新模式；② 技能已补 R9 SSE 冒烟法；③ AGENTS.md 已补 MCP SSE 端点契约 |
| R10 | 卡片12：缺陷域全落地（状态机/评论流/模板/视图/批量/CSV）；修 BUG_TRANSITIONS 漏边（resolved→open）、PATCH 漏透传 reopen_reason；14 项冒烟 PASS 后清库删 data | 14 PASS / 0 FAIL；tsc 0 错误 | 卡片 13（测试基建）。**技能治理**：① 无新模式；② 技能已补 R10 三条教训（BOM 验字节/冒烟先对路由表/断言不超契约）；③ 无新契约 |
| R11 | 卡片13：测试基建重建（test-db.sh/setup/helpers）+7 文件 88 用例全绿；抓修 4 个真缺陷（tasks assignee/projects 角色守卫/logEvent 竞态/随机密码强度）；登记规划缺口：MCP 密钥 HTTP 管理缺失（加卡片 26） | vitest 88/88 ×2 轮；tsc 0 错误 | 卡片 14（acceptance.sh）。**技能治理**：① 「容器化测试库+TRUNCATE 重置」模式已固化在 scripts/test-db.sh+test-setup，无需技能；② 技能无需更新（本轮教训 logEvent 竞态属代码 review 项，可入 AGENTS.md？——否，属实现细节）；③ AGENTS.md 补一条计量契约：所有 UsageEvent 写入必须 await（禁即发即弃） |
| R12 | 卡片14：acceptance.sh 门禁落地；修复 macOS bash 3.2 全角字符并变量名坑（${VAR} 定界）；破坏性自测验证退出码语义（0/1） | acceptance.sh 14 PASS/0 FAIL、exit 0；破坏副本 exit 1 | 卡片 26（密钥管理）。**技能治理**：① 无新模式（门禁已脚本化）；② 技能已补 R12 两条教训（bash 全角坑/PIPESTATUS）；③ AGENTS.md 已入门禁契约 |
| R13 | 卡片26：MCP 密钥管理全链路；修复 $queryRaw 物理列名坑；acceptance.sh 门禁更新至 99 用例 | acceptance.sh exit 0（99 用例+14 冒烟）；api-keys 11 用例全过 | 卡片 15（前端认证）。**技能治理**：① 无新模式；② 技能已补 R13 教训（raw SQL 物理列名）；③ AGENTS.md 已补密钥生命周期契约 |
| R14 | 卡片15：前端认证全链路（AuthProvider/api 重写/登录页/守卫/占位页）；抓修 redirect() 导出抛错与 static extensions 死循环两个部署级 bug；浏览器回归 6 项全过后 TRUNCATE 清理 | 浏览器 6/6 PASS；tsc/build 0 错误 | 卡片 16（三 Provider+命令面板）。**技能治理**：① 无新模式；② 技能已补 R14 三坑（export redirect/static extensions/RSC 转义误导 grep）；③ AGENTS.md 已补静态导出契约 |
| R15 | 卡片16：三 Provider+壳+双面板；抓修 accessor 闭包/refresh ref 同步/me 响应结构三 bug；12 项浏览器回归全过后 TRUNCATE 清理 | 12/12 PASS；tsc/build 0 错误 | 卡片 17（侧边栏壳）。**技能治理**：① 无新模式；② 技能已补 R15 四坑（忘 build/闭包/响应结构/多进程）；③ AGENTS.md 已补认证响应结构契约 |
| R16 | 卡片17：侧边栏壳全落地（折叠/抽屉/Admin 过滤/持久化/六占位页）；8 项浏览器回归 PASS 后 TRUNCATE 清理 | 8/8 PASS；tsc/build 0 错误 | 卡片 18（看板页）。**技能治理**：① 无新模式；② 技能无需更新（CUA keys 数组形式属外部 API 细节，不入技能）；③ 无新契约 |
| R17 | 卡片18：看板页整页重写全落地；11 项浏览器回归 PASS 后 TRUNCATE 清理 | 11/11 PASS；tsc/build 0 错误 | 卡片 19（文件页）。**技能治理**：① 无新模式；② 技能无需更新；③ 无新契约。**IA 缺口**：随手记无独立路由/卡片，暂登记待排期 |
| R18 | 卡片19：文件页全落地（mine/all/上传三入口/灯箱/TextViewer 重写）；7 项浏览器回归 PASS 后 TRUNCATE 清理 | 7/7 PASS；tsc/build 0 错误 | 卡片 20（任务页+项目页）。**技能治理**：① 无新模式；② 技能无需更新；③ 无新契约 |
| R19 | 卡片20：任务页+项目页落地；抓修 projects 列表裸出模型崩溃（序列化+counts+archived_at）与归档不刷新；7 项浏览器回归 PASS 后 TRUNCATE 清理 | 7/7 PASS；vitest 99 全绿；tsc/build 0 错误 | 卡片 21（密钥页）。**技能治理**：① 无新模式；② 技能无需更新；③ 无新契约（裸出模型为既有契约，本次为第 3 次被抓——建议后续路由加序列化 lint） |
| R20 | 卡片21：密钥页全落地（向导/一次性明文/轮换宽限/撤销/用量图）；6 项浏览器回归 PASS 后 TRUNCATE 清理 | 6/6 PASS；vitest 99 全绿；tsc/build 0 错误 | 卡片 22（成员页+设置页）。**技能治理**：① 无新模式；② 技能无需更新；③ 无新契约 |
| R21 | 卡片22：成员页+设置页落地；后端加 system_settings（注册开关运行时持久化）；6 项浏览器回归 PASS+acceptance exit 0 | 6/6 PASS；vitest 99 全绿 | 卡片 23（容器化）。**技能治理**：① 无新模式；② 技能无需更新；③ 无新契约 |
| R22 | 卡片23：容器化交付物完成（Dockerfile/compose/deploy/entrypoint/README）；镜像构建因本机 Docker Hub 停滞降级为运行时序列模拟（8 项全过） | 序列模拟 8/8 PASS；静态检查 PASS | 卡片 25（四场景总验收）。**技能治理**：① 「起测试库容器」模式已在 scripts/test-db.sh 固化，无需技能；② 技能无需更新；③ 无新契约 |
| R23 | 收官轮：四场景端到端总验收 30/30 全过（场景 A 5/B 9/C 9/D 6）；验收脚本沉淀 scripts/final-acceptance.mjs；双端 build + acceptance.sh exit 0 + 最终浏览器形态确认；停服务清库 | 30/30 PASS；vitest 99 全绿；acceptance exit 0 | **工程完成，停止推进**。**技能治理**：① 「四场景验收脚本」已沉淀为项目资产（非技能——与代码库同生命周期）；② 技能无需更新；③ 无新契约 |
| R24-29 | 健康检查轮 ×6（工程完结后空转）：R24 重建被污染的 §2 看板（27 条条目归位）；R25 修正 §5 停留 R9 时代的矛盾并沉淀健康检查轮约定；R27 深度全扫五项全绿（日志连续/偏差 22 条/25 卡对应/零漂移/无 TODO）；R28-29 最小确认。期间发现并修复 2 处文档腐化（看板重复行、§5 陈旧指令） | R24 全量门禁 4/4 全绿（vitest 99/99 + acceptance exit 0 + 双端 tsc）；R25 轻量门禁 3/3 全绿；R27-29 零漂移继承 | 工程维持完成态；**建议暂停定时任务**。§5 约定：无新卡片时后续轮次无需新增日志行，仅当发现漂移/腐化才记录 |
| R49 | 二期立项（用户指示「安排成后面的任务，定时去完成」）：§2 登记卡片 27-30（Notes 独立页 / 语义检索激活 / 跨进程实时推送 / Docker 单容器真实验收，顺序即执行顺序）；用户提供的 DashScope embedding 配置（text-embedding-v3，dim=1024，OpenAI 兼容模式）落 server/.env 的 8 个 EMBEDDING_* 变量，.env.example 补占位；§4 登记三条（向量列宽 1536→1024、Redis→PG LISTEN/NOTIFY、provider 契约）；AGENTS.md §4 补 embedding provider 契约 | 纯规划轮无代码变更：.env 写入 8 变量；§1/§2/§3/§4/§5 五处自校验一致 | 卡片 27（Notes 独立页面，前端）。**技能治理**：① 立项流程即 §5 既有约定（新需求→§2 建卡→§5 锚点），无需新技能；② vibehub-build 无需更新（流程与现实一致）；③ AGENTS.md 已补 embedding provider 契约（见 §4 第三条） |
| R50 | 卡片 27：随手记独立页全交付。后端 TDD（先写 6 用例观测 RED→最小实现→GREEN）：serializeNote 出 pinned_at、updateNote pinned 开关、listNotes 置顶浮顶（nulls last）+ PATCH 透传；前端 notes/page + NoteWall/NoteCard/NoteComposer 三件（react-markdown 已在依赖）+ Sidebar「随手记 G N」+ ⌘K 面板行；删 v1 ScratchpadWall.tsx（旧 types 依赖）。**用户实时验收附带两修**：①顶栏+侧边栏双 VibeHub（globals.css 媒体查询写反，改为桌面隐藏/移动显示）②Next dev 浮动 N 图标（next.config devIndicators:false，截图为证） | vitest 105/105（红→绿两态均观测）+ web tsc 0 错误 + next build 通过（/notes 导出）+ 浏览器回归 9/9（空态/N 新建+Markdown/置顶浮顶+多置顶倒序/标签筛选/编辑/删除 Toast/G N/⌘K）；QA 数据已 TRUNCATE 后又建 notes-qa 账号供用户查看（下轮清场） | 卡片 28（语义检索）。**技能治理**：① 无新模式（TDD 红绿流程按技能执行，冒烟后清库是既有约定）；② vibehub-build 无需更新；③ 无新契约（置顶语义属卡片实现细节；devIndicators 与品牌显隐为 UI 修正，登记 §4 留痕） |
| R51 | 卡片 28：语义检索激活。TDD 9 用例红→绿（请求形态/base64 解码/维度校验/截断/upsert/cosine 排序）；迁移 dim 1536→1024（**自愈式 raw SQL**：历史库 embedding 列缺失也兼容）；写路径接入+失败隔离+delete 清理；search 增 similar 分区；**真实 DashScope 冒烟通过**（1024 维真向量，语义命中 d=0.24 vs 无关 d=0.62）。抓修：raw SQL 物理列名踩坑（createdAt→created_at，R13 教训复踩一次，已入 AGENTS.md 混合命名注记） | vitest 114/114 + tsc 0 错误 + acceptance.sh 14/14 exit 0（门禁加 EMBEDDING_PROVIDER=none hermetic 覆盖）+ 真实 API 冒烟 PASS | 卡片 29（PG LISTEN/NOTIFY 实时推送）。**技能治理**：① 无新模式；② vibehub-build 无需更新（其 R13 物理列名教训本轮又被验证有效，考虑在教训列表加 embeddings 混合命名实例——否，AGENTS.md 已注记更合适）；③ AGENTS.md §4 已补两条契约：raw SQL 物理列名陷阱（embeddings 混合命名）+ embedding 写路径 await+隔离+测试 hermetic（见 §4 R51 两条登记） |
| R52 | 卡片 29：跨进程实时推送。TDD 6 用例红→绿；events.ts publish 后 pg_notify（异步+失败隔离）；SSE 改独立 pg Client LISTEN 单通道（替代进程内订阅，去重靠单通道本身；error 监听器防炸；失败降级轮询）；装 pg@8.23；**双进程冒烟通过**（独立进程 B 写 bug→SSE 收 bug.created 且 bugId 匹配，600ms 窗口内送达 <1s）；前端 5s 轮询按边界保留 | vitest 120/120 + tsc 0 错误 + acceptance.sh 14/14 exit 0 + 双进程 NOTIFY 冒烟 PASS | 卡片 30（Docker 单容器真实验收）。**技能治理**：① 无新模式（NOTIFY 冒烟的 harness 投递延迟干扰已记 §4，不固化为技能）；② vibehub-build 无需更新；③ AGENTS.md §2 实时推送契约已更新（pg_notify/LISTEN 单通道+失败降级），登记 §4 两条 |
| R53 | 卡片 30（收官）：Docker 单容器真实验收。docker build 成功（1.43GB），抓修 6 处基建 bug（ARG 作用域/.prisma 路径/entrypoint-supervisord 死锁→bootstrap 下沉/DATABASE_URL 运行时拼装/Node 架构按 dpkg 选择/Prisma 引擎目标名 linux-arm64-openssl-3.0.x）+ 1 处产品 bug（上传 multipart 顺序依赖→两段式，TDD 红绿）。容器 healthy、四场景 15/15、重启数据持久+迁移幂等；主机侧 121/121（修 1 flakes：timestamp(3) 同毫秒排序不可区分）+ acceptance 14/14 + **final-acceptance 30/30** | vitest 121/121 + tsc 0 错误 + acceptance.sh 14/14 exit 0 + final-acceptance.mjs 30/30 + 容器四场景 15/15 + 重启持久化 PASS | **工程完工**：29/29 卡（主体 25 + 二期 4）全交付。后续按新需求立项；无新卡片时回归健康检查轮约定。**技能治理**：① 无新模式（Docker 排障过程一次性，教训已入 AGENTS.md §7）；② vibehub-build 无需更新；③ AGENTS.md §7 容器化契约重写（启动序列/DATABASE_URL/架构/binaryTargets/静态路径五条）+ §3 补 multipart 顺序无关契约，见 §4 登记 |

| R54 | 卡片 31+32（用户指示「那给我修复吧」）：31 登录回跳竞态修复——守卫踢回前确认 localStorage 无 token（防登录成功导航与 setUser 赛跑被踢回），契约入 AGENTS.md §6；32 Toast 观察项经浏览器实测为**误报**（styled-jsx 在 App Router 客户端组件实际生效，computed style 与进度条动画均正常），无缺陷关闭 | 卡片 31：tsc 0 错误 + 连续 10 次登录全部落 /notes + 登出踢回/登录（token 清）+ 垃圾 token 深链 3s 踢回不卡死；卡片 32：computed style 实测（fixed/z90/280x42/圆角阴影/countdown 动画运行中）零代码变更 | 无待办，恢复完工态。**技能治理**：① 「只 grep 源码未做运行期验证导致误报」是方法论教训——已记 §4，值得进技能：vibehub-build 补一条「样式/行为类观察必须 computed style 或运行时实测才能定罪」；② vibehub-build 技能已更新该条；③ AGENTS.md §6 守卫竞态契约已补 |

| R63 | 卡片 39 为大组件（新客户端形态）立项，按「先评审后施工」约定执行：方案 A（Chrome 扩展 MV3）vs B（Tauri 托盘）路线选择权归用户 | 评审产出 docs/计划/39-全局截图入口方案.md（推荐 A；截图动作归属修正为系统工具——扩展 captureVisibleTab 截不到其他应用是全屏被测场景的硬伤，而「读剪贴板」路径无此限制）；卡片留「进行中」至用户确认 | vibehub/extension/（未建，待确认后）；无主程序变更 |

| R62 | IAB 浏览器无视口控制 API（setViewportSize/CDP Emulation/execute 均不可用），375px 响应式回归无法直接做 | 同源 iframe 方案：外层 document.write 375px iframe 指向应用——CSS 媒体查询与 JS matchMedia 按 iframe 宽度触发，contentDocument 同源可达可断言；注意外层不能是会 meta-refresh 的路径（根路径会冲掉 wrapper），用 /login 作外层 | 测试方法学；已入 vibehub-build |
| R62 | 触屏文案分支（pointer:coarse）在 iframe 方案中无法运行时触发：matchMedia 覆写晚于 CreateBugDialog 挂载 effect（组件随 board 页挂载即读指针能力，非开对话框时读） | 该分支以产物级验证收口（served chunk 含「点下方按钮选择截图或文件」+ 条件渲染代码审查）；真机触屏验证留待用户实际使用 | CreateBugDialog.tsx；测试覆盖说明 |

| R61 | next dev 代理有 10MB body 上限（`Request body exceeded 10MB for /api/upload`），超限后 proxy ECONNRESET 挂起——>10MB 上传在 dev 环境必卡死（生产无此问题：Fastify 直服 API 不经代理） | 客户端加 XHR 60s 超时兜底（挂起变失败可重试，MustNot 卡死无反馈）；dev 验 >10MB 文件需直连 :3210 或接受降级；CI/生产不受影响 | web/src/lib/api.ts（timeout）；验证方法学 |
| R61 | IAB 浏览器不支持文件选择框（setInputFiles 不可用、file chooser unsupported），粘贴上传回归改用页面内合成 ClipboardEvent+DataTransfer+File 触发（与真实粘贴同路径） | 套路沉淀：`new DataTransfer(); dt.items.add(new File([bytes],name)); dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt}))`；已验证入 vibehub-build | 测试方法学 |

| R60 | 卡片 36 入口位置偏差：锚点写在 board 筛选条，实测新账号无项目时看板整页是空态（无筛选条），「AI 活动」按钮不可达 | 入口移至 (app)/layout 顶栏（Sparkles 图标，与 ⌘K/帮助/主题并列）——AI 活动是系统级功能而非项目级；面板本体不变 | web/src/app/(app)/layout.tsx、board/page.tsx 回退 |
| R60 | AI 活动路由契约：GET /api/activity/recent 刻意全员可读（不挂 requireRole）——特性目的就是让非管理员感知「AI 读了什么」；数据脱敏由 service 层 select 收敛（key_name/key_prefix，禁 keyHash/salt），管理员完整用量仍在密钥页 | 契约居 AGENTS.md §2；测试锁定 member 可读与脱敏键集 | server/src/routes/activity.ts、services/activity.ts、AGENTS.md |
| R60 | 流程：TDD 跑完会残留最后一条用例的数据（resetDb 只在用例前执行），残留 owner 账号会让紧随其后的 QA 注册变成 member、管理类 API 全部 403，一度误判为产品 bug | 「跑 TDD 与 QA 注册」必须分开：先 QA 注册（首个=owner）再跑测试，或测试后 TRUNCATE 再注册；已补进 vibehub-build R57 教训 | 测试/验收方法学 |

| R59 | 注册/登录成功后 `router.replace` 与认证状态更新（setUser）同刻提交，软导航被 React 批处理吞掉——页面停在中转态（token 已写、停在 /login）；R50 首次出现时误判为守卫踢回（R54 修守卫未覆盖此「导航根本不发生」变体），本轮注册路径二次复现后定位 | onSubmit 与「已登录访问 /login」effect 均改 `window.location.replace` 硬导航（静态导出生效下即普通跳转，代价一次全量加载可接受）；R54 的守卫 token 检查保留（覆盖硬导航到达后的 me() 窗口） | web/src/app/(auth)/login/page.tsx；契约入 AGENTS.md §6 |
| R59 | 非管理员对管理入口（MCP 密钥/成员）的处理从「静默隐藏」改为「锁定态可见」：隐藏损害可发现性（用户不知道有这些功能），锁定态 + Lock 图标 + 点击 toast 说明权限，兼顾简洁与引导 | more 组不按角色过滤，渲染时按 adminOnly+角色加锁；简洁模式不变 | web/src/components/layout/Sidebar.tsx |

| R58 | 用户指示统一图标库为 Lucide：原系统混用 emoji（空态/营销位/评论数）与 CSS content 字符（AI 徽章 ✦、语义星尘），跨平台渲染不一致且不可主题化 | 全部替换为 lucide-react 组件（emoji 零残留，grep 验证）；CSS ::before 字符图标上移为 JSX 组件；契约定居 AGENTS.md §6「图标一律 Lucide」 | web 全量组件；无行为变更 |

| R57 | 卡片 34 边界修正：验收要求「无意义查询不出语义分组」，但 cards 28 的 similarEntities 无距离阈值——任何查询都返回最近邻（垃圾查询也出「语义命中」）。原卡片边界写「不改 search service」 | 经评估该阈值属同一特性的必要补全（非改变已定输出结构）：similarEntities 增加 maxDistance 参数（默认 0.5 cosine），globalSearch 透传默认；MCP search 工具同步受益 | server/src/services/embedding.ts、services/search.ts；AGENTS.md §4 补阈值契约 |
| R57 | **config.ts .env 候选路径缺 `server/.env`**（只有仓库根/上两级），与 Prisma 按 schema 旁 .env 加载的约定相悖：非 Docker 环境 EMBEDDING_*/JWT_SECRET 等全部静默丢失——表现为 JWT 每次重启随机（全员掉登录）、语义检索关闭（便签不落向量）、SSE LISTEN 降级 dev.db，且数据库仍可用所以极难察觉 | loadDotEnv 首选候选加 `path.resolve(__dirname, '../.env')`（server/.env）；契约居 AGENTS.md §4「.env 加载契约」 | server/src/config.ts；所有非 Docker 部署/开发环境 |
| R57 | **流程事故**：用户验收数据与测试库同库（vibehub-test-db），本轮全量 vitest 的 resetDb（每用例 TRUNCATE 全表）把用户账号与数据清空，用户被登出 | 流程修复：①用户验收期间禁跑全量 vitest/acceptance.sh（会用其数据即视为可弃）；②已如实告知用户需重新注册（首用户仍为 Owner）；③教训入 vibehub-build（验收数据=用户数据，测试前先确认库归属） | 测试/验收方法学；长期方案：验收库与测试库分离（待立项） |
| R56 | dev server 运行中执行 `next build` 会覆盖其 .next 目录，导致客户端运行时错乱（React 事件全部失灵，表现为 Tab 点击无反应、受控输入不更新），一度误判为产品 bug | 验证命令含 next build 的轮次，build 后必须重启 dev server 再跑浏览器回归；已写入 vibehub-build 教训（R56） | 浏览器回归方法学；无产品代码变更 |

| R55 | 三期立项（用户实测产品后指示「给我定时任务去计划完成以上的任务」）：§2 登记卡片 33-39 七张——33 首启向导+空状态行动化 / 34 ⌘K 语义搜索显性化 / 35 角色化导航简化 / 36 AI 活动可见流 / 37 上传进度+失败重试 / 38 移动端录缺陷路径 / 39 全局截图即录入口（浏览器扩展，先评审后施工）；定时任务 prompt 同步更新（去掉过时「25 卡收官」条款，改为以 §2 为唯一定价来源） | 纯规划轮无代码变更：§1/§2/§3/§5 自校验一致；CronList 确认现有自动化 nextRunAt 在途（runCount 96，持续派发中） | 卡片 33（首启向导）。**技能治理**：① 无新模式；② vibehub-build 无需更新；③ 无新契约（UX 改造以既有前端契约为准） |

| R56 | 卡片 33：首启向导三步（建项目 slug 人话解释→密钥引导→邀请复制链接）+ 空态四要素改造（board/files/tasks/FileGrid/⌘K 全覆盖，干掉 window.prompt）；layout 自动弹+事件唤起、localStorage 防重复 | tsc 0 错误 + next build 通过 + 浏览器回归 6/6（注册自动弹/建项目到第二步/跳密钥页落旗/不重复弹/刷新保持/文件空态按钮跳转）；排障：dev server 被 next build 覆盖 .next 致 React 事件失灵→重启恢复（教训入技能） | 卡片 34（⌘K 语义搜索显性化）。**技能治理**：① 「next build 会覆盖 dev 的 .next」值得固化——已入 vibehub-build 教训；② 技能已更新；③ 无新契约（沿用前端契约） |

| R57 | 卡片 34：⌘K 语义分组落地（✦金色星尘+AI 语义命中+预算预留+空组不渲染）+ 距离阈值 0.5（边界修正，登记 §4）+ config .env 漏 server/.env 真 bug 修复（JWT 随机掉线/语义关闭/SSE 降级三症一因）。**事故**：全量 vitest 的 resetDb 把用户验收数据清空（同库架构代价，已告知用户并记 §4） | TDD 阈值红→绿 + vitest 121/121 + acceptance.sh 14/14 + web tsc/build + 浏览器回归（口语化查询出语义分组/无意义查询无分组+友好空态/登出还原） | 卡片 35（角色化导航简化）。**技能治理**：① 「用户验收期间跑全量 vitest 会清空其数据」值得固化——已入 vibehub-build 教训；② 技能已更新；③ AGENTS.md §4 补 .env 加载契约与语义阈值契约 |

| R58 | 用户直接指示「图标库统一 Lucide」：全库 emoji/字符图标清零——6 处空态（ClipboardList/FolderOpen/ListTodo/StickyNote）、登录页 bento 3 枚（ClipboardList/Bot/RefreshCw）、⌘K 语义星尘（Sparkles）、评论数（MessageCircle）、AI 徽章 ✦（CSS ::before 改 JSX Sparkles ×4 使用点，删 CSS 规则） | tsc 0 错误 + next build 通过 + 浏览器抽查（登录页 bento 3 枚 SVG/四空态页 class 均 lucide-*/⌘K 8 行全 lucide）+ 全库 emoji grep 零残留 | 卡片 35（角色化导航简化）。**技能治理**：① 无新模式；② 技能无需更新；③ AGENTS.md §6 前端契约补「图标一律 Lucide，禁 emoji 与 CSS content 字符图标」 |

| R59 | 卡片 35：导航分 primary/more 两组+「更多」折叠（持久化+路由自动展开）+非管理员锁定态（Lock+toast）+设置页简洁模式开关（nav-prefs 事件同步）。**抓修真 bug**：注册/登录后 router.replace 被认证状态更新的批处理吞掉（R50 后二次复现）→ 硬导航 window.location.replace | tsc 0 错误 + next build 通过 + 浏览器回归 9/9（含 Owner 无锁/Member 锁定/简洁模式刷新保持/注册硬导航） | 卡片 36（AI 活动可见流）。**技能治理**：① 「认证后软导航被批处理吞」二次踩坑，值得固化——已入 vibehub-build；② 技能已更新；③ AGENTS.md §6 前端契约补「认证后导航用硬导航」 |

| R60 | 卡片 36：AI 活动可见流。activity service/路由（TDD 8 红→绿，全员可读+脱敏）+ 右侧滑出面板（顶栏 Sparkles 入口，10s 自刷新）+ api 接线；入口从 board 筛选条移至顶栏（无项目时空态无筛选条，登记 §4）。**排障**：TDD 残留 owner 账号（empty@t.com）导致 QA 注册只能当 member、建密钥 403——R57 教训的姊妹场景，已补「跑 TDD 与 QA 注册的顺序」进技能 | tsc + next build + vitest 129/129 + acceptance.sh 14/14 + 浏览器回归（3 条活动含失败徽章/Esc 关闭/脱敏前缀） | 卡片 37（上传进度与失败重试）。**技能治理**：① R57 教训补充「TDD 残留会让后续 QA 账号降级」；② 技能已更新；③ AGENTS.md §2 补 AI 活动路由契约（见 §4） |

| R61 | 卡片 37：上传进度+失败重试。XHR 单文件（progress+60s 超时）+ use-file-upload 队列（三态/自动消失/单文件重试）+ UploadProgressStrip（scaleX 进度/红框重试/打勾）；files 页与 CreateBugDialog 双接入。抓修：XHR 无超时会永久卡死（next dev 代理 10MB 上限挂起实测）→ ontimeout 60s；文案人话化 | tsc + next build + 浏览器回归（进度采样 0→100→完成/停机失败态+重试按钮+Toast/恢复后重试成功自动消失/C 对话框路径） | 卡片 38（移动端录缺陷路径）。**技能治理**：① 「合成 ClipboardEvent+DataTransfer 测粘贴上传」是可复用套路——IAB 不支持文件选择框，已入 vibehub-build；② 技能已更新；③ AGENTS.md 无新契约（上传属既有 API，进度为纯前端增强） |

| R62 | 卡片 38：移动端录缺陷路径。<900px 顶栏「录缺陷」按钮 + dialog 小屏基座（calc(100vw-2rem)/85vh 滚动）+ 触屏文案分支（pointer:coarse）。排障：IAB 无视口控制 API（setViewportSize/CDP/execute 均不可用）→ 改用同源 375px iframe 方案实测（媒体查询按 iframe 宽度触发）；触屏分支因 matchMedia 覆写时机晚于组件挂载 effect 未跑到，以产物级验证收口（served chunk 含文案字符串） | tsc 0 错误 + next build 通过 + iframe 375px 实测（按钮可见不溢出/对话框 343px 适配/board 空态正常） | 卡片 39（全局截图即录入口——浏览器扩展，先出方案评审记录）。**技能治理**：① 「IAB 无视口 API→同源 iframe 造小屏」值得固化——已入 vibehub-build；② 技能已更新；③ AGENTS.md §6 补移动端入口契约 |

| R63 | 卡片 39 方案评审（按约只出评审不写码）：产出 docs/计划/39-全局截图入口方案.md——推荐 Chrome 扩展（MV3）：截图交给用户系统工具（修正初期「扩展自己截图」设想——captureVisibleTab 截不到其他应用），扩展只做全局快捷键唤起+剪贴板粘贴+⌘Enter 发送，复用现有 upload/bugs API 与 MCP 密钥体系，零数据库接触；manifest/options/commands 权限最小化；已知限制如实列（快捷键仅浏览器运行时有效/分发形态/IAB 无法装扩展）；三个决策点待用户拍板 | 无代码变更（纯评审）；评审文档六节齐全（场景/对比/推荐/边界/限制/决策点） | **等待用户确认方案**（确认后下轮施工：manifest+content script+options 页，验收用真实 Chrome 或 Playwright --load-extension）。**技能治理**：① 无新模式；② 技能无需更新；③ 无新契约（扩展只消费既有 API） |

| R64 | 卡片 40（§4 R57 遗留转正，趁卡片 39 阻塞不空转）：验收库/测试库分离。建 vibehub-dev-db(pg16,55433)+迁移+.env 切换；AGENTS.md §4 双库契约；README/test-db.sh 标注。**生存证明**：dev 库建用户→vitest 129/129→用户幸存→acceptance 14/14→dev 库 users=0 未受影响 | vitest 129/129 + acceptance.sh 14/14 + 生存证明 PASS + tsc/build 无涉及（纯基建+文档） | 卡片 39 仍等用户三决策（扩展路线/快捷键/项目选择）；双库分离后测试与验收互不侵犯，后续轮次可放心跑全量门禁。**技能治理**：① 无新模式；② 技能无需更新（R57 教训已有，本轮是其工程化解法）；③ AGENTS.md 连接契约已改双库条款 |


| | | | |

## 4. 偏差与调整记录（发现 plan 问题必须在此登记，格式：问题→决策→影响）

| 时间 | 问题 | 决策/调整 | 影响范围 |
| --- | --- | --- | --- |
| R1 | 计划文档 §1.3.0 写 pg17/5432/dev，但 pg17 镜像需长时间拉取，本机已有 pgvector/pgvector:pg16 | 用 pg16（00-总览技术栈声明允许 16/17）；容器名 vibehub-test-db、端口 55432、密码 test，与步骤 05 的 scripts/test-db.sh 约定对齐 | 测试库/开发库连接串；部署镜像规格以 03 规范 §2 的 pg17 为准不变（构建时拉取） |
| R1 | core/password.ts（v2 预备模块）util.promisify(scrypt) 不支持 options 参数，tsc 报错阻塞验证门禁 | 改为手动 new Promise 包装 scryptCb（属卡片 6 内容，因阻塞本轮验证提前修） | core/password.ts；卡片 6 接线时直接复用 |
| R1 | Docker 守护进程未运行 | `open -a Docker` 自愈成功（3s 就绪），无需人工介入 | 环境；后续轮次 exec 前先 docker info 探活 |
| R1 | 新增数据库连接事实需要契约定居 | AGENTS.md §4 增补「连接契约」：统一 vibehub-test-db(55432/pg16/test)，.env 与内联 env 优先级说明 | AGENTS.md；后续所有轮次与部署文档 |
| R2 | R1 §4 决策「vector 列走 pgvector-setup.sql 幂等脚本」有误：schema 外加列仍会被 prisma migrate dev 漂移检测发现，反而破坏自动化 | 改为 01 文档 §1.3.2 原方案：raw SQL 追加进 migration 文件末尾（shadow DB 会重放，无漂移）；setup 脚本方案作废 | migrations/20260921165354_team_domain_models/migration.sql；步骤 08 容器 entrypoint 只需 CREATE EXTENSION（migration 负责列与索引） |
| R2 | `prisma migrate reset` 自动触发 seed 命令，seed.ts 失败（tags 语义已变）阻塞验证流水线 | 提前执行卡片 4 的删 seed 部分：删 seed.ts + 清两个 package.json 的 prisma.seed/prisma:seed | 卡片 4 剩余仅 README 删引导；reset 流水线恢复顺畅 |
| R6 | 计划未规定 SSE 鉴权方式；浏览器 EventSource 不支持自定义 Authorization 头，直接挂全局守卫会挡死实时推送 | SSE 路由免 onRequest 守卫，路由内校验 `?token=<access_token>`；契约定居 AGENTS.md 架构章节 | routes/events.ts、index.ts、web use-vibehub.ts；前端 EventSource 调用方式 |
| R10 | 04 文档状态机图 resolved/verified 有回流 open 的虚线边，但首轮实现的 BUG_TRANSITIONS 漏了这两条边（导致 resolved→open 报「不允许」而非「需 reason」） | resolved/verified 均增加 open 与 in_progress 目标；重开仍需 reason | services/bugs.ts 状态机；冒烟 r3a/r3b |
| R11 | RBAC 矩阵测试暴露：projects 路由缺 requireRole，member/viewer 可建项目（违反 00-总览 §3 角色宪法） | POST/PATCH/DELETE /api/projects 挂 requireRole('owner','admin')；测试矩阵按宪法校正 | routes/projects.ts；rbac.test.ts |
| R11 | recordToolCall/auth/users 的 logEvent 用 void 即发即弃，紧随其后的用量查询漏账（竞态） | 统一改 await（logEvent 内部 try-catch 不抛，无性能风险）；契约定居 AGENTS.md 计量条款 | mcp/usage.ts、services/auth.ts、services/users.ts、AGENTS.md |
| R11 | createUserByAdmin 随机一次性密码约 8% 概率为纯字母（base64url 字符集），不满足自家强度策略 | 生成后校验+重采样，兜底拼接 'a1' | services/users.ts |
| R11 | **规划缺口**：MCP 密钥的 HTTP 管理服务/路由完全不存在（密钥只能手工插库），前端密钥页（卡片 21）无 API 可用 | 新增卡片 26：services/api-keys.ts + routes/api-keys.ts（创建一次性明文/列表掩码/轮换/撤销/用量），排在前端卡片 21 之前 | 看板新增卡片 26；商业计划 §4 落地（R13 已收官 ✅） |
| R14 | 路由组冲突：`(auth)/page.tsx` 与根 `page.tsx` 争抢 `/`，且 `redirect()` 在 output:export 预渲染期抛错 | 登录页独立 `/login` 路由；根路径客户端跳转；static 加 extensions:['html'] | web 路由结构、server/src/index.ts 静态托管配置 |
| R15 | `/auth/me` 后端返回扁平 `{...user, stats}`，前端 `api.me()` 期望 `{ user, stats }`——恢复登录态时 `me.user` 为 undefined，user 永远 null，刷新即被守卫踢回登录页 | 路由层拆分为 `{ user, stats }`；契约定居 AGENTS.md 认证响应结构条款 | server/src/routes/auth.ts、AGENTS.md |
| R17 | IA 缺口：随手记（Notes/Scratchpad）在 v2 导航六项中无独立页，v1 的三列视图被拆散后无归属 | 暂登记待排期（候选：看板页右侧折叠栏 或 /notes 路由）；Notes 后端 API 已就绪，前端仅缺入口 | 看板 nav 待增补；不影响后端闭环 |
| R19 | GET /api/projects 裸出 Prisma 模型（camelCase），前端 p.created_at undefined 致渲染崩溃 | 路由层序列化（含 counts/archived_at）；「禁裸出模型」契约第 3 次被抓到，后续考虑加自动化检查 | server/src/routes/projects.ts、core/serialize.ts |
| R22 | Docker 镜像构建在本机无法完成：Docker Hub 网络停滞（pg17 40min 零进度、dockerfile 前端 3KB 卡住、node:22-bookworm-slim 停滞）；Docker Desktop 代理存在但无效 | 基底降为本地已有的 pgvector/pgvector:pg16（ARG PG_IMAGE 可切 pg17；00-总览声明 16/17 均可）；验证降级为「静态检查 + entrypoint 五步序列在真实 pgvector 容器模拟执行」（8 项全过）；镜像构建留待 CI/正常网络执行 | Dockerfile（ARG PG_IMAGE）、deploy/entrypoint.sh |
| R15 | AuthProvider accessor 闭包过期：effect 内 `setAccessToken` 后同一异步流立即 `api.me()`，api 层 getter 闭包捕获旧 render 的 null；catch 分支 refresh 成功后亦未同步 ref | token getter 一律读 `useRef`；refresh 成功后同步 accessTokenRef | web/src/lib/auth.tsx |
| R10 | 「fetch text() 剥离 BOM」一度被误判为导出缺陷 | 服务端字节正确（efbbbf）；改为 arrayBuffer 验字节；教训入 vibehub-build 技能 | 冒烟方法论；无产品代码变更 |
| R2 | 01 文档 §1.3.1 的 labels 片段仍是 JSON 字符串旧写法，与 §1.3.0/R1 落地事实矛盾 | 片段改为 `String[]` 并注明升级来源 | 01 文档自洽；后续读文档不会误解 |
| R8 | 03 文档 §3.2 工具矩阵算术错误：「13 号含两个工具函数名，合计 14 个可调用工具」——实际 7 既有 + 8 新增 = **15** 个工具名 | 按矩阵全量实现 15 个（list_tasks 与 update_task 各为独立工具）；文档措辞待修正 | mcp/server.ts TOOL_NAMES=15；验收以 15 为准 |
| R8 | routes/search.ts 直连 Prisma，违反架构契约（v1 遗留） | 抽取 services/search.ts，路由改调 service | 架构合规；MCP search 工具复用同一 service |
| R49 | 用户配置的 embedding 模型为 text-embedding-v3（dim=1024），与 schema/migration 既有的 vector(1536) 列宽不一致 | 卡片 28 新增迁移将列宽改为 vector(1024) 并重建 HNSW 索引（表无存量数据，ALTER 安全）；Embedding.dim 默认值改 1024 | 新迁移文件；Embedding 模型默认值；搜索维度以 EMBEDDING_DIM 为准 |
| R49 | 00-总览提实时推送兜底方案为 Redis，但单机单容器定位下引 Redis 需在 supervisord 增第三个进程、违背「单容器从简」哲学 | 卡片 29 改用 PG LISTEN/NOTIFY（同库内跨进程推送，零新组件）；未来多机部署再上 Redis | 卡片 29 实现方案；deploy/supervisord.conf 不变（仍两进程） |
| R49 | 新增 embedding provider 配置契约（provider 枚举/密钥管理）需契约定居 | AGENTS.md §4 数据契约补：EMBEDDING_PROVIDER=none\|dashscope；dashscope=OpenAI 兼容模式（/compatible-mode/v1）；密钥只进 .env 与环境变量，禁落任何文档 | server/config.ts（卡片 28 接线时）；AGENTS.md；.env/.env.example |
| R50 | 用户浏览器实测发现桌面端顶栏与侧边栏同时渲染 VibeHub 品牌（双品牌）：globals.css 把顶栏品牌的 display:none 写进了移动端媒体查询，语义写反 | 基座规则默认隐藏 .vh-topbar-brand，仅移动端显示（侧边栏是抽屉，顶栏需要品牌占位）；layout.tsx 注释同步修正 | web globals.css、(app)/layout.tsx；纯视觉修正无契约变更 |
| R50 | 用户要求隐藏左下角浮动圆形 N 图标（Next.js 开发指示标，dev 模式注入） | next.config.ts 加 devIndicators: false（15.2+ 支持）；生产构建本就不含该指示标 | web/next.config.ts；仅 dev 模式 |
| R50 | 既有缺陷观察（不在本轮修，待排期）：①登录成功（token 已落 localStorage）后登录页未自动执行 redirect 回跳，需手动导航；R15 曾测过该路径。②.vh-toast-stack/.vh-toast 在 globals.css 无任何定义，Toast 实为文档流块而非浮层（底部占位、无动画类生效），R21/R22 测试只验证了文案未验证形态 | 均登记待排期：① 排查 login 页 router.replace 竞态；② 补 toast 定位/堆叠/进度条样式。两项建议各立一张轻量卡片 | (auth)/login/page.tsx 嫌疑；globals.css、lib/toast.tsx |
| R51 | 测试库历史漂移：`prisma migrate dev` 生成新迁移时发现 embeddings 表根本没有 embedding 列（2026-09-21 的 team_domain_models 迁移文件内有 ADD COLUMN raw SQL，但本库未生效，疑似中途 reset/重放异常） | 新迁移 `20260922113638_embedding_dim_1024` 改为**自愈式** raw SQL：ADD COLUMN IF NOT EXISTS vector(1024) + DROP INDEX + ALTER TYPE + 重建 hnsw——fresh install（1536→1024）与漂移库（缺列直建）两路径均安全；本库手动补执行一致 SQL | 新迁移文件；entrypoint 的 migrate deploy 在新库自动受益；未来再改维度必须清空 embeddings（pgvector 非空表禁改列宽，已写入迁移注释） |
| R51 | embedding 写路径需要「await 但失败不炸主流程」的语义，且测试/门禁不能打外网——与既有「UsageEvent 必须 await」同族但多一层隔离，属新契约 | AGENTS.md §4 补「embedding 写路径契约」：create/update 后 await upsertEntityEmbedding（内部 try-catch 隔离）、delete 同步清理；测试与 acceptance.sh 强制 EMBEDDING_PROVIDER=none，客户端单测 vi.mock 开启态 | test-setup.ts、scripts/acceptance.sh、services/embedding.ts、AGENTS.md |
| R51 | raw SQL 物理列名坑复踩：embeddings 表混合命名——entityType/entityId/model/dim/embedding 是 camelCase 物理名，created_at/updated_at 才是 snake_case（Prisma @map 只映射了这两个） | AGENTS.md §4 向量条目内加「raw SQL 物理列名陷阱」注记（写裸 SQL 前 \d 表名 核对） | AGENTS.md；后续所有 embeddings 裸 SQL |
| R51 | search.ts 的 notes 关键词结果漏序列化 tagList（⌘K/MCP 搜出的便签无标签），顺手修正 | notes 结果统一 serializeNote({...n, tagList: parseTags(n.tags)}) | services/search.ts；⌘K/MCP search 便签条目现带标签 |
| R52 | 卡片 29 需要独立连接执行 LISTEN（Prisma 池不支持），pg 包此前未装（Prisma 6 用自带引擎不依赖 pg） | npm install pg @types/pg 成功（8.23.0，网络可用）；pg Client 仅用于 SSE LISTEN 与测试，业务池仍走 Prisma | server/package.json 依赖；部署镜像构建时会随 npm ci 安装 |
| R52 | SSE 由「进程内 eventBus 订阅」改为「pg Client LISTEN 单通道」——同进程写入现在也经 PG 绕行（微增延迟） | 单通道换取跨进程统一（MCP stdio 写入 <1s 可达）+ 天然去重；失败降级轮询兜底；pg Client error 监听器为强制约定 | routes/events.ts、core/events.ts；契约已入 AGENTS.md §2 实时推送条款 |
| R52 | 冒烟精确延迟测量受 harness 自身投递延迟干扰（writer 文件时间戳 vs SSE 读取时刻出现 -275ms 倒挂） | 验收口径改为「事件在 writer 600ms 退出窗口内送达」即 <1s 达标；倒挂系管道/文件写投递慢于 pg_notify（快于 instrumentation），非通道慢 | 冒烟方法学记录；无产品代码变更 |
| R53 | Dockerfile `ARG PG_IMAGE` 声明于第三个 FROM 之后，作用域归属前一 stage，`FROM ${PG_IMAGE}` 展开为空，build 直接失败（R22 从未构建成功故潜藏至今） | ARG 提至文件首部（全局作用域），FROM 只能消费全局 ARG | Dockerfile；所有后续构建 |
| R53 | workspaces 依赖提升到根 node_modules，`.prisma` 在 `/app/node_modules/.prisma` 而非 `server/node_modules/.prisma`，COPY 失败 | COPY 源改根路径并注释原因 | Dockerfile |
| R53 | **entrypoint/supervisord 启动死锁**：entrypoint 五步序列里「等 PG 就绪」先于「exec supervisord」，而 PG 恰由 supervisord 管理——PG 永远不起，60s 超时后建扩展失败容器退出（R22 的「序列模拟」未覆盖此依赖倒置） | 等待/建扩展/迁移下沉到 server/src/bootstrap.ts（supervisord vibehub 程序命令改为 node dist/bootstrap.js）；entrypoint 精简为只 exec supervisord；契约入 AGENTS.md §7 | Dockerfile、deploy/supervisord.conf、deploy/entrypoint.sh、server/src/bootstrap.ts |
| R53 | 镜像内无 DATABASE_URL（Dockerfile ENV 构建期展开拿不到 docker run -e 注入的密码），prisma migrate deploy 报 Environment variable not found | entrypoint 运行时用 POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB 拼装 export，supervisord 子进程继承 | deploy/entrypoint.sh |
| R53 | Node tarball 写死 linux-x64：Apple Silicon 上 pgvector 基底是 arm64，Rosetta 报 "failed to open elf" SIGTRAP，vibehub 进程反复重启 | 按 dpkg --print-architecture 选 x64/arm64；x86 构建机不受影响 | Dockerfile |
| R53 | Prisma 查询引擎运行期找不到：生成的是 openssl-1.1.x/debian-*（x86_64 命名），运行时要 linux-arm64-openssl-3.0.x | schema generator binaryTargets = ["native", "linux-arm64-openssl-3.0.x"]；debian-openssl-3.0.x 是 x86_64 目标名勿混用 | schema.prisma；M 系 Mac 构建必含 |
| R53 | **产品 bug（容器 curl 实测抓到）**：`/api/upload` 按 multipart 到达顺序处理，文件 part 先于 project_id 字段即抛「缺少 project_id」——curl -F 默认顺序必踩，前端碰巧字段在前所以一直没暴露 | 两段式重写（遍历落盘+收集，字段齐后建记录）+ TDD 回归用例（文件在前的顺序）；契约「multipart 上传顺序无关」入 AGENTS.md §3 | server/src/routes/attachments.ts、api.test.ts |
| R54 | 卡片 31 登录回跳：登录成功（tokens 已写 localStorage）后偶发停在 /login。根因是守卫竞态：click handler 的 router.replace 先于 React 上下文提交触发导航，(app)/layout 守卫读到旧上下文 user=null 即踢回，与 setUser 效果赛跑；10 次浏览器复现未稳定重现（窗口窄）但代码路径确定 | 守卫踢回前检查 localStorage token：有 token 视为登录中/恢复中等待，不踢回；失效 token 由启动流程清理后自然踢回（登出与垃圾 token 两条回归验证不卡死）；契约入 AGENTS.md §6 | web/src/app/(app)/layout.tsx |
| R54 | **R50 §4「Toast 无 CSS」观察项为误报**：样式实写在 toast.tsx 的 `<style jsx global>`，styled-jsx 在 App Router 客户端组件中生效；R50 仅 grep globals.css 未见定义即定罪，未做运行期验证。教训：样式/行为类「缺陷」必须 computed style 或浏览器实测后才能登记 §4 | 更正本条观察项为无缺陷；方法论教训同步进 vibehub-build 技能（观察项登记前必须运行期实证） | docs/计划/PROGRESS.md §4 更正；vibehub-build SKILL.md |

| R53 | notes 置顶排序测试 flakes：三条便签同毫秒创建（timestamp(3) 毫秒精度）导致 createdAt 相同、ORDER BY 不确定 | 测试创建间加 15ms 间隔确保时间戳可区分（非产品缺陷：排序契约在时间戳可区分时成立） | services/notes.test.ts |
| R76 | 附件 public_url 双重失效：`/raw` 挂登录守卫而 `<img>` 带不了 Bearer（401）；且上传入口用落盘 ID 拼 publicUrl、createAttachment 另生成记录 ID（带令牌也 404）。R6 守卫核查只验「无令牌 401」，历次浏览器回归未断言图片真正加载 | 签名链接（序列化层按记录 ID 签发，12h 分桶）+ raw 拆出守卫「签名或 Bearer」+ 用户内容安全头；createAttachment 支持传入落盘 ID，存量错误 publicUrl 由序列化层纠正 | server/src/core/asset-sign.ts、serialize.ts、routes/attachments.ts、services/attachments.ts；AGENTS.md §2 |
| R76 | 刷新令牌「已轮换即重放」与前端无单飞/无跨标签同步叠加：并发 401 或多标签在 access 过期后各自刷新 → 后到者触发整族吊销 → 周期性掉线；刷新遇网络错误亦直接登出；启动恢复流程二次刷新 | 服务端 10s 宽限（令牌族存活才放行）+ 登出吊销整族；前端 lib/token-refresh.ts 协调器（单飞/采用/Web Locks/15s 超时），删除 api.refresh 直调入口 | server/src/services/auth.ts、web/src/lib/{token-refresh,api,auth}；AGENTS.md §3/§6 |
| R76 | AGENTS.md「撤销即时生效」对 SSE 长连接不成立（握手后上下文缓存，含轮换宽限到期）；移除成员后其密钥 createdBy 置空仍有效 | guard 对 store 上下文每次按 ID 复核（含创建人状态，禁用可逆）；removeUser 同事务吊销其密钥 | server/src/mcp/context.ts、guard.ts、services/users.ts；AGENTS.md §5 |
| R76 | resolveProject 按 MCP 服务进程 cwd 猜项目 + 回落最近更新项目：容器/SSE 下必然猜错，AI 写入静默落错项目；README「自动按当前工作目录匹配」在交付形态下不成立 | 仅唯一进行中项目自动选择，否则 VALIDATION_ERROR 列出可选 slug；工具描述与 README 同步 | server/src/services/projects.ts、mcp/server.ts、README；AGENTS.md §5 |
| R76 | 测试基建两处陈旧：final-acceptance.mjs 子进程 cwd 用 URL.pathname（中文路径被百分号编码 → spawn ENOENT，且指向 scripts/ 而非 server/）；test-db.sh / dev-db.sh 对「已存在但停止」的容器走 docker run 重名失败（Docker 重启后门禁第 1 步必挂） | fileURLToPath 解码并指向 server/；起库脚本增加 docker start 分支、名称精确匹配 | server/scripts/final-acceptance.mjs、test-db.sh、dev-db.sh |
| R76 | 评审其余发现未立项（待用户决策优先级）：拖拽等非文本修改也同步调 DashScope 且无超时；每个 SSE 标签页独占一条 PG 连接、`?token=` 进访问日志；API Key rate_limit 只存不执行、登录无防暴力；AGENTS/README 用例数与工具数漂移；无 ESLint/E2E | 仅登记不施工；用户确认后再入 §2 待办 | 见本条 |
| R77 | 卡片 39 方案（R63）称扩展「复用 MCP 密钥、只消费现有 REST、零后端改动」；实测 REST 守卫只认登录 JWT（`vhk_` 调 `/api/bugs`、`/api/upload` 均 401 INVALID_TOKEN） | 卡片 39 砍（R78 进一步彻底删除，评审文档一并移除，不设重开条件） | docs/计划/39（已删）；§2 看板 |
| R77 | 新功能持续堆叠而核心闭环未经真实使用（R76 两个 P0 潜伏约 70 轮；验收库 0 缺陷、0 次 MCP 调用） | 范围冻结 + 10 个工作日真实试用（docs/计划/09，含可量化达标标准与解冻规则）；卡片 51 冻结；§2 改为冻结期清单 F0–F8；§6 增第 13 条（R78 已把卡片 51/39 从冻结/砍改为彻底删除） | 全部后续施工轮；AGENTS.md §0 当前阶段 |
| R78 | 用户决定卡片 51（看板表格视图）与卡片 39（全局截图入口）**彻底删除**，不留冻结/重开路径 | 删除 `docs/计划/39-全局截图入口方案.md`；§2 冻结区+已砍两份表合并为「已移除」；清理 AGENTS.md §0、`09` §2/§5、`07` §7.10 列表视图行、§2 顶部状态与 §5 起点指令；历史日志行保留原样（史实），仅新增本行登记 | AGENTS.md、docs/计划/{09,07,PROGRESS}.md；无代码变更 |
| R78 | 浏览器回归长期挂账（R74/R75 因 IAB 环境故障连续跳过，卡片 49 指派与卡片 50 TSV 速录从未做过浏览器级验证） | 引入 `@playwright/test` 作为 devDependency 并接入门禁：核心闭环 1 条 + 补验 2 条（指派 / TSV 速录），全部 headless 实测通过；`acceptance.sh` 增 5/6 步（清测试库 → 产物新鲜度检查 → 起 E2E 服务 → 传 DATABASE_URL → 跑 Playwright）；F1/F3 卡片验收方式由「IAB 人工回归」改为「E2E 自动断言」 | server/tests/e2e/、playwright.config.ts、acceptance.sh、package.json；AGENTS.md §8 门禁表述 |
| R78 | 新错误码与两条新契约需契约定居 | AGENTS.md §3 增「登录防暴力契约」+ 错误码枚举补 `RATE_LIMITED`；§5 工具数 14→15（与代码 TOOLS 一致）；§8 门禁去硬编码用例数（改为以脚本当次输出为准） | AGENTS.md；server/src/core/errors.ts、services/login-throttle.ts |

---

## 5. 给下一次运行的起点指令（最重要，结束时必须更新）

```
状态：🧊 试用冻结期（R77 起，见 docs/计划/09）：新功能冻结；卡片 51 / 39 已按 R78 彻底删除；R76/R77/R78 在分支 fix/p0-review 待用户合并
下一步：先查 F0（验收库 trial 标签未关闭缺陷，有则优先处理）；无则执行 §2 冻结期清单最上方未完成项（当前为 F1 补验）
前置：仓库已纳入 git（main=R75 基线；fix/p0-review=R76/R77/R78，待用户合并）——每轮结束按 AGENTS.md §10 提交；
      测试库 vibehub-test-db(55432)；dev 库 vibehub-dev-db(55433) 承载用户真实数据与试用数据（勿 TRUNCATE、勿写测试数据）；
      起库脚本可自动拉起已停止的容器；服务已在跑（后端 :3210 连验收库、前端 dev :3211）；浏览器回归统一走 Playwright E2E（`tests/e2e/`，经 acceptance.sh 第 5 步），不再依赖不稳定的 IAB
加载顺序：vibehub-build 技能 → vibehub/AGENTS.md → docs/计划/09（冻结范围）→ 对应卡片的归属文档
F0 查询（只读）：docker exec vibehub-dev-db psql -U vibehub -d vibehub -c
      "SELECT id, title, status FROM bugs WHERE 'trial' = ANY(labels) AND status IN ('open','in_progress') ORDER BY created_at"
边界：冻结期禁止新功能（新增用户可见功能/入口/配置项即算）；新想法只登记 §4「试用后评审」
R76 须知：附件图片只用 serializeAttachment 返回的签名 public_url（禁自拼 /raw）；刷新令牌只能经 lib/token-refresh.ts；
      MCP 工具多项目时必须传 project_slug；MCP stdio 子进程必须显式传 DATABASE_URL（否则继承 server/.env 的 dev 库）
```

## 6. 防跑偏规则（每次运行遵守）

1. **单轮单卡片**：每轮只推进 §2 看板中「待办」最上方 1-2 张卡片，禁止跳步。
2. **先验证再记录**：每轮结束前必须跑该步骤的「验证命令」；失败则本轮不算完成，卡片留在进行中并把失败输出写进 §3。
3. **只按计划文档施工**：计划/规范没写的功能不做；有新想法→登记 §4，下轮评审后再做。
4. **文档可修订但必须留痕**：计划文档与现实冲突时，可以改文档，但必须在 §4 记录「原文→改后→原因」。
5. **连续两轮同一卡片失败**：标记阻塞，停止推进新卡片，在 §3 写明阻塞原因与所需人工决策。
6. **环境自愈**：库容器没了就按 §5 前置重建；不要因为环境问题空转。
7. **禁止演示数据**：任何轮次不得创建 seed/演示数据（用户明确要求）。
8. **每轮结束必更 §5**：下一次运行的起点指令必须与 §1 当前状态一致，这是防跑偏的关键锚点。
9. **开局自校验**：每轮开始先核对 §1、§2、§3、§5 是否互相矛盾；矛盾时以 §3 最近一条日志 + 磁盘实际代码为准修正，并在 §3 记一行「修正了什么」。
10. **卡片可续做**：一张卡片可以跨多轮完成；每轮日志写清本轮做到哪一半，下一轮从一半处继续，不推倒重来。
11. **技能治理（每轮必做）**：收尾时三问——本轮是否出现值得做成技能的重复工作流？已有技能是否与现实不符需更新？是否产生新契约需进 AGENTS.md？结论写入 §3 日志行末。技能放 `~/.zcode/skills/<name>/`，必须与文档保持一致（双轨制禁止）。
12. **加载顺序固定**：每轮开始 = 读本文件 → 按需加载技能（vibehub-build 默认；TDD/verification/debugging 按场景）→ 读 AGENTS.md 契约 → 读当前步骤文档 → 动手。
13. **冻结期规则（R77 起，`docs/计划/09` 生效期间）**：禁止新功能卡（新增用户可见功能/入口/配置项即算）；每轮先查验收库 `trial` 标签未关闭缺陷（F0），有则优先；新想法只登记 §4「试用后评审」；试用指标用 `bash server/scripts/trial-metrics.sh <起始日期>`（只读）。**浏览器回归一律用 Playwright E2E**（`server/tests/e2e/`，`npx playwright test -c playwright.config.ts`；须空测试库 + 显式 DATABASE_URL），不再使用 IAB 人工回归。
14. **E2E 前置**（R78 起）：E2E 必须跑在空测试库上（首位注册用户才是 Owner）；MCP stdio 子进程必须显式传与 HTTP 服务相同的 `DATABASE_URL`；断言工具结果时要检查 `isError`（协议层成功 ≠ 业务成功）。
| R71 | 规范/00 的组件动效规格止于 §2.9（v1 组件），二/三期新组件（首启向导/AI 活动面板/上传进度条/更多折叠）无动效契约，前端合入自查缺依据 | 追加 §2.10-2.13 四节（到帧规格：箭头旋转/滑出 transform/进度 scaleX/锁定态 opacity）+ §7 自查补「禁 emoji」项；属规范修订，留痕于此 | docs/规范/00；后续前端轮次自查依据 |

| R70 | 07 规格文档止于 7.10（v1 六页），二/三期页面（随手记/首启向导/AI 活动/上传进度/角色导航）无规格契约，后续轮次"按计划施工"失去依据 | 07 追加 §7.11-7.15 五节 as-built 规格（布局/交互/契约要点，均标注实现轮次）；属计划文档修订，留痕于此 | docs/计划/07；后续页面迭代以 7.11+ 为契约 |
| R74 | 给 Prisma 模型新增关系（Bug.assignee）时，`migrate dev` 生成的迁移会把 raw SQL 追加的 pgvector 列判定为「多余」而 DROP（shadow 库 schema 无该列）；且改动已应用的迁移文件会使两库校验和失配 | 修复三件套：① 迁移末尾按 R2 模式补回 raw SQL（ADD COLUMN IF NOT EXISTS + 索引）② dev/test 两库手工执行相同 SQL ③ 用新文件 sha256 更新两库 _prisma_migrations.checksum；教训入 vibehub-build 技能 | prisma/migrations/20260923004726_bug_assignee_relation/migration.sql；schema 关系变更流程 |
| R74 | 卡片 49 的浏览器回归（创建带指派→卡片头像→详情改派）因 IAB 浏览器工具连续取消无法执行，用户指示跳过 | 不冒充通过：后端/tsc/build 全绿登记为完成证据，浏览器回归标注「留待环境恢复后补验」；QA 数据已清理（保留用户自有账号） | 卡片 49 完成度记录 |

| R75 | 卡片 50 的浏览器回归因 IAB 环境故障（标签停留 RSC 原始载荷、水合多轮不完成，换 token/新标签均无效）连续第二轮跳过；另发现卡片 48（R74 已完成）当时遗漏未从待办区归档 | 沿用 R74 约定：可验证项（解析器/tsc/build）全绿登记，浏览器回归如实标注「环境跳过、留待补验」；卡片 48 本条补归档 | 驾驶舱记账修正；补验队列（卡片 49、50 浏览器回归） |

| R70 | 本地留存 vibehub:1.0/1.1 镜像带 R69 安全漏洞（SSE scope 绕过），误分发风险 | 删除两个 tag，仅留 vibehub:1.2（修复版）；README/文档无旧 tag 引用（compose 走源码构建不受影响） | 本地 Docker 镜像库 |

| R69 | **安全级 bug（容器验收实战抓到）**：SSE 传输下 MCP 工具上下文每次调用单独 resolveMcpContext()，HTTP 服务进程没有 VIBEHUB_API_KEY 环境变量 → 全部落到 local 全权上下文：① scope 校验被静默绕过（仅 context:read 的密钥可调 update_bug_status 等写操作）② 用量打点 api_key_id 为 NULL（D6 失败暴露）。stdio 模式不受影响（进程有 env 密钥），故 R9 冒烟与 R23 总验收均未发现 | 新增 mcp/context-store.ts（AsyncLocalStorage）：SSE 握手 keyed ctx 存入 store，/mcp/messages 处理在 store 内 run；guard 优先 store、回落 env。TDD 4 用例锁死行为；容器 SSE 全量验收 30/30 回归；契约「上下文一律经 mcpStore 传递，禁止 HTTP 进程逐调用 resolveMcpContext」入 AGENTS.md §5 | server/src/mcp/context-store.ts、guard.ts、routes/mcp-sse.ts；镜像重建为 vibehub:1.2 |

| R66 | final-acceptance.mjs 的 MCP 子进程硬编码 `DATABASE_URL=55432`（单库时代产物），R64 双库分离后与 HTTP 服务不同库：密钥建于 dev 库、stdio 子进程查 test 库→无效密钥 exit 1→initialize 20s 超时 | 脚本改为从 server/.env 派生连接串（`ACCEPTANCE_DATABASE_URL` 可覆盖），头注注明双库前提；教训同源问题（架构变更后排查所有硬编码连接串的脚本/文档）入 vibehub-build | server/scripts/final-acceptance.mjs |

| R65 | 卡片 41（卡片 39 仍阻塞，继续不空转）：验收库卷持久化。dev-db 重建挂命名卷 vibehub-dev-pg（原无卷，删容器丢全部数据——与 R64 双库分离配套的最后一块短板）+ dev-db.sh 管理脚本 + README/AGENTS.md 同步。**容器重启证明**：restart 后数据不变；端到端注册/建项目往返通过 | docker restart 后 projects 1→1 + API 健康 + 注册往返 201 | 卡片 39 仍等用户三决策；环境加固完成（双库+卷），后续无已知基建短板。**技能治理**：① 无新模式；② 技能无需更新；③ AGENTS.md 连接契约已同步卷条款 |

| R66 | 回归轮（卡片 39 仍阻塞）：跑权威四场景 final-acceptance.mjs——**抓到并修复脚本陈旧**：MCP 子进程硬编码测试库 55432，双库分离（R64）后与 HTTP 服务（dev 55433）不同库，密钥查无→stdio 启动即退→initialize 超时（一度疑为产品回归，实为测试基建与架构脱节）；修为从 server/.env 派生 DATABASE_URL（ACCEPTANCE_DATABASE_URL 可覆盖） | 修复后 30 PASS / 0 FAIL（场景 A5/B9/C9/D6）——确认二/三期全部改动（置顶/语义/实时推送/导航/上传/移动端）未回归核心链路 | 卡片 39 仍等用户三决策；核心链路回归基线刷新为 30/30。**技能治理**：① 「多库/多进程架构变更后必须排查硬编码连接串的既有脚本」值得固化——已入 vibehub-build；② 技能已更新；③ 无新契约（脚本修复，头注已说明双库前提） |

| R67 | 卡片 42（卡片 39 仍阻塞）：交付镜像刷新——R53 的 1.0 镜像落后于二/三期全部代码，重建 vibehub:1.1（0 错误）；容器冒烟 8 项全过（healthy/健康/注册/建项目/建缺陷+看板/校验 400/MCP SSE 401/静态页）；镜像留存冒烟容器已删 | docker build exit 0 + 容器 8 项冒烟 PASS | 卡片 39 仍等用户三决策；交付物（镜像/契约/文档）与代码基线已对齐。**技能治理**：① 无新模式；② 技能无需更新；③ 无新契约 |

| R68 | 卡片 43（卡片 39 仍阻塞）：README 全面刷新。事实核对（15 工具/14 业务表/129 用例/36 路由）后：功能总览补齐二/三期六项能力（陈旧表述 grep 清零）、项目结构补 scripts/bootstrap/新目录、测试段更新为 129 用例+四场景 30 项+门禁三连、路线图去重（Redis/语义/SSE 归位「已交付」）、环境变量补 EMBEDDING_* 与双库引导 | grep 陈旧表述 0 残留 + 数字核对一致 | 卡片 39 仍等用户三决策。**技能治理**：① 无新模式；② 技能无需更新；③ 无新契约 |

| R69 | 卡片 44：容器全量验收（首跑 29/30）→ 抓到**安全级 bug**（SSE scope 校验静默绕过+用量不归属，stdio 不受影响故此前的冒烟/总验收都没发现）→ mcpStore(ALS) 修复 + TDD 4 红→绿 → 重建 vibehub:1.2 → 容器 SSE 四场景 **30/30**（D6 total=8） | vitest 133/133 + acceptance.sh 14/14 + 容器 SSE 30/30 + tsc 0 错误 | 卡片 39 仍等用户三决策；**安全修复已同步镜像 1.2，旧 1.0/1.1 镜像不应再分发**。**技能治理**：① 「权威验收要跑在交付形态上（容器+IDE 同款 SSE 传输）」——stdio 冒烟覆盖不到 HTTP 进程的上下文缺陷，值得固化——已入 vibehub-build；② 技能已更新；③ AGENTS.md §5 MCP 契约已补上下文传递条款 |

| R70 | 卡片 45+46（卡片 39 仍阻塞）：交付物清理（删除带 R69 漏洞的 1.0/1.1 镜像，仅留 1.2）+ 步骤 07 规格补齐（§7.11-7.15：随手记/首启向导/AI 活动/上传进度/角色导航与移动端，原先止于 7.10） | docker images 仅剩 1.2；07 文档五节齐（文档修订已登记 §4） | 卡片 39 仍等用户三决策。**技能治理**：① 无新模式；② 技能无需更新；③ 无新契约（07 为既有计划文档补齐） |

| R71 | 卡片 47（卡片 39 仍阻塞）：规范/00 补齐二/三期新组件动效规格——§2.10 首启向导 / §2.11 AI 活动滑出面板（transform only）/ §2.12 上传进度（scaleX）/ §2.13 更多折叠与锁定态；§7 自查补「禁 emoji」项 | 文档四节齐 + §4 留痕；三层文档（计划 07/规范 00/AGENTS.md）现已覆盖全部已建组件 | 卡片 39 仍等用户三决策。**技能治理**：① 无新模式；② 技能无需更新；③ 无新契约（规格文档补齐） |

| R72 | 收官审计（卡片 39 仍阻塞）：全部门禁一次性复核——tsc 双端 0 错误 + vitest 133/133 + acceptance.sh 14/14 exit 0 + api/web 健康 200 + 双库容器在跑 + 看板核对（待办 0/进行中 1=卡片39/已完成 42）+ §4 登记 45 条全部有归宿；§1 改写为发布态候选结论 | 审计全绿，无新发现问题 | 卡片 39 三决策；候选：git 仓库初始化（等用户发话）。**技能治理**：① 无新模式；② 技能无需更新；③ 无新契约 |

| R73 | 卫生轮（卡片 39 仍阻塞）：清理 R62 测试上传残留（server/data/attachments 16K→空）+ 根目录 v1 时代 data/ 孤儿残留（44K，test-*.log 与早已 truncate 的附件，rm -rf data）；新增根 .gitignore（覆盖 data/ 与 server/data/ 双路径）（依赖/产物/**.env 密钥禁提交**/数据目录/系统噪声——开源分发前置卫生，不初始化 git，等用户决策）；删根 .DS_Store | 数据目录三件套清空；.gitignore 六类覆盖 | 卡片 39 三决策 + git 初始化候选（等用户发话）。**技能治理**：① 无新模式；② 技能无需更新；③ 无新契约（.gitignore 已是 AGENTS.md「密钥只进 .env」的执行层） |

| R74 | 卡片 49（用户实测反馈「bug 要能指定负责人」）：后端 assignee 关系+FK+include+序列化（TDD 红绿）；**抓到并修复双库事故**——migrate dev 误 DROP pgvector 列（Prisma 不感知 raw SQL 追加列），按 R2 模式迁移末尾补 raw SQL + 两库手工修复 + 校验和更正；旧测试假用户 ID 撞 FK 改真实用户；vitest 136/136 + acceptance 14/14；前端创建下拉/详情改派/卡片头像三处接线 + tsc + build 通过；**浏览器回归因 IAB 工具连续取消，用户指示跳过**（未冒充通过，留待补验） | vitest 136/136 + acceptance.sh 14/14 + tsc 0 错误 + next build 通过；浏览器回归 0/3（工具取消，用户指示跳过） | 卡片 50（Excel 式速录）。**技能治理**：① 「Prisma 关系迁移会 DROP raw-SQL 列」值得固化（两库+校验和修复流程）——已入 vibehub-build；② 技能已更新；③ 无新契约（assignee 语义 04 文档既有，本轮补齐实现） |
| R75 | 卡片 50（用户实测反馈「录入没有 Excel 便利」）部分交付 + 卡片 48 归档：轻量默认字段（BugFormExtras 折叠）+ TSV 批量导入（解析器 TDD 6/6 + 预览面板 + 粘贴分流 + 成败汇总）；表格视图拆出卡片 51；**浏览器回归因 IAB 环境故障（水合多轮不完成，换 token/新标签无效）连续第二轮跳过，不冒充通过** | 解析器 6/6 + tsc 0 错误 + next build 通过；浏览器回归 0 项（环境跳过） | 卡片 51（看板表格视图）。**技能治理**：① 「web 侧纯函数经 --root ../web 跑 vitest」为一次性小套路，不固化；② 技能无需更新；③ 无新契约 |

| R76 | 人工会话（用户指示按项目评审去做）：① git init + 基线提交（main），修复在分支 fix/p0-review；② 评审四项 P0——附件签名链接（修 <img> 401 与落盘/记录 ID 不一致致 404，raw 加 nosniff/CSP sandbox/白名单 inline）、刷新令牌竞态（服务端 10s 宽限 + 登出吊销整族；前端 token-refresh 协调器）、MCP 密钥 SSE 逐次复核 + 成员禁用停用/移除吊销、项目解析去 cwd 猜测与静默回落；③ 测试基建：final-acceptance 子进程 cwd、起库脚本拉起已停止容器；④ **开局自校验修正**：§5 仍为 R64「等待卡片 39」与顶部 R75「卡片 51」矛盾，按最近日志统一为卡片 51 | vitest 161/161（+25）+ web 单测 12/12 + acceptance.sh 14/14（每个修复提交前各跑一次）+ 四场景 stdio 30/30 / SSE 30/30（测试库）+ web tsc 0 错误 / next build 通过 + IAB：签名链接 <img> 免令牌加载 480×200、未签名链接加载失败 | 卡片 51（按原计划）；建议用户先人工确认看板缩略图显示与多标签不掉线，并决定评审其余发现（§4 R76 末条）。**技能治理**：① 「lsof -ti 会列出客户端连接（含 Claude 浏览器进程），结束服务须 -sTCP:LISTEN」「URL.pathname 中文路径须 fileURLToPath」值得固化——已入 vibehub-build；② 技能已更新；③ AGENTS.md 补 6 处 R76 契约 |
| R77 | 用户授权代为决策「收拢范围」：卡片 39 **砍**（inject 探针实测 MCP 密钥调 REST 录入接口 401 INVALID_TOKEN，方案「零后端改动」前提不成立；收益未经数据验证）；卡片 51 **冻结**；新建 `docs/计划/09`（10 个工作日真实试用、可量化达标标准、结束评审解冻规则）；新增只读 `server/scripts/trial-metrics.sh`；§2 看板改为冻结期清单 F0–F8；§6 增冻结期规则 | 指标脚本以四场景总验收数据校验口径（总验收 30/30 后：AI resolved 1 / 人工新建 2 = 50%，MCP 成功 7 / 失败 1，与剧本一致；补录带图缺陷后截图计数 0→1；起始日期过滤生效）；测试库已清空。**附带实证**：只读核对验收库 `auth.token_reused` 共 4 条＝2 组同毫秒成对（并发刷新指纹，UTC 00:24 / 04:36，均早于 R76 刷新修复 11:51 UTC）——P0-2 在用户环境真实发生过 2 次；故试用指标必须以修复后的日期为起点 | F0 / F1（冻结期清单）。**技能治理**：① 无新重复工作流；② vibehub-build 补「冻结期协议」；③ AGENTS.md §0 补当前阶段、§1 文档索引补 09 |
| R78 | 用户指示：「卡片 51/39 都删除了不要了，然后其它没做完的就继续做，你先给我跑起来」——① 删除 39/51 全部计划痕迹；② 起服务并推进冻结期清单 F1–F8；③ 交付镜像刷新 | 删卡：删 `docs/计划/39-全局截图入口方案.md` + AGENTS.md/09/07/PROGRESS 全部引用（历史日志留原貌）。清单：F1/F3 引入 Playwright E2E（3 用例：闭环 + 指派 + TSV 速录）、F2 语义写路径超时与跳过、F4 登录限流、F5 SSE 单连接与日志脱敏、F6 镜像 1.3 容器冒烟、F7 备份恢复演练 10/10、F8 文档纠偏。**门禁**：`acceptance.sh` **PASS=19 FAIL=0**（tsc + vitest 180 + 冒烟 14 + E2E 3 passed + 日志脱敏 2 实证）。**实测抓到的四个坑**：MCP 子进程缺 DATABASE_URL 会静默落 dev 库（查无密钥 → initialize 超时）；状态机不允许 open→resolved 跨级（工具返回 isError，早期断言写错漏判）；`getByAltText` 在看板与对话框同名文件下命中两元素（strict mode）；非空库首注册用户是 member（建项目 403）→ 夹具共用同一 Owner。服务已起：后端 :3210（验收库）+ 前端 dev :3211 | 试用启动（F0 常驻）；R76/R77/R78 待合并到 main | **技能治理**：① 「E2E 前置清库 + 共用 Owner 夹具」为可复用模式，已随代码库沉淀（tests/e2e/fixtures.ts），不另立技能；② vibehub-build 补两条教训（MCP 子进程须显式传 DATABASE_URL；E2E 断言要检查工具返回的 isError）；③ AGENTS.md §3 补登录防暴力契约、§5 工具数订正 15、§8 门禁去硬编码 |
