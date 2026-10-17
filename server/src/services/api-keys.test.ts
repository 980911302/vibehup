import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../index.js';
import { prisma } from '../core/prisma.js';
import { resetDb, createUser, authHeaders } from '../test-helpers.js';
import * as apiKeysService from './api-keys.js';
import { loadKeyedContext } from '../mcp/context.js';

/** MCP 密钥管理单测（商业产品计划 §4：10 例） */

let app: FastifyInstance;

beforeEach(async () => {
  await resetDb();
  app = await buildServer();
  await app.ready();
});

describe('createKey', () => {
  it('返回一次性明文；库中存哈希 + 密文（无明文）', async () => {
    const owner = await createUser({ email: 'o@t.com' });
    const { key, view } = await apiKeysService.createKey({ name: 'cursor', createdBy: owner.user.id });
    expect(key.startsWith('vhk_live_')).toBe(true);
    expect(view.masked.startsWith(key.slice(0, 13))).toBe(true);
    expect(view.can_reveal).toBe(true);
    const row = await prisma.apiKey.findUnique({ where: { id: view.id } });
    expect(row!.keyHash).not.toContain(key);
    expect(JSON.stringify(row)).not.toContain(key.slice(13)); // 明文不入库
    expect(row!.keyCipher).toBeTruthy(); // R87：存的是密文
    expect(row!.keyCipher).not.toContain(key);
    // 密文可无损解回同一把密钥
    await expect(apiKeysService.revealKey(view.id)).resolves.toMatchObject({ key, name: 'cursor' });
  });

  it('默认最小权限 scope + 90 天过期', async () => {
    const owner = await createUser({ email: 'o@t.com' });
    const { view } = await apiKeysService.createKey({ name: 'default', createdBy: owner.user.id });
    expect(view.scopes).toEqual(['context:read']);
    const days = (new Date(view.expires_at!).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThanOrEqual(90);
  });

  it('自定义 scope / 限速 / 永久有效期（null）', async () => {
    const owner = await createUser({ email: 'o@t.com' });
    const { view } = await apiKeysService.createKey({
      name: 'ci', scopes: ['context:read', 'bug:write'], rateLimit: 60, expiresInDays: null, createdBy: owner.user.id,
    });
    expect(view.scopes).toContain('bug:write');
    expect(view.rate_limit).toBe(60);
    expect(view.expires_at).toBeNull();
    expect(view.status).toBe('active');
  });

  it('未知 scope / 非法限速拒绝', async () => {
    const owner = await createUser({ email: 'o@t.com' });
    await expect(apiKeysService.createKey({ name: 'x', scopes: ['root'], createdBy: owner.user.id })).rejects.toThrow('未知 scope');
    await expect(apiKeysService.createKey({ name: 'x', rateLimit: 0, createdBy: owner.user.id })).rejects.toThrow('rate_limit');
  });
});

describe('listKeys 掩码', () => {
  it('列表不含明文与哈希', async () => {
    const owner = await createUser({ email: 'o@t.com' });
    const { key } = await apiKeysService.createKey({ name: 'k1', createdBy: owner.user.id });
    const list = await apiKeysService.listKeys();
    expect(list).toHaveLength(1);
    expect(list[0].masked).toContain('•');
    const raw = JSON.stringify(list);
    expect(raw).not.toContain(key);
    expect(raw).not.toContain('keyHash');
  });
});

describe('rotateKey 轮换', () => {
  it('新密钥可用；旧密钥进入 24h 宽限（未立即失效）', async () => {
    const owner = await createUser({ email: 'o@t.com' });
    const { key: oldKey, view } = await apiKeysService.createKey({ name: 'rot', createdBy: owner.user.id });
    const rotated = await apiKeysService.rotateKey(view.id, owner.user.id);

    // 新密钥可解析上下文
    const newCtx = await loadKeyedContext(rotated.key);
    expect(newCtx.apiKeyId).toBe(rotated.view.id);

    // 旧密钥仍在宽限期内（未撤销，只是 expiry 压缩到 +24h）
    const oldCtx = await loadKeyedContext(oldKey);
    expect(oldCtx.apiKeyId).toBe(view.id);
    const oldRow = await prisma.apiKey.findUnique({ where: { id: view.id } });
    const hoursLeft = (oldRow!.expiresAt!.getTime() - Date.now()) / 3_600_000;
    expect(hoursLeft).toBeLessThanOrEqual(24);
    expect(hoursLeft).toBeGreaterThan(23);
    expect(rotated.previous_grace_until).toBeTruthy();
  });

  it('已撤销密钥不能轮换', async () => {
    const owner = await createUser({ email: 'o@t.com' });
    const { view } = await apiKeysService.createKey({ name: 'rev', createdBy: owner.user.id });
    await apiKeysService.revokeKey(view.id);
    await expect(apiKeysService.rotateKey(view.id, owner.user.id)).rejects.toThrow('已撤销');
  });
});

describe('revokeKey 与 MCP 联动', () => {
  it('撤销后 MCP 立即拒识（人话错误）', async () => {
    const owner = await createUser({ email: 'o@t.com' });
    const { key, view } = await apiKeysService.createKey({ name: 'kill', createdBy: owner.user.id });
    await apiKeysService.revokeKey(view.id);
    await expect(loadKeyedContext(key)).rejects.toThrow('撤销');
  });

  it('撤销后明文不可再查看（R87）', async () => {
    const owner = await createUser({ email: 'o@t.com' });
    const { view } = await apiKeysService.createKey({ name: 'kill2', createdBy: owner.user.id });
    await apiKeysService.revokeKey(view.id);
    await expect(apiKeysService.revealKey(view.id)).rejects.toThrow('已撤销');
  });
});

describe('revealKey 查看明文（R87）', () => {
  it('多次查看结果一致（密文可逆）', async () => {
    const owner = await createUser({ email: 'o@t.com' });
    const { key, view } = await apiKeysService.createKey({ name: 'peek', createdBy: owner.user.id });
    const a = await apiKeysService.revealKey(view.id);
    const b = await apiKeysService.revealKey(view.id);
    expect(a.key).toBe(key);
    expect(b.key).toBe(key);
  });

  it('历史无密文的密钥给出人话错误（提示轮换）', async () => {
    const owner = await createUser({ email: 'o@t.com' });
    const { view } = await apiKeysService.createKey({ name: 'legacy', createdBy: owner.user.id });
    await prisma.apiKey.update({ where: { id: view.id }, data: { keyCipher: null } });
    const listed = await apiKeysService.listKeys();
    expect(listed[0].can_reveal).toBe(false);
    await expect(apiKeysService.revealKey(view.id)).rejects.toThrow('不可恢复');
  });

  it('不存在的密钥报 404 人话', async () => {
    await expect(apiKeysService.revealKey('key_nope')).rejects.toThrow('密钥不存在');
  });
});

describe('deleteKey 彻底删除（R87）', () => {
  it('行从库中移除；历史用量保留但不再归属', async () => {
    const owner = await createUser({ email: 'o@t.com' });
    const { view } = await apiKeysService.createKey({ name: 'gone', createdBy: owner.user.id });
    await prisma.usageEvent.create({ data: { id: 'ue_keep', apiKeyId: view.id, eventType: 'mcp.tool_call' } });

    await apiKeysService.deleteKey(view.id);

    expect(await prisma.apiKey.findUnique({ where: { id: view.id } })).toBeNull();
    const ev = await prisma.usageEvent.findUnique({ where: { id: 'ue_keep' } });
    expect(ev).not.toBeNull();
    expect(ev!.apiKeyId).toBeNull(); // SetNull：账留着，归属断了
  });

  it('已撤销的密钥也能彻底删除', async () => {
    const owner = await createUser({ email: 'o@t.com' });
    const { view } = await apiKeysService.createKey({ name: 'rev-del', createdBy: owner.user.id });
    await apiKeysService.revokeKey(view.id);
    await apiKeysService.deleteKey(view.id);
    expect(await prisma.apiKey.findUnique({ where: { id: view.id } })).toBeNull();
  });

  it('不存在时报 404 人话', async () => {
    await expect(apiKeysService.deleteKey('key_nope')).rejects.toThrow('密钥不存在');
  });
});

describe('keyUsage 聚合', () => {
  it('按日聚合调用量', async () => {
    const owner = await createUser({ email: 'o@t.com' });
    const { view } = await apiKeysService.createKey({ name: 'usage', createdBy: owner.user.id });
    // 造 3 条事件：2 条今天、1 条昨天
    await prisma.usageEvent.createMany({
      data: [0, 1].map(() => ({
        id: `ue_${Math.random().toString(36).slice(2, 12)}`,
        apiKeyId: view.id,
        eventType: 'mcp.tool_call',
      })),
    });
    const yesterday = new Date(Date.now() - 86_400_000);
    await prisma.usageEvent.create({
      data: { id: `ue_${Math.random().toString(36).slice(2, 12)}`, apiKeyId: view.id, eventType: 'mcp.tool_call', createdAt: yesterday },
    });
    const usage = await apiKeysService.keyUsage(view.id, 7);
    expect(usage.total).toBe(3);
    expect(usage.points).toHaveLength(2);
    expect(usage.points[0].calls).toBe(1); // 昨天
    expect(usage.points[1].calls).toBe(2); // 今天
  });
});

describe('HTTP 路由权限', () => {
  it('member 创建 403；admin 201 且一次性明文只在响应出现一次', async () => {
    const ownerHeaders = await authHeaders(app, 'own@t.com'); // 首位=owner
    const member = await createUser({ email: 'mem@t.com' });
    const memberLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'mem@t.com', password: member.password } });
    const memberHeaders = { authorization: `Bearer ${memberLogin.json().access_token}` };

    const denied = await app.inject({ method: 'POST', url: '/api/api-keys', headers: memberHeaders, payload: { name: 'x' } });
    expect(denied.statusCode).toBe(403);

    const created = await app.inject({
      method: 'POST', url: '/api/api-keys', headers: ownerHeaders,
      payload: { name: 'http-key', scopes: ['context:read', 'bug:write'] },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.key.startsWith('vhk_live_')).toBe(true);
    expect(body.warning).toContain('查看');

    // 列表不含明文
    const list = await app.inject({ method: 'GET', url: '/api/api-keys', headers: ownerHeaders });
    expect(JSON.stringify(list.json())).not.toContain(body.key);

    // 轮换 + 用量
    const rotated = await app.inject({ method: 'POST', url: `/api/api-keys/${body.api_key.id}/rotate`, headers: ownerHeaders });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json().key).not.toBe(body.key);

    const usage = await app.inject({ method: 'GET', url: `/api/api-keys/${body.api_key.id}/usage`, headers: ownerHeaders });
    expect(usage.statusCode).toBe(200);
    expect(usage.json().total).toBe(0);

    // 查看明文（R87）：admin 可再次取回，且禁缓存
    const revealUrl = `/api/api-keys/${rotated.json().view.id}/reveal`;
    const revealed = await app.inject({ method: 'GET', url: revealUrl, headers: ownerHeaders });
    expect(revealed.statusCode).toBe(200);
    expect(revealed.json().key).toBe(rotated.json().key);
    expect(revealed.headers['cache-control']).toBe('no-store');

    // member 不得查看明文
    const deniedReveal = await app.inject({ method: 'GET', url: revealUrl, headers: memberHeaders });
    expect(deniedReveal.statusCode).toBe(403);

    // 撤销：行保留，但明文不再可看
    const revoked = await app.inject({ method: 'POST', url: `/api/api-keys/${body.api_key.id}/revoke`, headers: ownerHeaders });
    expect(revoked.statusCode).toBe(204);
    const afterRevoke = await app.inject({ method: 'GET', url: `/api/api-keys/${body.api_key.id}/reveal`, headers: ownerHeaders });
    expect(afterRevoke.statusCode).toBe(400);

    // 彻底删除（R87）：行从库中消失
    const removed = await app.inject({ method: 'DELETE', url: `/api/api-keys/${body.api_key.id}`, headers: ownerHeaders });
    expect(removed.statusCode).toBe(204);
    const listAfter = await app.inject({ method: 'GET', url: '/api/api-keys', headers: ownerHeaders });
    expect(listAfter.json().some((k: { id: string }) => k.id === body.api_key.id)).toBe(false);
  });

  it('未登录 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/api-keys' });
    expect(res.statusCode).toBe(401);
  });
});
