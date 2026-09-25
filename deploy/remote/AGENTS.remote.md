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
| 访问地址 | **http://&lt;服务器地址&gt;:3210**（部署时按实际填；本文件公开，故不写真实地址） |
| 代码目录 | `~/Downloads/vibehup/`（本文件所在目录；`~` 为部署账号家目录） |
| 编排文件（**运行中容器用的这份**） | `~/vibehub/docker-compose.yml`（compose 项目名 `vibehub`，密钥直接写在 environment 里，权限 600） |
| 源码目录里的编排 | `~/Downloads/vibehup/docker-compose.yml` + `.env`：**只作模板，不要在这里 `compose up`**——目录名是 `vibehup`，compose 项目名随之变成 `vibehup`，会挂上空卷 `vibehup_vibehub-*`，看起来像数据丢了，且与 `container_name: vibehub` 冲突 |
| 容器名 | `vibehub` |
| 镜像 | `vibehub:1.5`（arm64/linux；源码构建，见 §5；1.4 / 1.3 留作回滚）。**待升级 1.6**：按 §5「1.5 → 1.6 升级步骤」构建部署，完成后把本行改为 1.6 |
| 对外端口 | `3210`（PG 的 5432 **只在容器内**，不对外暴露） |
| 数据卷 | `vibehub_vibehub-pg` → 库 / `vibehub_vibehub-data` → 附件 |
| 重启策略 | `unless-stopped` |
| 初始 Owner | 由 `deploy/remote/bootstrap-owner.cjs` 创建，邮箱与密码经 `BOOTSTRAP_EMAIL` / `BOOTSTRAP_PASSWORD` 传入（脚本无默认值）；**首次登录后改密** |
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
- **MCP**：16 个工具（读取 7 + 写入 9；**1.6 起 26 个**，见 §8），双传输——`stdio`（IDE 起子进程）与 `SSE`
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
│   │   ├── mcp/         16 个工具、scope 守卫、上下文与计量
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
cd ~/vibehub                             # 运行中容器的编排目录（不是源码目录，见 §2）

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
DK=/usr/local/bin/docker
$DK exec vibehub pg_dump -U vibehub -d vibehub -Fc > ~/vibehub-backups/pg-$(date +%F-%H%M).dump   # 先备份
cd ~/Downloads/vibehup && $DK build -t vibehub:1.6 .     # 在源码目录构建，打新 tag 便于回滚
# 再到编排目录把 image 改成新 tag 后拉起（必须在 ~/vibehub，见 §2）：
cd ~/vibehub && sed -i '' 's/image: vibehub:1.5/image: vibehub:1.6/' docker-compose.yml && $DK compose up -d
```

### 1.5 → 1.6 升级步骤（2026-09-24 起可用）

1.6 = GitHub `main`（R80 + R81 + R83）。**用干净克隆构建**，不动 `~/Downloads/vibehup` 里的本地改动（那里的 AGENTS.md 是本机版，直接 `git pull` 容易冲突）：

```bash
DK=/usr/local/bin/docker
mkdir -p ~/vibehub-backups
$DK exec vibehub pg_dump -U vibehub -d vibehub -Fc > ~/vibehub-backups/pg-$(date +%F-%H%M)-before-1.6.dump   # 1. 先备份
rm -rf ~/vibehub-src-1.6 && git clone --depth 1 https://github.com/980911302/vibehup.git ~/vibehub-src-1.6   # 2. 干净源码
cd ~/vibehub-src-1.6 && $DK build -t vibehub:1.6 .                                                       # 3. 构建（arm64 原生）
cd ~/vibehub && cp docker-compose.yml docker-compose.yml.bak-1.5 \
  && sed -i '' 's/image: vibehub:1.5/image: vibehub:1.6/' docker-compose.yml && $DK compose up -d        # 4. 换镜像拉起
$DK ps                                                                                                   # 5. 等到 healthy（约半分钟）
$DK logs vibehub --tail 100 | grep -iE "migration|迁移"                                                  #    应看到 4 个新迁移已应用
$DK exec vibehub psql -U vibehub -d vibehub -Atc \
  "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 4"  #    应列出 status_actor / bug_reporter / skills / task_labels_review
```

启动时自动应用 4 个迁移：`task_labels_review`（任务加标签/打回原因/打回次数）、`skills`（技能两张表）、`bug_reporter`（缺陷加提出人）、`status_actor`（缺陷与任务加「最近一次流转的时间与操作人」）。
**只加列加表，不改不删存量数据，不碰向量列**：已在云端用 1.5 结构 + 存量数据（含 1024 维向量）实测升级（含 R83 共 4 个迁移），数据与向量逐字节不变，HNSW 索引保留；容器新库 9 个迁移全部应用、8 秒就绪。
存量「已关闭」的缺陷保持不变；R83 起「已关闭」只用于不修复的结局，「已验证」就是修复完成的终点。

**启动时要能访问 `binaries.prisma.sh`**：构建阶段的 node slim 镜像里没有 OpenSSL，Prisma 探测不到版本、按 1.1 下载了引擎；
运行期（OpenSSL 3）找不到对应的迁移引擎，于是每个新容器启动时现下载一次（1.3～1.5 一直如此，本机网络能通所以没暴露）。
若 `docker logs` 卡在「应用数据库迁移」并报下载 `schema-engine` 失败，是网络问题：重试 `compose up -d`，或先回滚。根治见 §10。

**升级后验收**：浏览器登录看板，顶栏应有「全部 / 指派给我 / 我提的 / 未指派」，看板六列（含「验证中」）；任务页六列；左侧有「技能」。
IDE 里重连 MCP，应看到 26 个工具（1.7 起 27 个，`node server/scripts/verify-mcp-key.mjs` 按当前代码断言）。存量缺陷的「提出人」显示「未记录」属正常（此前没记录）。

**回滚**：`docker-compose.yml.bak-1.5` 拷回去再 `$DK compose up -d`。已实测 1.5 在升级后的库上能正常启动与写入（新迁移都是新增列/表）；
差异是 1.6 里进入新状态的记录在 1.5 看板上不显示：「待验证 / 验证中 / 已取消」的任务（1.5 只认待办/进行中/已完成），以及「验证中」的缺陷。要连数据一起回到升级前，用第 1 步的 dump 做 `pg_restore`。

> 版本记录：1.5 → **1.6**（2026-09-24）R80：任务五态（待办/进行中/待验证/已完成/已取消）+ 标签 + 详情 + 删除；技能模块（Web 与 MCP 上传/下载/查看，挂项目或全团队通用）；
> MCP 工具 16 → 26（补齐删除、任务详情、便签修改、技能四件套、`search`），新增 scope `skill:write`；各页共享当前项目。
> R81：只读成员（viewer）真只读（缺陷/便签/附件写接口补角色校验）；缺陷详情全字段可改、只摆合法下一步、页内写重开原因、删除二次确认；
> 记录缺陷提出人 + 看板「指派给我 / 我提的 / 未指派」；状态文案全中文（`verified` 显示为「已验证」）；CSV 导入缺陷 ID 前缀修正。
> R83：缺陷与任务都加「验证中」（缺陷 已解决 → 验证中 → 已验证，已验证为终点；已关闭只用于重复/不修/无法复现且必须写原因；任务 待验证 → 验证中 → 已完成）；
> 每次流转记下谁（MCP 记密钥名）、什么时候，卡片显示「谁 · 多久」，验证中 >2 小时、进行中 >24 小时标黄，`get_project_context` 增加 `verifying_bugs` / `verifying_tasks` / `stale_items`。
>
> 1.4 → **1.5**（2026-09-24）状态流转协议进 MCP（`server/src/mcp/workflow.ts`）：initialize 下发流转规则，
> `get_project_context` 增加 `awaiting_verification`、`doing_tasks`、`reminders`，`get_bug_detail` / `update_bug_status` 返回
> `allowed_next_statuses` 与 `next_step`，`update_bug_status` 新增 `reopen_reason`（此前 AI 无法把验证不过的缺陷退回）；
> `deleteBug` 连带删除评论（`bug_comments` 无外键，原先会留孤儿）；技能改为 MD 文件 `skills/vibehub-mcp/SKILL.md`，
> 镜像内对外提供 `/skills/vibehub-mcp/SKILL.md` 与 `/skills/install.sh`。
>
> 1.3 → 1.4（2026-09-24）新增 MCP 工具 `create_task`，`update_task` 可改标题/描述，
> `list_tasks` 返回描述；`/mcp/sse` 加 `X-Accel-Buffering: no`（经 nginx 反代时大消息不再被缓冲，
> 否则 IDE 报「tools fetch failed: Request timed out」）；新增 `.dockerignore`。

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
  16 个工具逐个真调 + 数据库二次核对，期望 `PASS=54 FAIL=0`（1.6 起 26 个工具，期望 `PASS=81 FAIL=0`；1.7 起 27 个，期望 `PASS=94 FAIL=0`，库里须有至少两个项目才测得到多项目歧义）。
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
      "url": "http://<服务器地址>:3210/mcp/sse",
      "headers": { "Authorization": "Bearer <在 Web「密钥」页新建的密钥>" }
    }
  }
}
```

- 密钥在 Web 端「密钥」页创建，**明文只显示一次**；默认 90 天过期。
- scope 决定能调哪些工具：`context:read`（读上下文）、`bug:write`（回填状态）、
  `attachment:read`/`attachment:write`、`note:write`、`task:read`/`task:write`、`admin`（清回收站）；
  1.6 起另有 `skill:write`（上传/删除技能；查看与下载技能属 `context:read`）。删除类工具跟着对应写权限走。
  **建议按需最小授权**：日常「读上下文 + 回填」给 `context:read,attachment:read,bug:write` 足够。
- **多项目时必须传 `project_slug`**（不传会报错并列出可选值——这是刻意设计，防止 AI 把内容写进别的项目）。

### 技能 vibehub-mcp（状态流转规范）

- 正本：`skills/vibehub-mcp/SKILL.md`（本目录）。**不要再把技能写成 VibeHub 便签**——MCP 读便签会截断到 300 字，AI 读不全，也不会自动加载。
- 安装到本机 Claude Code / Codex / 通用 agents 的用户级技能目录：`bash skills/install.sh`（改了 SKILL.md 重跑即可）。
- 别的机器：`curl -fsSL http://<地址>:3210/skills/install.sh | VIBEHUB_URL=http://<地址>:3210 bash`。
- 规则的核心同时写在 `server/src/mcp/workflow.ts`（随 initialize 下发、写进工具描述与返回），**改流转规则时两处同步**。

### 工具清单（1.5 为 16 个；1.6 起 26 个；1.7 起 27 个，唯一出处 `server/src/mcp/server.ts` 的 `TOOL_NAMES`）

读取：`get_project_context`、`list_bugs`、`get_bug_detail`、`read_attachment_text`、
`inspect_image_asset`、`list_notes`、`list_tasks`；1.6 新增 `search`、`get_task_detail`、`list_skills`、`download_skill`
写入：`update_bug_status`、`create_bug`、`add_bug_comment`、`append_scratchpad`、
`upload_attachment`、`create_task`、`update_task`、`purge_trash`（需 admin）；
1.6 新增 `delete_bug`、`update_note`、`delete_note`、`delete_attachment`、`delete_task`、`upload_skill`、`delete_skill`；1.7 新增 `create_upload_url`

**易踩的参数坑**（实测确认）：
- 传文件（1.7 起）：文本用 `upload_attachment` 的 `content` 直接传；本地文件用 `create_upload_url` 拿 curl 命令直传，内容不经过对话。1.6 及以前 `upload_attachment` 只能传 `data_base64`。
- 看截图（1.7 起）：`inspect_image_asset` 默认直接返回图片；1.6 及以前默认返回服务端路径（容器部署时打不开）。
- `update_bug_status` 的参数是 **`commit_hash`**，不是 `git_commit_hash`。
- 状态**不能跳级**：合法路径 `open → in_progress → resolved → verifying → verified`（1.6 起；验证方先改 verifying 再动手，verified 是终点）；`closed` 只用于重复/不修/无法复现，必须写 `resolution_notes`。
- `append_scratchpad` 不传 `project_slug` 会落成**全局便签**（项目下查不到）。

---

## 9. 本机不可违背的约定

1. **密钥不入库**：`.env`、`deploy/remote/docker-compose.yml` 含真实密钥，已在 `.gitignore` 中；
   不要为了「方便」把明文提交进 git。
2. **不建演示数据**：任何环境不得残留 seed/演示数据。
3. **迁移只准 `prisma migrate` 生成**（raw SQL 仅限 pgvector 向量列，且需注释原因）。
   ⚠️ `migrate dev` 每次都会在生成的迁移里带上 `DROP INDEX "Embedding_embedding_idx"` + `DROP COLUMN "embedding"`
   （Prisma 不感知向量列）。与向量列无关的迁移**删去这两句并留注释**——删了再补回会清空全部语义索引。
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
- **迁移引擎运行期下载**（2026-09-24 云端构建 1.6 时发现，1.3 起就存在）：见 §5「启动时要能访问 `binaries.prisma.sh`」。
  根治办法是在 Dockerfile 的构建阶段装上 `openssl`（让 Prisma 按 OpenSSL 3 取引擎并打进镜像），改完需在本机重新构建验证。
  另：`binaryTargets` 只含 arm64 目标，**x86 机器上构建的镜像查询引擎不对，跑不起来**；要换 x86 部署须加 `debian-openssl-3.0.x`。
- **前端回归**统一走 Playwright（`server/tests/e2e/`），不用人工点点点。
