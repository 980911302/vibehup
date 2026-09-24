/**
 * 远端首启引导（在容器内执行）：把服务端验收产生的 Owner 提升为正式 Owner，
 * 并签发一把试用密钥。幂等：重复执行只补缺失部分。
 *
 * 为什么需要：容器首启时服务端 acceptance 脚本内部注册过一个 Owner，但那个账号
 * 邮箱是占位地址；这里把它改成用户邮箱并签发密钥，省去「注册→拿令牌→建密钥」的手工步骤。
 * 若库里没有 Owner（全新库），则注册一个（需要密码哈希，与本脚本同库同算法）。
 */
const { PrismaClient } = require('@prisma/client');
const { createHash, randomBytes, scryptSync } = require('node:crypto');

const EMAIL = process.env.BOOTSTRAP_EMAIL;
const PASSWORD = process.env.BOOTSTRAP_PASSWORD;
// 凭据一律由环境变量传入，**不提供默认值**——带默认密码的引导脚本一旦公开，
// 等于给所有人一个可猜的初始口令。缺失即快速失败，避免「悄悄用了弱默认值」。
if (!EMAIL || !PASSWORD) {
  console.error('缺少 BOOTSTRAP_EMAIL / BOOTSTRAP_PASSWORD。用法示例：');
  console.error('  docker exec -i -e DATABASE_URL=... -e BOOTSTRAP_EMAIL=you@example.com \\');
  console.error("    -e BOOTSTRAP_PASSWORD='<强密码>' vibehub node - < bootstrap-owner.cjs");
  process.exit(1);
}
const KEY_SCOPES = (process.env.BOOTSTRAP_SCOPES || 'context:read,attachment:read,attachment:write,bug:write').split(',');

const hashToken = (t) => createHash('sha256').update(t).digest('hex');
/**
 * 与 server/src/core/password.ts 同格式：`scrypt$N$r$p$saltBase64$hashBase64`
 * （N=16384, r=8, p=1, keylen=64）——格式写错会导致「密码正确却登录失败」。
 */
function hashPassword(password) {
  const N = 16384;
  const r = 8;
  const p = 1;
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N, r, p });
  return ['scrypt', N, r, p, salt.toString('base64'), derived.toString('base64')].join('$');
}

(async () => {
  const prisma = new PrismaClient();
  let owner = await prisma.user.findFirst({ where: { role: 'owner' } });
  if (owner) {
    owner = await prisma.user.update({
      where: { id: owner.id },
      data: { email: EMAIL, name: 'zhanglinlin', status: 'active' },
    });
    console.log(`OWNER_MODE=promoted (${owner.id})`);
  } else {
    owner = await prisma.user.create({
      data: {
        id: `usr_${randomBytes(8).toString('hex')}`,
        email: EMAIL,
        passwordHash: hashPassword(PASSWORD),
        name: 'zhanglinlin',
        role: 'owner',
        status: 'active',
      },
    });
    console.log(`OWNER_MODE=created (${owner.id})`);
  }

  const existing = await prisma.apiKey.findFirst({ where: { name: 'remote-trial', revokedAt: null } });
  if (existing) {
    console.log('KEY_MODE=exists（已有一把未撤销的 remote-trial；如需明文请在 Web 密钥页重新签发）');
    console.log(`KEY_ID=${existing.id}`);
  } else {
    const plain = `vhk_live_${randomBytes(24).toString('base64url')}`;
    const key = await prisma.apiKey.create({
      data: {
        id: `key_${randomBytes(8).toString('hex')}`,
        name: 'remote-trial',
        keyPrefix: plain.slice(0, 13),
        keyHash: hashToken(plain),
        salt: randomBytes(16).toString('base64'),
        scopes: KEY_SCOPES,
        rateLimit: 300,
        expiresAt: new Date(Date.now() + 90 * 86_400_000),
        createdBy: owner.id,
      },
    });
    console.log(`KEY_ID=${key.id}`);
    console.log(`KEY_PLAINTEXT=${plain}`);
  }
  console.log(`OWNER_EMAIL=${owner.email}`);
  const counts = {
    users: await prisma.user.count(),
    projects: await prisma.project.count(),
    bugs: await prisma.bug.count(),
  };
  console.log(`COUNTS=${JSON.stringify(counts)}`);
  await prisma.$disconnect();
})().catch((e) => { console.error('BOOTSTRAP_FAILED:', e.message); process.exit(1); });
