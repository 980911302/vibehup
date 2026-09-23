# VibeHub — AI Native 研发上下文总线

面向 AI Native 研发团队的「双端同步研发上下文总线」：

- **给人**：极简 Web 看板与截屏上传端（Next.js + Tailwind + shadcn/ui 风格组件）
- **给 AI**：原生 MCP 服务（`@modelcontextprotocol/sdk`，**stdio + SSE 双传输**），让 Cursor / Windsurf 等 IDE Agent 直接读取缺陷复现步骤、截图与日志

解决 Vibe Coding 中的**上下文撕裂**问题：测试人员在 Web 端粘贴截图即录缺陷，AI 通过 MCP 冷启动拉取完整上下文，修复后回填状态与 commit，看板实时同步。

```
┌──────────────────────────┐   MCP over SSE（Bearer 密钥）  ┌─────────────────────┐
│   IDE Agent (Cursor 等)  │ ◄────────────────────────────► │  VibeHub MCP Server │
└──────────────────────────┘                                └─────────┬───────────┘
                                                                      │ 共享 PostgreSQL
┌──────────────────────────┐        REST + SSE                       ▼
│  Human Web Dashboard     │ ◄────────────────────────────► ┌─────────────────────┐
│ (Next.js 静态导出)        │                                  │  VibeHub Core       │
└──────────────────────────┘                                  │  (Fastify + Prisma) │
                                                              └─────────┬───────────┘
                                                          本地文件存储      │
                                                          data/attachments ▼
```

## 功能总览

| 模块 | 能力 |
| --- | --- |
| 团队账户 | 注册/登录、角色 RBAC（Owner/Admin/Member/Viewer）、成员管理、注册开关；**首启三步向导**（建项目 → 接 AI → 邀队友） |
| 缺陷看板 | 五列（Open/In Progress/Resolved/Verified/Closed），卡片直显截图缩略图，**拖拽变更状态**、多选批量、右键菜单、活动流；**<900px 移动端「录缺陷」常驻按钮** |
| 随手记 | 瀑布流便签（实时 Markdown 渲染）、**置顶浮顶**、标签过滤、行内编辑（`G N`） |
| 文件管理 | 我的/全部文件、三上传入口（**逐文件进度条 + 失败重试**）、图片灯箱、**在线文本查看（分片 + grep 高亮）**、删除与回收站 |
| 快速录入 | 按 `C` → `Ctrl+V` 粘贴截图 → 异步上传生成缩略图 → 模板填充 → `⌘+Enter` 发送 |
| 任务与项目 | 任务三列流转/转缺陷；项目表格、slug 复制（AI 匹配用）、归档、删除确认 |
| MCP 密钥 | 三步创建向导、一次性明文、scope 最小权限、轮换（24h 宽限）、撤销、30 天用量图 |
| AI 活动可见流 | 顶栏 ✦ 面板：全员可见「AI 刚才读了什么」（脱敏：密钥名/前缀/工具/耗时） |
| 语义检索 | ⌘K 搜索内置 pgvector 语义近邻（`text-embedding-v3` 可配），独立「✦ 语义相似（AI）」分组 |
| 项目切换 | 顶栏切换工作区，支持**中文/拼音/首字母模糊检索**（`yhzx` → 用户中心） |
| 角色化导航 | 日常五项平铺，密钥/成员/设置收进「更多」折叠；非管理员见锁定态；「简洁模式」可隐藏次要入口 |
| 实时同步 | SSE 推送（Web）+ **PG LISTEN/NOTIFY 跨进程通道**（MCP stdio 写入 <1s 可达）；5s 轮询仅作双保险 |
| MCP Tools | **15 个工具**（读取 7 + 写入 8）：见下方工具矩阵 |
| 双主题 | Midnight 暗色（默认）/ Daylight 纸白，全快捷键驱动（? 查看）；全站 Lucide 图标 |

## 快速开始（本地开发）

要求：Node.js ≥ 20、PostgreSQL 16/17（含 pgvector 扩展）。最省事的方式是用 Docker 起一个库：

```bash
docker run -d --name vibehub-db -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=vibehub \
  -p 5432:5432 pgvector/pgvector:pg17
```

```bash
# 1. 安装依赖（单体仓库，npm workspaces）
npm install

# 2. 配置 server/.env 的 DATABASE_URL 指向上面的库，然后初始化（空系统起步，无演示数据）
#    开发/验收库（持久，vibehub-dev-db, :55433，命名卷 vibehub-dev-pg）与测试库（破坏性，
#    vibehub-test-db, :55432）已分离：测试/vitest 只动测试库，不会清空你的验收数据。
#    起库：bash server/scripts/dev-db.sh（验收库）/ bash server/scripts/test-db.sh（测试库）
cd server && npx prisma migrate deploy && cd ..

# 3. 启动后端（API :3210，同时托管前端构建产物 web/out）
npm run dev:server

# 4. 启动前端开发服务器（:3211，/api 自动代理到 3210）
npm run dev:web
```

- 打开 <http://127.0.0.1:3211>（或生产形态 <http://127.0.0.1:3210>）。
- 首个注册账号自动成为团队 Owner。
- 一键质量门禁：`bash server/scripts/acceptance.sh`（tsc + 99 用例 + HTTP 冒烟）。

## 连接 IDE Agent（MCP）

VibeHub 支持两种传输，密钥均在 Web 端「MCP 密钥」页创建：

**方式一：SSE（Docker 部署默认）**

```json
{
  "mcpServers": {
    "vibehub": {
      "url": "http://<服务器IP>:3210/mcp/sse",
      "headers": { "Authorization": "Bearer vhk_live_xxx" }
    }
  }
}
```

**方式二：stdio（同机开发/源码部署）**

```json
{
  "mcpServers": {
    "vibehub": {
      "command": "npx",
      "args": ["tsx", "src/mcp-entry.ts"],
      "cwd": "<repo>/server",
      "env": { "DATABASE_URL": "postgresql://vibehub:<密码>@127.0.0.1:5432/vibehub?schema=public" }
    }
  }
}
```

> 密钥的 scope 决定可调用的工具（默认最小权限 `context:read`）；stdio 模式不配置密钥时为本地全权（单机信任模型）。未指定 `project_slug` 时，AI 会自动按当前工作目录名匹配项目 slug。

### MCP Tools 一览（15 个）

| 类别 | 工具 |
| --- | --- |
| 读取 | `get_project_context`、`list_bugs`、`get_bug_detail`、`read_attachment_text`、`inspect_image_asset`、`list_notes`、`search`、`list_tasks` |
| 写入 | `update_bug_status`、`create_bug`、`add_bug_comment`、`append_scratchpad`、`upload_attachment`、`update_task`、`purge_trash` |

Token 经济学：列表默认 20 条 + `has_more`；长文本字段 500 字符截断并提示用 `read_attachment_text` 分片；图片默认降采样至 1080px；`upload_attachment` 让 AI 把自己抓到的日志/截图贴回工单。

## REST API 摘要

```
GET    /api/health
GET    /api/projects?q=                    项目列表（拼音检索）
POST   /api/projects                       创建项目
GET    /api/projects/:id                   项目详情
PATCH  /api/projects/:id                   更新项目
DELETE /api/projects/:id                   删除项目（级联清理附件文件）

GET    /api/bugs?project_id=&status=&severity=&q=&page=&page_size=
GET    /api/bugs/board/:projectId          看板分组（open/in_progress/resolved/verified/closed）
POST   /api/bugs                           创建缺陷（attachment_ids 关联上传产物）
GET    /api/bugs/:bugId                    缺陷详情 + 附件清单
PATCH  /api/bugs/:bugId                    更新（拖拽改状态走这里）
DELETE /api/bugs/:bugId

GET    /api/tasks?project_id=&status=&priority=&q=
POST   /api/tasks / PATCH / DELETE

GET    /api/notes?project_id=&tag=&q=&include_archived=
GET    /api/notes/tags?project_id=         标签聚合
POST   /api/notes / PATCH / DELETE

POST   /api/upload                         multipart 上传（files[] + project_id + entity_type）
POST   /api/upload/base64                  剪贴板 Base64 兜底通道
GET    /api/attachments?project_id=&entity_type=&entity_id=&q=
GET    /api/attachments/:id                附件元数据
GET    /api/attachments/:id/raw            本地文件直读（规避防盗链）
GET    /api/attachments/:id/text           文本分片读取
GET    /api/attachments/:id/image          图片降采样信息
DELETE /api/attachments/:id

GET    /api/search?q=                      全局搜索（⌘K）
GET    /api/events                         SSE 实时推送
```

## Docker 部署（单容器，推荐）

一个容器 = PostgreSQL 17（pgvector）+ Node 22 + VibeHub 应用，对外只暴露 3210。

```bash
# 1. 配置必填项
cp .env.example .env
#    编辑 .env：POSTGRES_PASSWORD 与 JWT_SECRET（openssl rand -hex 32）

# 2. 启动（自动构建镜像、初始化数据库、应用迁移）
docker compose up -d

# 3. 打开 http://<服务器IP>:3210
#    注册第一个账号 → 自动成为 Owner
```

- **数据持久化**：`vibehub-db` 卷（PostgreSQL 数据）+ `vibehub-data` 卷（附件/派生图/回收站）
- **备份**：`docker exec vibehub pg_dump -U vibehub vibehub > backup.sql` + `vibehub-data` 卷打包
- **升级**：拉取新镜像后 `docker compose up -d`，入口自动执行幂等迁移
- **健康检查**：容器内置 `/api/health` 探活
- 无演示数据——全新部署即空系统，首账号为 Owner，在「成员」页管理团队

### 环境变量

| 变量 | 必填 | 说明 |
| --- | :-: | --- |
| `POSTGRES_PASSWORD` | ✅ | PostgreSQL 密码（首次初始化生效） |
| `JWT_SECRET` | ✅ | 登录态签名密钥（openssl rand -hex 32） |
| `POSTGRES_USER` / `POSTGRES_DB` | | 默认 vibehub |
| `DATABASE_URL` | | 默认由 compose 按上述密码生成（容器内 entrypoint 组装） |
| `REGISTRATION_OPEN` | | 是否开放自助注册（默认 true，可在 Web「成员」页随时切换） |
| `ATTACHMENT_TRASH_DAYS` | | 回收站保留天数（默认 30，可在 Web「设置」页修改） |
| `MAX_UPLOAD_BYTES` | | 单文件上传上限（默认 50MB） |
| `EMBEDDING_PROVIDER` | | 语义检索开关：`none`（默认，纯关键词）或 `dashscope`（OpenAI 兼容模式） |
| `EMBEDDING_API_KEY` / `EMBEDDING_BASE_URL` / `EMBEDDING_MODEL` | | dashscope 三件套（密钥只进环境变量，禁入文档与代码） |
| `EMBEDDING_DIM` | | 向量维度，须与库中列宽一致（当前 1024） |
| `EMBEDDING_SEND_DIM` / `EMBEDDING_USE_BASE64` / `EMBEDDING_TOKEN_LIMIT` | | 请求是否带 dimensions / base64 传输 / 文本截断上限 |

本地开发双库：验收库 `vibehub-dev-db`(:55433，持久卷 `vibehub-dev-pg`) 与测试库 `vibehub-test-db`(:55432，**破坏性**，vitest 每用例清空) 分离——`bash server/scripts/dev-db.sh` 起验收库，测试自动走 `TEST_DATABASE_URL`。

## 项目结构

```
vibehub/
├── server/                        # Fastify + Prisma + MCP
│   ├── prisma/
│   │   ├── schema.prisma          # 14 张表（项目/缺陷/任务/便签/附件/用户/密钥/计量等）+ vector 列
│   │   └── migrations/            # SQL 迁移（向量列与 HNSW 索引以 raw SQL 收尾）
│   ├── scripts/                   # dev-db.sh（验收库）/ test-db.sh（测试库）/ acceptance.sh（门禁）/ final-acceptance.mjs（四场景）
│   └── src/
│       ├── index.ts               # HTTP 入口（API + 静态托管 + bootstrap 引导）
│       ├── bootstrap.ts           # 容器启动：等 PG → vector 扩展 → migrate → 起服务
│       ├── mcp-entry.ts           # MCP stdio 入口
│       ├── config.ts              # 环境配置（.env 单一来源）
│       ├── core/                  # prisma 单例 / 事件总线(PG NOTIFY) / ID / 拼音检索 / 序列化 / 错误
│       ├── services/              # 领域服务（项目/缺陷/任务/便签/附件/存储/资产/语义检索/AI 活动）
│       ├── routes/                # REST 路由
│       └── mcp/                   # MCP Server 与 15 个 Tools
├── web/                           # Next.js (App Router) + Tailwind v4 + shadcn/ui
│   └── src/
│       ├── app/                   # 页面与全局样式
│       ├── components/            # ui（shadcn 风格）/ layout / bugs / notes / assets / activity / onboarding
│       ├── hooks/                 # use-vibehub（数据 + SSE + 轮询兜底）/ use-file-upload（上传队列）
│       └── lib/                   # API 客户端 / 类型 / 拼音检索 / 导航偏好
├── Dockerfile                     # 多阶段构建（server + web → 单容器）
└── docker-compose.yml
```

## 测试

```bash
npm test                                        # vitest：133 个用例（services / MCP / HTTP / TDD 回归）
node scripts/final-acceptance.mjs               # 四场景端到端总验收（30 项，需服务在跑）
cd server && bash scripts/acceptance.sh         # 提交门禁：tsc + vitest + HTTP 冒烟
```

覆盖：缺陷状态机与看板分组、便签置顶与标签编解码、文本分片与 grep、图片降采样、语义检索（请求形态/base64/阈值/排序）、实时通知（LISTEN 可达性）、AI 活动脱敏、上传顺序无关、15 个 MCP 工具、上传→建缺陷→拖拽→详情全链路、四场景（身份治理/人的闭环/AI 闭环/治理）30 项。

## 路线图（设计文档第 6 节）

- **阶段一（当前版本，已交付）**：SQLite → PostgreSQL 16 + pgvector 单容器、完整账户体系（RBAC/密钥/审计）、15 工具 MCP（stdio + SSE）、双主题前端、随手记/语义检索/AI 活动可见流/实时的 PG NOTIFY 通道
- **阶段二（已交付）**：Redis Pub/Sub 的替代方案（PG LISTEN/NOTIFY，单容器零新组件）、语义检索（DashScope embedding，可配）、SSE 集中式 MCP 节点——均已在当前版本落地
- **未立项（候选）**：MinIO/S3 存储抽象、托盘级全局快捷键（截图即录的「真全局」形态，方案评审见 docs/计划/39）、多机部署（Redis）

> 构建过程与工程契约见 `AGENTS.md`；进度驾驶舱见 `docs/计划/PROGRESS.md`。
