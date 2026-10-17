# AGENTS.md — VibeHub 运维手册（Linux 原生部署版）

> 本文件是**这台部署机上**的运维手册与不可违背约定。任何 Agent（或人）在这台机器改动 VibeHub 前先读本文件，
> 改动完成后按 §11 更新对应章节，保持本文件与实物一致。
>
> **部署形态：Linux 原生部署**（systemd + 宿主机 PostgreSQL），**不是容器**。原因见 §3。
>
> ⚠️ 本文件随代码进公开仓库，因此：**不写真实公网 IP、不写任何密码 / 密钥 / JWT_SECRET**。
> 真实值只有两个地方：服务器上的 `/etc/vibehub/env`（权限 600）与云厂商控制台。

---

## 1. 这台机器是什么

| 项 | 值 |
| --- | --- |
| 机型 | 云厂商 ECS，KVM 虚拟化 |
| 系统 | Ubuntu 24.04 LTS（内核 6.8） |
| CPU | 2 vCPU（通用型共享核） |
| 内存 | **768 MiB + 2 GiB swap**（swap 见 §7，原本没有，必须保留） |
| 磁盘 | 40 GiB（SSD 级，实测写 130 MB/s / 读 112 MB/s） |
| 带宽 | 下行约 10 Mbps / **上行约 2 Mbps**（上行是硬约束） |
| 网络 | 内网 `<内网IP>` / 公网 `<公网IP>` / ZeroTier `<ZeroTier IP>`（虚拟内网入口） |
| 定位 | 单人/小团队的**私有研发上下文服务**，不对外做公开站点 |

---

## 2. 本机实际部署形态（先看这张表）

| 项 | 值 |
| --- | --- |
| 访问地址 | Web/API/MCP 统一 `http://<ZeroTier IP>:3210` 或 `http://<公网IP>:3210`（安全组已放行 3210） |
| 代码目录 | **`/app`**（monorepo：`server/` + `web/` + `skills/`） |
| 进程管理 | **systemd**：`vibehub.service`（`enabled`，开机自启；异常 5s 自动重启） |
| 启动命令 | `node dist/bootstrap.js`，工作目录 `/app/server` |
| Node | **v22.14.0**，官方 tarball 解到 `/usr/local`（非 apt，版本可控） |
| 数据库 | **宿主机** PostgreSQL **16 + pgvector**（不是容器内的 PG）；库/角色均为 `vibehub` |
| 配置 | `/etc/vibehub/env`（600）——`DATABASE_URL` / `PGPASSWORD` / `JWT_SECRET` / `EMBEDDING_*` 等**唯一来源** |
| 附件目录 | `/var/lib/vibehub/data`（`DATA_DIR`） |
| 日志 | `/var/log/vibehub.log`（systemd `append:`，已配 logrotate 见 §7） |
| 对外端口 | **仅 3210**（HTTP + SSE + MCP SSE）；**5432 不监听公网** |
| 前端产物 | `/app/web/out`（Next 静态导出，**在你本机构建后上传**，见 §6） |
| 注册开关 | **`REGISTRATION_OPEN=false`**（公网可达，必须保持关闭，见 §10） |

> 首账号（Owner）由 `deploy/remote/bootstrap-owner.cjs` 创建，邮箱/密码经 `BOOTSTRAP_EMAIL` / `BOOTSTRAP_PASSWORD` 传入，
> 脚本无默认值。凭据只记在你自己的密码管理器里，**不进本文件**。

---

## 3. 为什么是原生部署而不是单容器

项目标准交付形态是 Docker 单容器（见 `docs/规范/03-容器化部署规范.md`），**但这台机器不适合**：

1. **`docker build` 会 OOM**：镜像构建阶段要跑 `npm ci`（server + web）与 `next build`，实测峰值 1.5–2 GB，而本机只有 768 MiB 可用内存 + 2 GiB swap，构建几乎必然被杀。
2. **省掉一个 PostgreSQL**：容器方案里 PG 跑在容器内（约 250 MB RSS）；本机复用宿主机 PG，只跑 Node 一个进程。
3. **实测收益**：应用常驻 **约 139 MB**，远低于容器方案（含 PG 约 400 MB+），768 MiB 机器上差别是「能跑」与「常崩」。

代价：**前端构建必须在开发机构建后上传**（产物是纯静态文件，与 CPU 架构无关，见 §6）。

---

## 4. 目录与进程拓扑

```
systemd: vibehub.service
  └─ node /app/server/dist/bootstrap.js        cwd=/app/server
       ├─ 等 PG 就绪（pg_isready，最多 60s）
       ├─ CREATE EXTENSION IF NOT EXISTS vector
       ├─ prisma migrate deploy --schema=/app/prisma/schema.prisma
       └─ 起 Fastify：API + 静态页 + SSE(:3210) + MCP SSE(/mcp/*)
                                    │
                                    └─ 127.0.0.1:5432 → 宿主机 PostgreSQL 16 + pgvector
                                       （另监听 ZeroTier IP，供内网直连，见 §8）

/app
├── package.json / package-lock.json / node_modules
├── server/
│   ├── dist/            ← bootstrap.js 等编译产物（服务器上构建）
│   ├── prisma/          ← schema + 9 个迁移
│   └── src/
├── web/out/             ← 本机构建的 Next 静态产物 + out/skills
├── skills/              ← 技能正本（改完要同步到 web/out/skills）
└── prisma → server/prisma   ← **符号链接，不可删**（见 §10 坑 1）
```

后端分层严格单向 `routes → services → core`；API 与 MCP **平级共用 services**；前端唯一数据入口 `lib/api.ts`。
这些契约的权威出处是仓库根 `AGENTS.md`，本文件只记**这台机器上的事实**。

---

## 5. 常用运维命令（在服务器上）

```bash
systemctl status vibehub --no-pager      # 状态（应为 active running）
systemctl restart vibehub                # 重启（约 4 秒恢复，见 §11）
systemctl stop vibehub                   # 停服
systemctl is-enabled vibehub             # 应为 enabled（开机自启）

tail -f /var/log/vibehub.log             # 跟随日志（启动序列、请求、错误都在这）
curl -s http://127.0.0.1:3210/api/health # 探活：{"status":"ok",...}

free -m                                  # 内存（留意 available 与 swap 用量）
systemctl show vibehub -p MemoryCurrent --value | awk '{printf "%.0f MB\n",$1/1048576}'
ss -lntp | grep 3210                     # 确认监听地址

# 进数据库（密码取 /etc/vibehub/env 的 PGPASSWORD）
set -a; . /etc/vibehub/env; set +a
PGPASSWORD="$PGPASSWORD" psql -h 127.0.0.1 -U vibehub -d vibehub -c "select count(*) from bugs"

# 看迁移状态
set -a; . /etc/vibehub/env; set +a
cd /app && npx prisma migrate status --schema=server/prisma/schema.prisma
```

**改配置**：编辑 `/etc/vibehub/env` → `systemctl restart vibehub`。数据目录与库都不受影响。

---

## 6. 改代码后怎么更新（两段式，别在服务器上构建前端）

```bash
# ── 本机（Mac，arm64）：只构建前端 ──
npm run build -w web                      # → web/out（纯静态，与架构无关）
rsync -az --exclude=node_modules --exclude=.git --exclude=.next --exclude=.env \
  web/out server root@<公网IP>:/app/

# ── 服务器：只构建后端 + 重启 ──
ssh root@<公网IP>
cd /app
npm run build -w server                   # = prisma generate + tsc（约 1 分钟）
systemctl restart vibehub

# 技能有变动时（Dockerfile 里也是这么做的，见 §4）
rm -rf /app/web/out/skills && cp -r /app/skills /app/web/out/skills
```

**改依赖时**（`server/package.json` 变了）：先 `cd /app && npm ci --workspace=server --include-workspace-root=false`，再构建。
**改 schema 时**：`prisma generate` 必须重跑，否则运行期报 `PrismaClientValidationError`（看起来像业务 bug）。

**首次部署 / 换机的最小步骤**（顺序不能乱）：

```bash
# 1) 系统准备：swap + Node 22 + pgvector
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
grep -q /swapfile /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab
# Node 22 官方 tarball 解到 /usr/local（按 dpkg --print-architecture 选 x64/arm64）
apt-get install -y postgresql postgresql-16-pgvector

# 2) 建角色/库/扩展（vibehub 作为库 owner；vector 由 postgres 预建一次）
#    然后写 /etc/vibehub/env（600）、mkdir -p /var/lib/vibehub/data

# 3) 代码落地
#    rsync 源码到 /app（排除 node_modules/.git/.env），再：
ln -sfn /app/server/prisma /app/prisma     # ★ bootstrap 硬编码 /app/prisma，缺它迁移必失败
cd /app && npm ci --workspace=server --include-workspace-root=false
npx prisma generate --schema=server/prisma/schema.prisma
npm run build -w server

# 4) systemd + 首账号
#    写 /etc/systemd/system/vibehub.service（见 §2 参数）→ daemon-reload → enable --now
#    BOOTSTRAP_EMAIL=... BOOTSTRAP_PASSWORD=... node - < /app/deploy/remote/bootstrap-owner.cjs
```

---

## 7. 数据、备份、日志与恢复

```bash
mkdir -p /root/vibehub-backups

# 库（逻辑备份，推荐）
set -a; . /etc/vibehub/env; set +a
PGPASSWORD="$PGPASSWORD" pg_dump -h 127.0.0.1 -U vibehub -d vibehub -Fc \
  > /root/vibehub-backups/pg-$(date +%F-%H%M).dump

# 附件目录
tar czf /root/vibehub-backups/data-$(date +%F).tar.gz -C /var/lib/vibehub/data .
```

恢复：`pg_restore -h 127.0.0.1 -U vibehub -d vibehub --clean --if-exists <dump>` + 把 tar 解回 `/var/lib/vibehub/data`。
仓库内 `server/scripts/backup.sh` 与 `restore-drill.sh` 实现了「备份 → 清库 → 恢复 → 核对」（演练 10/10 通过）；
**演练必须指向测试库**，别对着生产库跑。

**swap（2 GiB）**：不是可选项。768 MiB 机器没有 swap 时，一次内存尖峰就会被内核 OOM kill。
**服务内存护栏**：`MemoryHigh=550M` / `MemoryMax=680M`——超 `High` 先回收，超 `Max` 才杀进程，给系统留活路。
**日志轮转**：`/etc/logrotate.d/vibehub`（`su root syslog`、daily、保留 7 份、20M 触发、`copytruncate`）。
不加 `su root syslog` 会报「parent directory has insecure permissions」而完全不轮转（`/var/log` 是 775 root:syslog）。

---

## 8. MCP 接入（现行 27 个工具）

服务已在跑，用 **SSE** 接入：

```json
{
  "mcpServers": {
    "vibehub": {
      "type": "sse",
      "url": "http://<ZeroTier IP>:3210/mcp/sse",
      "headers": { "Authorization": "Bearer <在 Web「密钥」页新建的密钥>" }
    }
  }
}
```

- 端点是 `GET /mcp/sse`（Bearer 握手，回 `sessionId`）+ `POST /mcp/messages?sessionId=…`；无/错密钥一律 **401**。
- 密钥在 Web 端「密钥」页创建，**明文只显示一次**，默认 90 天过期；撤销即时生效（长连接每次调用按 ID 复核）。
- scope 决定能调哪些工具：`context:read`、`bug:write`、`attachment:read`/`attachment:write`、
  `note:write`、`task:read`/`task:write`、`skill:write`、`admin`（清回收站）。
  日常「读上下文 + 回填」给 `context:read,attachment:read,bug:write` 足够。
- 技能安装到本机 Claude Code / Codex：`bash skills/install.sh`，或远程
  `curl -fsSL http://<地址>:3210/skills/install.sh | VIBEHUB_URL=http://<地址>:3210 bash`。

### 工具清单（27 个 = 读取 11 + 写入 16；唯一出处 `server/src/mcp/server.ts` 的 `TOOL_NAMES`）

读取：`get_project_context`、`list_bugs`、`get_bug_detail`、`read_attachment_text`、`inspect_image_asset`、
`list_notes`、`search`、`list_tasks`、`get_task_detail`、`list_skills`、`download_skill`

写入：`update_bug_status`、`create_bug`、`add_bug_comment`、`delete_bug`、`append_scratchpad`、`update_note`、
`delete_note`、`upload_attachment`、`create_upload_url`、`delete_attachment`、`create_task`、`update_task`、
`delete_task`、`upload_skill`、`delete_skill`、`purge_trash`（需 `admin`）

### 易踩的参数坑（实测确认）

- `update_bug_status` 的参数是 **`commit_hash`**，不是 `git_commit_hash`。
- 状态**不能跳级**：缺陷 `open → in_progress → resolved → verifying → verified`（`verified` 是修复终点）；
  `closed` 只用于重复/不修/无法复现，必须写 `resolution_notes`。任务 `todo → doing → review → verifying → done`（另可 `cancelled`）。
- `append_scratchpad` 不传 `project_slug` 会落成**全局便签**（项目下查不到）。
- **多项目时必须传 `project_slug`**（不传会报错并列出可选值——刻意设计，防止 AI 写进别的项目）。
- 传文件：文本用 `upload_attachment` 的 `content`；本地文件用 `create_upload_url` 拿 curl 命令直传，内容不经过对话。
- 看图：`inspect_image_asset` 默认直接返回图片内容块（模型能看到截图），不要用 `return_mode: base64`。

---

## 9. 数据库与网络暴露面

| 项 | 事实 |
| --- | --- |
| PG 监听 | `listen_addresses = 'localhost,<ZeroTier IP>'`——**不含公网 IP** |
| PG 认证 | 本地 `scram-sha-256`；ZeroTier 网段 `host all all <ZT 网段>/24 scram-sha-256`；无 `trust` 规则 |
| 公网 5432 | **未监听**。`nc -z <公网IP> 5432` 可能显示 succeeded，那是云侧/中间设备接受 TCP 后立即关闭的假象——用 `psql` 直连会得到 `server closed the connection unexpectedly` |
| 应用内网访问 | PG 走 `127.0.0.1:5432`；队友/你可从 ZeroTier 网段直连库（`psql -h <ZeroTier IP>`） |
| 安全组 | 已放行 3210（公网可达服务）。**建议收敛为只开 3210 与 22**——全放行时若有人把 `listen_addresses` 改成 `*`，数据库立刻裸奔 |

---

## 10. 已知坑（都是实测抓到的）

1. **`/app/prisma` 符号链接不可删**：`dist/bootstrap.js` 里把 schema 路径**硬编码**为 `/app/prisma/schema.prisma`
   （容器布局遗留）。monorepo 实际在 `/app/server/prisma`，靠 `ln -sfn /app/server/prisma /app/prisma` 兼容。删掉它 → 迁移失败、服务起不来。
2. **别在服务器上构建前端**：`next build` 峰值内存超过本机上限（§3）。前端一律本机构建后 rsync。
3. **`npm run build -w server` 自带 `prisma generate`**；手工只跑 `tsc` 会在改 schema 后漏引擎（表现为诡异的 `PrismaClientValidationError`）。
4. **静态产物路径三候选**：`cwd/../web/out`（monorepo）、`cwd/web/out`、`web-dist`。本机是 monorepo 布局，`cwd=/app/server` → 命中 `/app/web/out`。
5. **`CREATE EXTENSION IF NOT EXISTS vector` 不需要超管**：扩展已存在时 PostgreSQL 会先短路返回（实测 `NOTICE: extension "vector" already exists, skipping`），所以 `vibehub` 角色无需 superuser；但**首次**建扩展要用 `postgres` 执行。
6. **`REGISTRATION_OPEN` 必须为 `false`**：3210 公网可达，开着等于任何人扫到就能注册进你的看板（实测开着的状态下匿名注册返回 201 并拿到 token）。
7. **SSH 密码登录可能被拒**：若 `root` 密码登录报 `Permission denied`，用云控制台 VNC/CloudShell 进机器
   `passwd root` 重设，并确认 `sshd_config` 的 `PermitRootLogin`。**建议尽快改为密钥登录并关闭密码认证**。
8. **`logrotate` 需 `su root syslog`**，否则静默不轮转（§7）。
9. **内存只有 768 MiB**：不要在这台机器上再起 Docker、Jenkins、Elasticsearch 之类；加服务前先看 `free -m` 的 available。

---

## 11. 不可违背的约定（与仓库根 `AGENTS.md` 一致，此处只列本机相关的）

1. **密钥不入库**：`/etc/vibehub/env` 含真实密钥（600），仓库里的 `.env.example` 只能是占位值。
2. **不建演示数据**：任何环境不得残留 seed/演示数据。
3. **迁移只准 `prisma migrate` 生成**；raw SQL 仅限 pgvector 向量列且必须注释原因。
   ⚠️ `migrate dev` 每次都会在迁移里带上 `DROP INDEX "Embedding_embedding_idx"` + `DROP COLUMN "embedding"`
   （Prisma 不感知向量列）——与向量列无关的迁移要**删掉这两句并留注释**。
4. **响应必须序列化**：禁止裸出 Prisma 模型（camelCase 曾致前端崩溃）。
5. **静态导出约束**：页面禁用 `next/navigation` 的 `redirect()/notFound()`；Fastify 托管 `out/` 必须 `extensions: ['html']`。
6. **SSE 鉴权**：`/api/events` 用 `?token=`（EventSource 带不了头），该 token 不得进日志。
7. **启动序列**：entrypoint/bootstrap 的「等 PG → 建扩展 → 迁移」不可挪到 systemd 之外或前置；`bootstrap.js` 已是唯一入口。
8. **计量写入必须 await**：`logEvent`/`recordToolCall` 禁「即发即弃」。
9. **改完更新本文件**的对应章节（部署参数、工具清单、已知坑）。

---

## 12. 本次部署实测记录（2026-10-17）

| 验收项 | 结果 |
| --- | --- |
| 迁移 | **9 个全部应用**（`init` → `status_actor`） |
| 表数量 | **17** 张（16 个 model + `_prisma_migrations`） |
| `/api/health` | **200**，约 10 ms |
| 页面 `/` `/login` `/board` `/stats` `/skills` | 全 **200** |
| 静态资源 `/skills/install.sh`、`/skills/vibehub-mcp/SKILL.md` | 全 **200** |
| 未登录访问 `/api/bugs` 等写读接口 | 全 **401** |
| 注册开关关闭后注册 | **403**（「系统已关闭自助注册」） |
| MCP `initialize` + `tools/list` | 协议 `2024-11-05`，serverInfo `vibehub 0.2.0`，**27 个工具** |
| MCP 无效/缺失密钥 | **401** |
| 故障重启恢复 | **约 4 秒** |
| 应用内存 | **约 139 MB** |
| 磁盘占用 | 约 6.6 G / 40 G |
