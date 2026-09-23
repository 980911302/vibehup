import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../core/prisma.js';
import { resetDb, createApiKey, createUser } from '../test-helpers.js';
import { mcpStore } from './context-store.js';
import { guarded } from './guard.js';
import { loadKeyedContext } from './context.js';
import { revokeKey } from '../services/api-keys.js';
import { removeUser } from '../services/users.js';

/**
 * 密钥生命周期（R76）：SSE 长连接只在握手时校验一次密钥，之后一直沿用——
 * 撤销 / 过期 / 创建人被禁用都不影响已建立的会话，违背「撤销即时生效」契约；
 * 成员被移除后其密钥 createdBy 置空但仍有效（离职人员密钥最长可用 90 天）。
 */

const listBugs = guarded('list_bugs', 'context:read', async () => ({ items: [] }));

/** 模拟一条 SSE 会话：握手时加载上下文，之后每次调用都在该上下文内执行 */
async function openSession(rawKey: string) {
  const ctx = await loadKeyedContext(rawKey);
  return () => mcpStore.run(ctx, () => listBugs({}));
}

beforeEach(async () => {
  await resetDb();
});

describe('SSE 会话内的密钥状态即时生效', () => {
  it('会话中途撤销密钥：下一次工具调用即被拒', async () => {
    const key = await createApiKey({ scopes: ['context:read'] });
    const call = await openSession(key.key);
    expect((await call()).isError).toBeFalsy();

    await revokeKey(key.id);

    const res = await call();
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('撤销');
  });

  it('会话中途密钥过期（含轮换宽限期结束）：下一次调用被拒', async () => {
    const key = await createApiKey({ scopes: ['context:read'] });
    const call = await openSession(key.key);

    await prisma.apiKey.update({ where: { id: key.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await call();
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('过期');
  });
});

describe('成员禁用 / 移除联动其密钥', () => {
  it('创建人被禁用：握手即拒、已建立的会话下一次调用被拒；恢复后可继续使用', async () => {
    await createUser({ email: 'owner@t.com' });
    const member = await createUser({ email: 'm@t.com' });
    const key = await createApiKey({ scopes: ['context:read'], createdBy: member.user.id });
    const call = await openSession(key.key);

    await prisma.user.update({ where: { id: member.user.id }, data: { status: 'disabled' } });
    expect((await call()).isError).toBe(true);
    await expect(loadKeyedContext(key.key)).rejects.toThrow('禁用');

    await prisma.user.update({ where: { id: member.user.id }, data: { status: 'active' } });
    expect((await call()).isError).toBeFalsy();
  });

  it('移除成员：其创建的密钥被吊销，不再能建立会话', async () => {
    const owner = await createUser({ email: 'owner@t.com' });
    const member = await createUser({ email: 'm@t.com' });
    const key = await createApiKey({ scopes: ['bug:write'], createdBy: member.user.id });

    await removeUser(owner.user.id, member.user.id);

    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } });
    expect(row.revokedAt).not.toBeNull();
    await expect(loadKeyedContext(key.key)).rejects.toThrow('撤销');
  });
});
