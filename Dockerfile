# ============================================================
# VibeHub 单容器镜像（《容器化部署规范》）
# 一个容器 = PostgreSQL 17（pgvector）+ Node 22 + VibeHub 应用。
# 对外仅暴露 3210（HTTP/SSE/MCP-SSE）；5432 不映射。
# ============================================================

# 基底镜像参数（必须在首个 FROM 之前声明：FROM 只能消费全局作用域 ARG，
# 写在阶段之间会归属前一 stage 导致 FROM ${PG_IMAGE} 展开为空）
ARG PG_IMAGE=pgvector/pgvector:pg16

# ---------- 阶段 1：server 构建 ----------
FROM node:22-bookworm-slim AS server-builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --workspace=server --include-workspace-root=false
COPY server/tsconfig.json server/
COPY server/prisma server/prisma
COPY server/src server/src
RUN npx prisma generate --schema=server/prisma/schema.prisma
RUN npm run build -w server

# ---------- 阶段 2：server 生产依赖（精益树：剔 next/vitest/tsx 等开发依赖） ----------
FROM node:22-bookworm-slim AS server-prod
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --workspace=server --include-workspace-root=false --omit=dev

# ---------- 阶段 3：web 构建（Next.js 静态导出） ----------
FROM node:22-bookworm-slim AS web-builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
RUN npm ci --workspace=web --include-workspace-root=false
COPY web/ web/
RUN npm run build -w web

# ---------- 阶段 4：运行镜像（pgvector 基底 + Node 22 + supervisord） ----------
# 基底镜像可切换：pg16 拉取快、pg17 更新（本文档声明 16/17 均可）
# PG_IMAGE 声明于文件首部（全局作用域）：docker build --build-arg PG_IMAGE=pgvector/pgvector:pg17 可切
FROM ${PG_IMAGE} AS runtime

# Node 22 官方二进制（确定性强于 apt 源）。
# 按镜像架构选 x64/arm64：pgvector 基底在 Apple Silicon 上是 arm64，
# 写死 x64 会 Rosetta 报 "failed to open elf" SIGTRAP（R54 实测）。
RUN set -eux; \
    ARCH="$(dpkg --print-architecture)"; \
    case "$ARCH" in \
      amd64) NODE_ARCH=x64 ;; \
      arm64) NODE_ARCH=arm64 ;; \
      *) echo "unsupported arch: $ARCH" >&2; exit 1 ;; \
    esac; \
    apt-get update; \
    apt-get install -y --no-install-recommends curl ca-certificates xz-utils supervisor; \
    curl -fsSL "https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-${NODE_ARCH}.tar.xz" -o /tmp/node.tar.xz; \
    tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1; \
    rm /tmp/node.tar.xz; \
    apt-get purge -y xz-utils; \
    apt-get autoremove -y; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 生产依赖 + 构建产物
# 注意：npm workspaces 依赖提升到根 node_modules，prisma generate 的客户端落在
# /app/node_modules/.prisma（非 server/node_modules/.prisma）
COPY --from=server-prod    /app/node_modules ./node_modules
COPY --from=server-builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=server-builder /app/server/dist ./dist
COPY --from=server-builder /app/server/prisma ./prisma
COPY --from=web-builder    /app/web/out /app/web/out
COPY deploy/supervisord.conf /etc/supervisor/conf.d/vibehub.conf
COPY deploy/entrypoint.sh /usr/local/bin/vibehub-entrypoint.sh
RUN chmod +x /usr/local/bin/vibehub-entrypoint.sh

# 运行时配置（compose 注入 POSTGRES_* / JWT_SECRET 覆盖）
ENV NODE_ENV=production \
    PORT=3210 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    POSTGRES_USER=vibehub \
    POSTGRES_DB=vibehub

EXPOSE 3210
VOLUME ["/var/lib/postgresql/data", "/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
    CMD curl -fsS http://127.0.0.1:3210/api/health || exit 1

ENTRYPOINT ["/usr/local/bin/vibehub-entrypoint.sh"]
