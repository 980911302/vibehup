/**
 * 一次性：为验收库的 Owner 签发一把 MCP 密钥并打印明文（仅本次输出）。
 *
 * 为什么不用 HTTP /api/api-keys：该路由挂登录守卫，当前没有可用令牌（无密码），
 * 而密钥必须 created_by = Owner 才能享受成员禁用联动（AGENTS.md §5）。
 * 本脚本按 services/api-keys.ts 的 createKey 完全同款口径写入：
 * 明文 `vhk_live_` + 24 字节 base64url、keyPrefix=前 13 字符、keyHash=SHA-256(明文)、
 * salt=16 字节 base64（schema 要求，校验实际用 hashToken）。
 *
 * 用法：DATABASE_URL=<验收库> npx tsx scripts/issue-mcp-key.mjs
 * scope 默认取 docs/计划/09 §3 的试用推荐集，可用 SCOPES=a,b 覆盖；TTL_DAYS 控制有效期（默认 90，0=不过期）。
 *
 * ⚠️ 明文会打到 stdout——不要把输出重定向进任何会被提交或被日志采集的文件。
 * 仅用于「没有可用登录令牌、又需要按 Owner 身份签发」的引导场景；常规签发请走 Web 密钥页。
 */
import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const hashToken = (t) => createHash('sha256').update(t).digest('hex');

const owner = await prisma.user.findFirst({ where: { role: 'owner', status: 'active' } });
if (!owner) {
  console.error('错误: 验收库里没有 active 的 owner 账号');
  process.exit(1);
}

const scopes = (process.env.SCOPES ?? 'context:read,attachment:read,attachment:write,bug:write')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ttlDays = Number(process.env.TTL_DAYS ?? 90);
// 与 createKey 一致：randomBytes(24).toString('base64url')
const id = `key_${randomBytes(8).toString('hex')}`;
const plaintext = `vhk_live_${randomBytes(24).toString('base64url')}`;

await prisma.apiKey.create({
  data: {
    id,
    name: process.env.KEY_NAME ?? 'zhanglinlin-trial',
    keyPrefix: plaintext.slice(0, 13),
    keyHash: hashToken(plaintext),
    salt: randomBytes(16).toString('base64'),
    scopes,
    rateLimit: 300,
    expiresAt: ttlDays > 0 ? new Date(Date.now() + ttlDays * 86_400_000) : null,
    createdBy: owner.id,
  },
});

console.log(`✅ 已签发（Owner: ${owner.email}）`);
console.log(`ID     : ${id}`);
console.log(`scope  : ${scopes.join(', ')}`);
console.log(`有效期 : ${ttlDays > 0 ? `${ttlDays} 天（${new Date(Date.now() + ttlDays * 86_400_000).toISOString().slice(0, 10)} 到期）` : '不过期'}`);
console.log(`明文   : ${plaintext}`);
await prisma.$disconnect();
