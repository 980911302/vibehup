#!/usr/bin/env bash
# 起/复用**测试**数据库容器（pgvector/pgvector:pg16, 55432）——破坏性：vitest resetDb 会 TRUNCATE 全表；
# 验收/开发数据请用 vibehub-dev-db（55433，见 AGENTS.md 连接契约）。输出连接串。
# 用法：bash scripts/test-db.sh            # 起容器（已在跑则复用）
#       export TEST_DATABASE_URL=$(bash scripts/test-db.sh)
set -euo pipefail

CONTAINER=vibehub-test-db
PORT=55432
PASSWORD=test

if ! docker info > /dev/null 2>&1; then
  echo "错误: Docker 未运行，请先启动 Docker Desktop" >&2
  exit 1
fi

if ! docker ps --filter "name=^${CONTAINER}$" --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  if docker ps -a --filter "name=^${CONTAINER}$" --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    # 容器已存在但未运行（Docker / 机器重启后的常态）：直接拉起，重名 docker run 会失败（R76）
    docker start "$CONTAINER" > /dev/null
  else
    docker run -d --name "$CONTAINER" \
      -e POSTGRES_PASSWORD="$PASSWORD" \
      -p "$PORT:5432" \
      pgvector/pgvector:pg16 > /dev/null
  fi
  # 等待就绪
  for _ in $(seq 1 30); do
    docker exec "$CONTAINER" pg_isready -U postgres > /dev/null 2>&1 && break
    sleep 1
  done
fi

echo "postgresql://postgres:$PASSWORD@127.0.0.1:$PORT/postgres"
