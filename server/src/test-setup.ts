import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

/**
 * 测试环境准备：连一次性 pg 容器（与生产同引擎），建 vector 扩展，应用迁移。
 * 用法：bash scripts/test-db.sh 起容器 → TEST_DATABASE_URL=... npx vitest run
 */

// 测试库连接串（缺省指向 scripts/test-db.sh 的容器）
process.env.TEST_DATABASE_URL ??= 'postgresql://postgres:test@127.0.0.1:55432/postgres';
// Prisma 客户端在首次 import 时读 DATABASE_URL，必须先设置
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
// 语义检索测试卫生（卡片 28）：默认 none，写路径不打 DashScope 外网；
// DashScope 客户端本身由 embedding.test.ts 用 vi.mock 覆盖 config.embedding 开启态验证
process.env.EMBEDDING_PROVIDER = 'none';

// 应用迁移（幂等）
try {
  execSync('npx prisma migrate deploy', {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'ignore',
  });
} catch (err) {
  console.error('测试库迁移失败（确认 scripts/test-db.sh 已起容器）:', err);
  process.exit(1);
}

// pgvector 扩展（migration 内亦有幂等创建，此处双保）
const { prisma } = await import('./core/prisma.js');
try {
  await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector');
} catch (err) {
  console.error('vector 扩展创建失败:', err);
  process.exit(1);
}
await prisma.$disconnect();

// 冒烟产物目录（tests 用相对 DATA_DIR，避免写真实 data/）
fs.mkdirSync(path.resolve(process.cwd(), 'test-data'), { recursive: true });
process.env.DATA_DIR = path.resolve(process.cwd(), 'test-data');
