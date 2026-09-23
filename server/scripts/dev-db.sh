#!/usr/bin/env bash
# 起/复用**验收/开发**数据库容器（pgvector/pgvector:pg16, 55433）——持久：命名卷 vibehub-dev-pg，
# 用户验收数据存放在此，删容器不丢数据（删卷才会）。输出连接串。
# 用法：bash scripts/dev-db.sh            # 起容器（已在跑则复用）
#       export DATABASE_URL=$(bash scripts/dev-db.sh)
set -euo pipefail

CONTAINER=vibehub-dev-db
PORT=55433
USER=vibehub
PASSWORD=vibehub
DB=vibehub
VOLUME=vibehub-dev-pg

if ! docker info > /dev/null 2>&1; then
  echo "错误: Docker 未运行，请先启动 Docker Desktop" >&2
  exit 1
fi

if ! docker ps --filter "name=$CONTAINER" --format '{{.Names}}' | grep -q "$CONTAINER"; then
  docker run -d --name "$CONTAINER" \
    -e POSTGRES_USER="$USER" \
    -e POSTGRES_PASSWORD="$PASSWORD" \
    -e POSTGRES_DB="$DB" \
    -p "$PORT:5432" \
    -v "$VOLUME:/var/lib/postgresql/data" \
    pgvector/pgvector:pg16 > /dev/null
  # 等待就绪
  for _ in $(seq 1 30); do
    docker exec "$CONTAINER" pg_isready -U "$USER" > /dev/null 2>&1 && break
    sleep 1
  done
  # pgvector 扩展（幂等）
  docker exec "$CONTAINER" psql -U "$USER" -d "$DB" -c "CREATE EXTENSION IF NOT EXISTS vector;" > /dev/null
fi

echo "postgresql://$USER:$PASSWORD@127.0.0.1:$PORT/$DB"
