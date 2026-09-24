#!/usr/bin/env bash
# VibeHub 后端一键验收门禁（步骤 05 §5.4）。
# 顺序：测试库 → tsc → vitest → 起服务 curl 冒烟 → 汇总退出码。
# 用法：bash scripts/acceptance.sh
set -uo pipefail

cd "$(dirname "$0")/.."
cd server 2>/dev/null || true

PORT=3456
BASE="http://127.0.0.1:${PORT}"
E2E_PORT=3457
FAIL=0
PASS=0

step() { echo; echo "── $1 ──"; }
ok()   { echo "  PASS $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL $1"; FAIL=$((FAIL+1)); }

# 断言：命令成功
expect_ok() { if eval "$2" > /dev/null 2>&1; then ok "$1"; else bad "$1"; fi; }
# 断言：输出包含
expect_contains() {
  local out; out=$(eval "$2" 2>/dev/null)
  if echo "$out" | grep -q "$3"; then ok "$1"; else bad "$1（输出: $(echo "$out" | head -c 120)）"; fi
}

step "1/6 测试数据库（pgvector 容器）"
TEST_DATABASE_URL=$(bash scripts/test-db.sh 2>/dev/null)
if [ -n "${TEST_DATABASE_URL}" ]; then ok "测试库就绪 ${TEST_DATABASE_URL}"; else bad "测试库启动失败（Docker 是否在运行）"; exit 1; fi

step "2/6 TypeScript 类型检查"
if npx tsc --noEmit > /tmp/vh-tsc.log 2>&1; then ok "tsc --noEmit"; else bad "tsc 编译错误"; tail -5 /tmp/vh-tsc.log; fi

step "3/6 vitest 全量测试"
if TEST_DATABASE_URL="${TEST_DATABASE_URL}" npx vitest run > /tmp/vh-vitest.log 2>&1; then
  ok "$(grep -oE 'Tests +[0-9]+ passed' /tmp/vh-vitest.log | tail -1)"
else
  bad "vitest 失败"; grep -E "×|FAIL" /tmp/vh-vitest.log | head -10
fi

step "4/6 HTTP 冒烟（:${PORT}）"
SERVER_PID=""
cleanup() { [ -n "${SERVER_PID}" ] && kill "${SERVER_PID}" 2>/dev/null; }
trap cleanup EXIT

# 卡片 28：冒烟服务显式关闭语义检索，门禁 hermetic（不打 DashScope 外网）
DATABASE_URL="${TEST_DATABASE_URL}" DATA_DIR=./acceptance-data PORT=${PORT} EMBEDDING_PROVIDER=none npx tsx src/index.ts > /tmp/vh-server.log 2>&1 &
SERVER_PID=$!

# 等待健康检查
READY=0
for _ in $(seq 1 40); do
  if curl -sf "${BASE}/api/health" > /dev/null 2>&1; then READY=1; break; fi
  sleep 0.5
done
if [ "${READY}" = "1" ]; then ok "服务启动 + /api/health"; else bad "服务未就绪"; tail -10 /tmp/vh-server.log; fi

# 4.1 无令牌 401
expect_contains "无令牌访问业务路由 401" \
  "curl -s ${BASE}/api/projects" '"UNAUTHORIZED"'

# 4.2 注册第一个用户 = owner
REG=$(curl -s -XPOST "${BASE}/api/auth/register" -H 'content-type: application/json' \
  -d '{"email":"accept@vibehub.local","password":"abcd1234","name":"验收用户"}')
TOKEN=$(echo "${REG}" | node -e "try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.access_token||'')}catch{}")
expect_contains "注册首个用户返回 owner" "echo '${REG}'" '"role":"owner"'
[ -n "${TOKEN}" ] && ok "拿到 access_token" || bad "未拿到 access_token"

# 4.3 带令牌建项目
PROJ=$(curl -s -XPOST "${BASE}/api/projects" -H "authorization: Bearer ${TOKEN}" -H 'content-type: application/json' \
  -d '{"name":"验收项目"}')
PID=$(echo "${PROJ}" | node -e "try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.id||'')}catch{}")
[ -n "${PID}" ] && ok "建项目成功" || bad "建项目失败：${PROJ}"

# 4.4 上传附件（multipart）
UPLOAD=$(curl -s -XPOST "${BASE}/api/upload" -H "authorization: Bearer ${TOKEN}" \
  -F "project_id=${PID}" -F "files=@/tmp/vh-accept.txt;type=text/plain" 2>/dev/null)
echo "acceptance smoke" > /tmp/vh-accept.txt
UPLOAD=$(curl -s -XPOST "${BASE}/api/upload" -H "authorization: Bearer ${TOKEN}" \
  -F "project_id=${PID}" -F "files=@/tmp/vh-accept.txt;type=text/plain")
expect_contains "上传附件带 uploaded_by" "echo '${UPLOAD}'" '"uploaded_by"'

# 4.5 建缺陷 + 看板
BUG=$(curl -s -XPOST "${BASE}/api/bugs" -H "authorization: Bearer ${TOKEN}" -H 'content-type: application/json' \
  -d "{\"project_id\":\"${PID}\",\"title\":\"验收缺陷\",\"priority\":\"high\"}")
expect_contains "建缺陷 priority=high" "echo '${BUG}'" '"priority":"high"'
BID=$(echo "${BUG}" | node -e "try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.id||'')}catch{}")
BOARD=$(curl -s "${BASE}/api/bugs/board/${PID}" -H "authorization: Bearer ${TOKEN}")
expect_contains "看板含该缺陷" "echo '${BOARD}'" '"验收缺陷"'

# 4.6 状态机：open → in_progress
MOVED=$(curl -s -XPATCH "${BASE}/api/bugs/${BID}" -H "authorization: Bearer ${TOKEN}" -H 'content-type: application/json' \
  -d '{"status":"in_progress"}')
expect_contains "拖拽改状态 in_progress" "echo '${MOVED}'" '"status":"in_progress"'

# 4.7 MCP SSE 端点：无密钥 401
expect_contains "MCP SSE 无密钥 401" "curl -s ${BASE}/mcp/sse" '"UNAUTHORIZED"'

# 4.8 清理冒烟数据（禁演示数据规则：验收写入仅存于测试库）
cleanup
SERVER_PID=""
docker exec vibehub-test-db psql -U postgres -c \
  'TRUNCATE "bug_comments","bugs","attachments","saved_views","bug_templates","notes","tasks","usage_events","refresh_tokens","api_keys","projects","users","skill_files","skills" RESTART IDENTITY CASCADE' > /dev/null 2>&1 \
  && ok "冒烟数据已清理" || bad "冒烟数据清理失败"

step "5/6 核心闭环 E2E（Playwright + MCP stdio，:${E2E_PORT}）"
E2E_BASE="http://127.0.0.1:${E2E_PORT}"

# E2E 用全新库：残留 owner 会让新注册用户降级为 member，建项目 403（首用户才自动 Owner）
docker exec vibehub-test-db psql -U postgres -q -c \
  'TRUNCATE "bug_comments","bugs","attachments","saved_views","bug_templates","notes","tasks","usage_events","refresh_tokens","api_keys","projects","users","embeddings","skill_files","skills" RESTART IDENTITY CASCADE' > /dev/null 2>&1
rm -f tests/e2e/.test-owner.json   # 夹具的 Owner 凭据缓存（随库清空一起失效）

# 静态产物新鲜度：缺 out/index.html 或关键页面早于源码则重建（不每次全量 build，门禁要快）
if [ ! -f ../web/out/index.html ] || [ -n "$(find ../web/src ../web/next.config.ts -newer ../web/out/index.html -print -quit 2>/dev/null)" ]; then
  echo "  · web/out 缺失或落后于源码，重建静态产物…"
  if (cd ../web && npx next build > /tmp/vh-web-build.log 2>&1); then ok "web 静态产物已重建"; else bad "next build 失败"; tail -5 /tmp/vh-web-build.log; fi
else
  ok "web 静态产物为最新（跳过 build）"
fi

E2E_PID=""
cleanup_e2e() { [ -n "${E2E_PID}" ] && kill "${E2E_PID}" 2>/dev/null; }
trap 'cleanup; cleanup_e2e' EXIT

# LOGIN_MAX_ATTEMPTS 放宽：E2E 多用例复用同一 owner 登录，默认 5 次阈值会误伤门禁
DATABASE_URL="${TEST_DATABASE_URL}" DATA_DIR=./acceptance-e2e-data PORT=${E2E_PORT} EMBEDDING_PROVIDER=none LOGIN_MAX_ATTEMPTS=100 npx tsx src/index.ts > /tmp/vh-e2e-server.log 2>&1 &
E2E_PID=$!
E2E_READY=0
for _ in $(seq 1 40); do
  if curl -sf "${E2E_BASE}/api/health" > /dev/null 2>&1; then E2E_READY=1; break; fi
  sleep 0.5
done
if [ "${E2E_READY}" = "1" ]; then ok "E2E 服务就绪"; else bad "E2E 服务未就绪"; tail -10 /tmp/vh-e2e-server.log; fi

if [ "${E2E_READY}" = "1" ]; then
  # DATABASE_URL 必须传给 Playwright：MCP stdio 子进程与 HTTP 服务须同库，否则子进程落 dev 库查不到密钥
  if DATABASE_URL="${TEST_DATABASE_URL}" E2E_BASE="${E2E_BASE}" npx playwright test -c playwright.config.ts > /tmp/vh-e2e.log 2>&1; then
    ok "E2E $(grep -oE '[0-9]+ passed' /tmp/vh-e2e.log | tail -1)"
  else
    bad "E2E 失败"; tail -20 /tmp/vh-e2e.log
  fi
fi

# F5 实证：浏览器看板会连 /api/events，日志里必须能看到该请求但**不得出现令牌明文**
if grep -q '/api/events?token=\[已脱敏\]' /tmp/vh-e2e-server.log; then
  ok "访问日志已脱敏（/api/events token 不落明文）"
else
  bad "未见脱敏后的 /api/events 日志（F5 回归）"
fi
if grep -q 'eyJhbGciOiJIUzI1NiIs' /tmp/vh-e2e-server.log; then
  bad "E2E 服务日志出现 JWT 明文（脱敏失败）"
else
  ok "E2E 服务日志无 JWT 明文"
fi

cleanup_e2e
E2E_PID=""
docker exec vibehub-test-db psql -U postgres -c \
  'TRUNCATE "bug_comments","bugs","attachments","saved_views","bug_templates","notes","tasks","usage_events","refresh_tokens","api_keys","projects","users","embeddings","skill_files","skills" RESTART IDENTITY CASCADE' > /dev/null 2>&1

step "6/6 汇总"
echo "  PASS=${PASS}  FAIL=${FAIL}"
rm -rf acceptance-data acceptance-e2e-data /tmp/vh-accept.txt
[ "${FAIL}" -eq 0 ] && echo "✅ 验收通过" || echo "❌ 验收失败（${FAIL} 项）"
exit $([ "${FAIL}" -eq 0 ] && echo 0 || echo 1)
