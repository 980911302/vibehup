#!/usr/bin/env bash
# 备份 / 恢复（卡片 F7）：pg_dump 自定义格式 + 附件卷打包，支持「备份 → 清库 → 恢复 → 核对」演练。
#
# 用法：
#   备份：bash scripts/backup.sh                       # 默认 vibehub-dev-db → backups/<时间戳>/
#   恢复：bash scripts/backup.sh restore backups/2026-09-24_120000
#   演练：bash scripts/restore-drill.sh                # 用测试库做破坏性演练（不动验收库）
#
# 目标库可覆盖（演练用测试库）：
#   CONTAINER=vibehub-test-db DB_USER=postgres DB_NAME=postgres bash scripts/backup.sh
#
# 产物：pg.dump（库）+ data.tar.gz（附件卷）——两者同批时间戳，恢复必须成对使用。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"   # server/
CONTAINER="${CONTAINER:-vibehub-dev-db}"
DB_USER="${DB_USER:-vibehub}"
DB_NAME="${DB_NAME:-vibehub}"
DATA_DIR="${DATA_DIR:-$ROOT/data}"
BACKUP_ROOT="${BACKUP_ROOT:-$ROOT/backups}"

require_container() {
  if ! docker ps --filter "name=^${CONTAINER}$" --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    echo "错误: 数据库容器 ${CONTAINER} 未运行（先 bash scripts/dev-db.sh）" >&2
    exit 1
  fi
}

do_backup() {
  require_container
  local stamp dir
  stamp="$(date +%Y-%m-%d_%H%M%S)"
  dir="$BACKUP_ROOT/$stamp"
  mkdir -p "$dir"

  echo "── 备份库 ${CONTAINER}/${DB_NAME} → $dir/pg.dump ──"
  docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$dir/pg.dump"

  echo "── 备份附件卷 $DATA_DIR → $dir/data.tar.gz ──"
  if [ -d "$DATA_DIR" ]; then
    tar -czf "$dir/data.tar.gz" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")"
  else
    : > "$dir/data.tar.gz.EMPTY"   # 明确记录「无附件目录」而非静默跳过
    echo "提示: $DATA_DIR 不存在，已留 EMPTY 标记"
  fi

  # 校验：dump 能被 pg_restore 读取（防止管道截断产生「看起来成功」的空备份）
  docker exec -i "$CONTAINER" pg_restore -l > /dev/null < "$dir/pg.dump"
  printf 'table_count=%s\n' "$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")" > "$dir/manifest.txt"
  printf 'created_at=%s\ncontainer=%s\ndb=%s\n' "$stamp" "$CONTAINER" "$DB_NAME" >> "$dir/manifest.txt"

  echo "✅ 备份完成: $dir"
  cat "$dir/manifest.txt"
  echo "$dir"
}

do_restore() {
  local dir="${1:?用法: bash scripts/backup.sh restore <备份目录>}"
  require_container
  [ -f "$dir/pg.dump" ] || { echo "错误: $dir/pg.dump 不存在" >&2; exit 1; }

  echo "── 恢复库（先清空再导入，容器 ${CONTAINER}/${DB_NAME}）──"
  # --clean --if-exists：覆盖式恢复，无需 DROP DATABASE（连接中的库不能删）
  docker exec -i "$CONTAINER" pg_restore -U "$DB_USER" -d "$DB_NAME" --clean --if-exists --no-owner < "$dir/pg.dump"

  if [ -f "$dir/data.tar.gz" ]; then
    echo "── 恢复附件卷 → $DATA_DIR ──"
    rm -rf "$DATA_DIR"
    tar -xzf "$dir/data.tar.gz" -C "$(dirname "$DATA_DIR")"
  fi

  echo "── 核对（表数 / 关键行数）──"
  docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema='public') AS tables,
            (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM projects) AS projects,
            (SELECT count(*) FROM bugs) AS bugs, (SELECT count(*) FROM attachments) AS attachments"
  echo "✅ 恢复完成（与备份 manifest 对照）"
}

case "${1:-backup}" in
  backup) do_backup ;;
  restore) shift; do_restore "$@" ;;
  *) echo "用法: bash scripts/backup.sh [backup|restore <目录>]" >&2; exit 1 ;;
esac
