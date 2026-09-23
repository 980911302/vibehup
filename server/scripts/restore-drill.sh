#!/usr/bin/env bash
# 备份恢复演练（卡片 F7）：在**测试库**上做破坏性演练——备份 → 清库 → 恢复 → 核对。
# 刻意不用验收库（vibehub-dev-db 承载用户真实数据，演练不得触碰）。
#
# 用法：bash scripts/restore-drill.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"   # server/
export CONTAINER="vibehub-test-db"
export DB_USER="postgres"
export DB_NAME="postgres"
# 演练用独立数据目录，绝不覆盖验收附件
export DATA_DIR="$ROOT/test-data-drill"
export BACKUP_ROOT="$ROOT/backups-drill"

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  PASS $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }

q() { docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc "$1"; }

echo "── 0/5 准备：测试库容器 + 演练数据（含附件文件）──"
if ! docker ps --filter "name=^${CONTAINER}$" --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "错误: 测试库容器未运行（bash scripts/test-db.sh）" >&2
  exit 1
fi
rm -rf "$DATA_DIR" "$BACKUP_ROOT"
mkdir -p "$DATA_DIR/attachments"
echo "drill-attachment-payload" > "$DATA_DIR/attachments/drill.txt"

TOKEN="drill-$(date +%s)"
docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -q -c \
  "INSERT INTO users (id, email, password_hash, name, role, status, created_at, updated_at)
   VALUES ('usr_drill', '${TOKEN}@t.com', 'x', '演练用户', 'owner', 'active', now(), now())
   ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email"
BEFORE_USERS=$(q "SELECT count(*) FROM users")
BEFORE_BUGS=$(q "SELECT count(*) FROM bugs")
echo "  演练标记 ${TOKEN}；before: users=${BEFORE_USERS} bugs=${BEFORE_BUGS}"
[ "$(q "SELECT count(*) FROM users WHERE email='${TOKEN}@t.com'")" = "1" ] && ok "演练数据已写入" || bad "演练数据写入失败"

echo "── 1/5 备份 ──"
BACKUP_DIR="$(bash "$ROOT/scripts/backup.sh" backup | tail -1)"
[ -f "$BACKUP_DIR/pg.dump" ] && ok "pg.dump 已生成" || bad "pg.dump 缺失"
[ -s "$BACKUP_DIR/data.tar.gz" ] && ok "data.tar.gz 已生成" || bad "data.tar.gz 缺失"

echo "── 2/5 清库（模拟灾难：TRUNCATE 全表 + 删附件）──"
docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -q -c \
  'TRUNCATE "bug_comments","bugs","attachments","saved_views","bug_templates","notes","tasks","usage_events","refresh_tokens","api_keys","projects","users","embeddings" RESTART IDENTITY CASCADE'
rm -rf "$DATA_DIR/attachments"
[ "$(q "SELECT count(*) FROM users")" = "0" ] && ok "已清空（users=0）" || bad "清空失败"

echo "── 3/5 恢复 ──"
bash "$ROOT/scripts/backup.sh" restore "$BACKUP_DIR" > /dev/null
ok "restore 命令退出 0"

echo "── 4/5 核对数据一致 ──"
AFTER_USERS=$(q "SELECT count(*) FROM users")
AFTER_BUGS=$(q "SELECT count(*) FROM bugs")
[ "$AFTER_USERS" = "$BEFORE_USERS" ] && ok "users 一致（${BEFORE_USERS}→${AFTER_USERS}）" || bad "users 不一致（${BEFORE_USERS}→${AFTER_USERS}）"
[ "$AFTER_BUGS" = "$BEFORE_BUGS" ] && ok "bugs 一致（${BEFORE_BUGS}→${AFTER_BUGS}）" || bad "bugs 不一致（${BEFORE_BUGS}→${AFTER_BUGS}）"
[ "$(q "SELECT count(*) FROM users WHERE email='${TOKEN}@t.com'")" = "1" ] && ok "演练标记行已恢复" || bad "演练标记行丢失"

echo "── 5/5 核对附件卷 ──"
[ -f "$DATA_DIR/attachments/drill.txt" ] && ok "附件文件已恢复" || bad "附件文件未恢复"
[ "$(cat "$DATA_DIR/attachments/drill.txt" 2>/dev/null)" = "drill-attachment-payload" ] && ok "附件内容一致" || bad "附件内容不一致"

echo
echo "PASS=${PASS}  FAIL=${FAIL}"
[ "$FAIL" = "0" ] && { echo "✅ 备份恢复演练通过"; exit 0; } || { echo "❌ 演练失败"; exit 1; }
