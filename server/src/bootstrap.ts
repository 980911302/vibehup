/**
 * 容器启动引导（卡片 30 死锁修复）：
 * 等 PostgreSQL 就绪 → 建 pgvector 扩展 → 应用迁移 → 启动 HTTP 服务。
 *
 * 为什么有本文件：原设计由 entrypoint.sh 先等 PG 再 exec supervisord，但 PG 恰由
 * supervisord 管理——顺序倒置导致永远等不到（实际容器 60s 超时后建扩展失败退出）。
 * 现由 supervisord 并行拉起 postgres(pri 10) 与本程序(pri 20)，就绪等待收敛到本程序内。
 */

import { execSync } from 'node:child_process';

const PGUSER = process.env.POSTGRES_USER ?? 'vibehub';
const PGDB = process.env.POSTGRES_DB ?? 'vibehub';

function run(label: string, cmd: string): void {
  console.log(`[bootstrap] ${label}…`);
  execSync(cmd, { stdio: 'inherit', env: process.env });
}

// 等 PG 就绪（pg_isready 由 pgvector 基底镜像提供）
let ready = false;
for (let i = 0; i < 60; i++) {
  try {
    execSync(`pg_isready -h 127.0.0.1 -U "${PGUSER}" -q`, { stdio: 'ignore' });
    ready = true;
    break;
  } catch {
    execSync('sleep 1');
  }
}
if (!ready) {
  console.error('[bootstrap] PostgreSQL 60 秒内未就绪，退出等 supervisord 重启');
  process.exit(1);
}

run('创建 pgvector 扩展（幂等）', `psql -h 127.0.0.1 -U "${PGUSER}" -d "${PGDB}" -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS vector;'`);
run('应用数据库迁移（幂等）', 'npx prisma migrate deploy --schema=/app/prisma/schema.prisma');

console.log('[bootstrap] 启动 HTTP 服务（API + Web 看板 + SSE + MCP SSE）');
const { main } = await import('./index.js');
await main();
