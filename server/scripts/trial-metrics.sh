#!/usr/bin/env bash
# 试用期指标（R77，只读）：对照 docs/计划/09-真实试用与范围冻结.md §4 成功标准。
# 默认读验收库容器 vibehub-dev-db；Docker 部署形态可覆盖：
#   CONTAINER=vibehub DB_USER=vibehub DB_NAME=vibehub bash scripts/trial-metrics.sh 2026-09-24
# 用法：bash scripts/trial-metrics.sh [试用起始日期 YYYY-MM-DD，缺省统计全部]
set -euo pipefail

SINCE="${1:-1970-01-01}"
CONTAINER="${CONTAINER:-vibehub-dev-db}"
DB_USER="${DB_USER:-vibehub}"
DB_NAME="${DB_NAME:-vibehub}"

if ! docker ps --filter "name=^${CONTAINER}$" --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "错误: 数据库容器 ${CONTAINER} 未运行（验收库请先 bash scripts/dev-db.sh）" >&2
  exit 1
fi

run_sql() {
  docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -v since="$SINCE" -tA -F '|'
}

# 一行一个指标：key|value（:'since' 由 psql 变量插值，heredoc 加引号防 bash 展开）
METRICS=$(run_sql <<'SQL'
SELECT 'bugs_human', count(*) FROM bugs
  WHERE created_by = 'human' AND created_at >= :'since'::timestamp
UNION ALL
SELECT 'bugs_with_image', count(DISTINCT b.id) FROM bugs b
  JOIN attachments a ON a.entity_type = 'bug' AND a.entity_id = b.id AND a.file_type LIKE 'image/%'
  WHERE b.created_by = 'human' AND b.created_at >= :'since'::timestamp
UNION ALL
SELECT 'ai_resolved', count(DISTINCT bug_id) FROM bug_comments
  WHERE author_type = 'ai' AND content LIKE '状态变更：% → resolved%' AND created_at >= :'since'::timestamp
UNION ALL
SELECT 'token_reused', count(*) FROM usage_events
  WHERE event_type = 'auth.token_reused' AND created_at >= :'since'::timestamp
UNION ALL
SELECT 'mcp_ok', count(*) FROM usage_events
  WHERE event_type = 'mcp.tool_call' AND metadata::json->>'result' = 'ok' AND created_at >= :'since'::timestamp
UNION ALL
SELECT 'mcp_error', count(*) FROM usage_events
  WHERE event_type = 'mcp.tool_call' AND metadata::json->>'result' = 'error' AND created_at >= :'since'::timestamp
UNION ALL
SELECT 'trial_open', count(*) FROM bugs
  WHERE 'trial' = ANY(labels) AND status IN ('open', 'in_progress') AND created_at >= :'since'::timestamp
UNION ALL
SELECT 'trial_total', count(*) FROM bugs
  WHERE 'trial' = ANY(labels) AND created_at >= :'since'::timestamp;
SQL
)

# AI 创建的缺陷按项目分布（人工核对有没有写错项目）
AI_BY_PROJECT=$(run_sql <<'SQL'
SELECT p.name || '（' || p.slug || '）', count(*) FROM bugs b JOIN projects p ON p.id = b.project_id
  WHERE b.created_by = 'ai' AND b.created_at >= :'since'::timestamp
  GROUP BY p.name, p.slug ORDER BY 2 DESC;
SQL
)

get() { echo "$METRICS" | awk -F'|' -v k="$1" '$1 == k { print $2 }'; }
verdict() { if [ "$1" = "1" ]; then echo "达标"; else echo "未达标"; fi; }

BUGS_HUMAN=$(get bugs_human)
BUGS_IMAGE=$(get bugs_with_image)
AI_RESOLVED=$(get ai_resolved)
TOKEN_REUSED=$(get token_reused)
MCP_OK=$(get mcp_ok)
MCP_ERR=$(get mcp_error)

AI_RATIO=$(awk -v a="$AI_RESOLVED" -v b="$BUGS_HUMAN" 'BEGIN { if (b > 0) printf "%.0f", a * 100 / b; else print 0 }')
MCP_ERR_RATE=$(awk -v e="$MCP_ERR" -v o="$MCP_OK" 'BEGIN { t = e + o; if (t > 0) printf "%.1f", e * 100 / t; else print "0.0" }')

echo "VibeHub 试用指标（自 ${SINCE} 起，容器 ${CONTAINER}）"
echo "  截图录入的缺陷：${BUGS_IMAGE}（目标 ≥20）→ $(verdict "$([ "$BUGS_IMAGE" -ge 20 ] && echo 1)")"
echo "  AI 经 MCP 推进到 resolved：${AI_RESOLVED} / 人工新建 ${BUGS_HUMAN}（${AI_RATIO}%，目标 ≥50%）→ $(verdict "$([ "$BUGS_HUMAN" -gt 0 ] && [ "$AI_RATIO" -ge 50 ] && echo 1)")"
echo "  刷新令牌重放触发：${TOKEN_REUSED}（目标 0）→ $(verdict "$([ "$TOKEN_REUSED" -eq 0 ] && echo 1)")"
echo "  MCP 调用：成功 ${MCP_OK} / 失败 ${MCP_ERR}（失败率 ${MCP_ERR_RATE}%，仅记录）"
echo "  试用摩擦（trial 标签缺陷）：未关闭 $(get trial_open) / 共 $(get trial_total)"
echo "  AI 创建的缺陷按项目分布（人工核对是否写错项目）："
if [ -n "$AI_BY_PROJECT" ]; then
  echo "$AI_BY_PROJECT" | awk -F'|' '{ printf "    %s  %s\n", $1, $2 }'
else
  echo "    （无）"
fi
