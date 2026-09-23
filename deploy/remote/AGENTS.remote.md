# AGENTS.md — VibeHub 工程契约（本机部署版）

> 本文件是这份代码所在机器的**契约层与运维手册**。任何 Agent（或人）在本机改动 VibeHub 之前，
> 先读本文件；改动后按 §9 更新本文件对应章节。
> 部署机器：**Mac mini M4（arm64 / macOS）**，服务以 Docker 单容器形态常驻。

---

## 1. 这个项目是什么

人类在 Web 端**粘贴截图即录缺陷**；AI 通过 **MCP** 直读项目上下文并回填修复状态。
团队单机版：不做多租户，不建 organizations 表，角色挂在用户上（owner / admin / member / viewer）。

一句话闭环：**人贴截图录单 → AI 用 MCP 读上下文 → 修复后回填状态与 commit → 看板实时自动刷新**。

---

## 2. 本机实际部署形态（先看这张表）

| 项 | 值 |
| --- | --- |
| 访问地址 | **http://10.72.121.9:3210** |
| 代码目录 | `/Users/zhanglinlin/Downloads/vibehup/`（本文件所在目录） |
| 编排文件 | `/Users/zhanglinlin/Downloads/vibehup/docker-compose.yml` |
| 配置（含密钥） | `/Users/zhanglinlin/Downloads/vibehup/.env`（权限 600，勿提交） |
| 容器名 | `vibehub` |
| 镜像 | `vibehub:1.3`（arm64/linux；源码构建，见 §5） |
| 对外端口 | `3210`（PG 的 5432 **只在容器内**，不对外暴露） |
| 数据卷 | `vibehub_vibehub-pg` → 库 / `vibehub_vibehub-data` → 附件 |
| 重启策略 | `unless-stopped` |
| 初始 Owner | `zhanglinlin@local`（密码见 `.env` 同级部署记录；**建议尽快改密**） |
| 语义检索 | **已开启**（DashScope `text-embedding-v3`，1024 维） |

> **本机 docker 的非交互 SSH 坑**：`docker` 不在默认 PATH 里。远程执行一律用绝对路径
> `/usr/local/bin/docker`，否则报 `command not found`。

---

## 3. 架构与目录

单容器内由 supervisord 拉起两个进程：

```
容器 vibehub
├── postgres 16 + pgvector        （supervisord priority 10, user=postgres）
└── node dist/bootstrap.js         （priority 20）
       └─ 等 PG 就绪 → CREATE EXTENSION vector → prisma migrate deploy → 起 Fastify
```

- **后端**：Fastify + Prisma + PostgreSQL 16 + pgvector；分层严格单向 `routes → services → core`
  （routes 禁直连 Prisma；services 禁 import Fastify 对象）。API 与 MCP **平级共用 services**。
- **前端**：Next.js **静态导出**（`output: 'export'`）到 `web/out/`，由 Fastify 直接托管，与 API 同源。
- **MCP**：15 个工具（读取 7 + 写入 8），双传输——`stdio`（IDE 起子进程）与 `SSE`
  （`GET /mcp/sse` 握手 + `POST /mcp/messages?sessionId=…`，Bearer 必需）。

```
vibehup/
├── AGENTS.md            ← 本文件
├── docker-compose.yml   单容器编排（用 .env 注入密钥）
├── Dockerfile           四阶段构建（server → 生产依赖树 → web 静态导出 → pgvector 基底）
├── .env                 真实配置与密钥（600，禁提交）
├── deploy/
│   ├── entrypoint.sh    只 exec supervisord（等 PG 会死锁，见下方「启动序列」）
│   ├── supervisord.conf 双进程定义
│   └── remote/          远端部署辅助（bootstrap-owner.cjs 等）
├── server/
│   ├── src/
│   │   ├── routes/      REST 路由（auth/bugs/attachments/mcp-sse/events…）
│   │   ├── services/    业务逻辑（唯一被 routes 与 MCP 共用的层）
│   │   ├── core/        prisma / errors / jwt / serialize / events / asset-sign …
│   │   ├── mcp/         15 个工具、scope 守卫、上下文与计量
│   │   └── bootstrap.ts 容器启动序列
│   ├── prisma/schema.prisma   数据模型（迁移在 prisma/migrations/）
│   ├── scripts/         门禁与运维脚本（acceptance.sh / backup.sh / trial-metrics.sh …）
│   └── tests/e2e/       Playwright 核心闭环用例
├── web/src/             Next.js 前端（app 路由 + components + hooks + lib）
└── docs/                计划（00-09）/ 规范（00-03）
```

---

## 4. 常用运维命令（在本机执行）

```bash
DK=/usr/local/bin/docker
cd ~/Downloads/vibehup

$DK ps                                   # 容器状态（应 healthy）
$DK logs -f vibehub --tail 50            # 跟随日志
$DK compose restart                      # 重启
$DK compose down && $DK compose up -d    # 重建容器（卷保留，数据不丢）
$DK stats vibehub --no-stream            # 资源占用

# 进数据库
$DK exec vibehub psql -U vibehub -d vibehub -c "SELECT count(*) FROM bugs"

# 看迁移状态
$DK exec vibehub npx prisma migrate status
```

**改配置**：编辑 `.env`（或 `docker-compose.yml` 的 environment）→ `$DK compose up -d`。
容器内进程会重启，数据卷不受影响。

---

## 5. 改代码后怎么重新出镜像

代码目录已在本机，可直接在本机构建（arm64 原生，无需交叉编译）：

```bash
cd ~/Downloads/vibehup
/usr/local/bin/docker build -t vibehub:1.4 .        # 打新 tag，便于回滚
# 改 docker-compose.yml 的 image: vibehub:1.4 后：
/usr/local/bin/docker compose up -d
```

> 构建耗时较长（四阶段 + Prisma 引擎 + Node 运行时）。构建失败时先看是否网络问题拉不到基底镜像
> `pgvector/pgvector:pg16`（`docker pull` 试一下）。
> **回滚**：把 compose 的 image 改回上一版本再 `up -d` 即可，卷不动、数据不丢。

若只想更新前端：`cd web && npm ci && npm run build`（产出 `web/out/`），再重建镜像。

---

## 6. 数据、备份与恢复

```bash
DK=/usr/local/bin/docker
mkdir -p ~/vibehub-backups

# 库
$DK exec vibehub pg_dump -U vibehub -d vibehub -Fc > ~/vibehub-backups/pg-$(date +%F).dump

# 附件卷
$DK run --rm -v vibehub_vibehub-data:/data -v ~/vibehub-backups:/out \
  alpine tar czf /out/data-$(date +%F).tar.gz -C /data .
```

恢复：`pg_restore -U vibehub -d vibehub --clean --if-exists <dump>` + 把 tar 解回卷。
仓库内 `server/scripts/backup.sh` 与 `restore-drill.sh` 实现了「备份 → 清库 → 恢复 → 核对」，
演练结果 **10/10 通过**；要演练请指向测试库，别对着生产库跑。

---

## 7. 改完必须验证（本机的门禁）

```bash
cd ~/Downloads/vibehup/server
export PATH=/opt/homebrew/bin:$PATH      # 本机 node/npm 在 homebrew（node -v 应为 v22.14.0）

# 权威门禁：tsc + 全量 vitest + HTTP 冒烟 + Playwright E2E + 日志脱敏实证
bash scripts/acceptance.sh               # 期望：PASS=19 FAIL=0
```

- **测试库**：`vibehub-test-db`（本机另起的容器，破坏性——每用例 TRUNCATE 全表）。
  **不要**把测试指向生产库，那会清空真实数据。
- **MCP 全工具自测**：`node scripts/test-all-mcp-tools.mjs`（需 `KEY=` 环境变量），
  15 个工具逐个真调 + 数据库二次核对，期望 `PASS=54 FAIL=0`。
- **性能体检**：`node scripts/perf-probe.mjs <BASE> <email> <password>`。
- 声称「完成/通过」前必须当场跑命令并引用输出，不接受「我觉得应该没问题」。

---

## 8. MCP 接入（给 IDE 用）

本机服务已在跑，用 **SSE** 接入（与交付形态一致）：

```json
{
  "mcpServers": {
    "vibehub": {
      "type": "sse",
      "url": "http://10.72.121.9:3210/mcp/sse",
      "headers": { "Authorization": "Bearer <在 Web「密钥」页新建的密钥>" }
    }
  }
}
```

- 密钥在 Web 端「密钥」页创建，**明文只显示一次**；默认 90 天过期。
- scope 决定能调哪些工具：`context:read`（读上下文）、`bug:write`（回填状态）、
  `attachment:read`/`attachment:write`、`note:write`、`task:read`/`task:write`、`admin`（清回收站）。
  **建议按需最小授权**：日常「读上下文 + 回填」给 `context:read,attachment:read,bug:write` 足够。
- **多项目时必须传 `project_slug`**（不传会报错并列出可选值——这是刻意设计，防止 AI 把内容写进别的项目）。

### 15 个工具

读取：`get_project_context`、`list_bugs`、`get_bug_detail`、`read_attachment_text`、
`inspect_image_asset`、`list_notes`、`list_tasks`
写入：`update_bug_status`、`create_bug`、`add_bug_comment`、`append_scratchpad`、
`upload_attachment`、`update_task`、`purge_trash`（需 admin）

**易踩的参数坑**（实测确认）：
- `upload_attachment` 不吃文件路径，必须 `data_base64` + `file_name` + `file_type`。
- `update_bug_status` 的参数是 **`commit_hash`**，不是 `git_commit_hash`。
- 状态**不能跳级**：合法路径 `open → in_progress → resolved → verified → closed`。
- `append_scratchpad` 不传 `project_slug` 会落成**全局便签**（项目下查不到）。

---

## 9. 本机不可违背的约定

1. **密钥不入库**：`.env`、`deploy/remote/docker-compose.yml` 含真实密钥，已在 `.gitignore` 中；
   不要为了「方便」把明文提交进 git。
2. **不建演示数据**：任何环境不得残留 seed/演示数据。
3. **迁移只准 `prisma migrate` 生成**（raw SQL 仅限 pgvector 向量列，且需注释原因）。
   ⚠️ 给带向量列的表新增 Prisma 关系时，`migrate dev` 生成的迁移会 **DROP 向量列**——
   必须在迁移末尾补回 raw SQL，并同步修两库校验和。
4. **响应必须序列化**：禁止裸出 Prisma 模型（camelCase 曾致前端崩溃）。
5. **静态导出约束**：页面禁用 `next/navigation` 的 `redirect()/notFound()`；根路径用
   `window.location.replace` + `<meta refresh>`。Fastify 托管 out/ 必须 `extensions: ['html']`。
6. **SSE 鉴权**：浏览器 `EventSource` 带不了头，`/api/events` 用 `?token=`；路由内校验。
   **该 token 不得进日志**（已加请求序列化器脱敏）。
7. **容器启动序列**：entrypoint 只 `exec supervisord`；「等 PG → 建扩展 → 迁移」在
   `dist/bootstrap.js` 内。反过来会在容器启动时死锁（PG 归 supervisord 管）。
8. **计量写入必须 await**：`logEvent`/`recordToolCall` 禁「即发即弃」，否则紧随的用量查询漏账。
9. 改动完成后**更新本文件的对应章节**（部署参数、工具清单、已知坑），保持本文件与实物一致。

---

## 10. 已知边界与后续可做项

- **无 HTTPS**：内网 HTTP 明文访问（同网段可见）。要对外或敏感环境需加反向代理 + 证书。
- **防火墙**：本机 macOS 应用防火墙当前**关闭**（服务因此对内网可达）。如需限制来源，
  开启防火墙并只放行必要网段。
- **单机单团队**：不支持多租户；多机部署需把 SSE 的 LISTEN 与限流换成共享存储（Redis）。
- **语义检索**：已启用 DashScope；Key 写在 `.env`，更换 Key 需 `compose up -d` 重启。
  向量写路径已做优化——**只在标题/步骤/期望/实际变化时才重算**，拖拽改状态不再等外网。
- **前端回归**统一走 Playwright（`server/tests/e2e/`），不用人工点点点。
