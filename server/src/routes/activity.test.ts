import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../index.js';
import { prisma } from '../core/prisma.js';
import { resetDb, createApiKey, authHeaders } from '../test-helpers.js';
import * as activityService from '../services/activity.js';

/** AI 活动可见流（卡片 36）：脱敏 service + 全员可读路由 */

let app: FastifyInstance;

beforeEach(async () => {
  await resetDb();
  app = await buildServer();
  await app.ready();
});

describe('activity service（脱敏）', () => {
  it('返回最近 AI 活动：密钥名/前缀/工具/时间，禁出 keyHash/salt', async () => {
    const key = await createApiKey({ name: 'cursor-main' });
    await prisma.usageEvent.create({
      data: {
        id: 'ue_1',
        apiKeyId: key.id,
        eventType: 'mcp.tool_call',
        metadata: JSON.stringify({ tool: 'get_project_context', latency_ms: 12, bytes_out: 345, result: 'ok', actor: 'cursor-main' }),
      },
    });
    const items = await activityService.listRecentActivity(20);
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.tool).toBe('get_project_context');
    expect(item.key_name).toBe('cursor-main');
    expect(item.key_prefix).toBe(key.prefix);
    expect(item.result).toBe('ok');
    expect(item.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // 脱敏：任何形态的敏感字段都不得出现
    const serialized = JSON.stringify(item);
    expect(serialized).not.toContain('keyHash');
    expect(serialized).not.toContain('key_hash');
    expect(serialized).not.toContain('salt');
    expect(Object.keys(item)).not.toContain('key_hash');
  });

  it('按时间倒序（最新在前）', async () => {
    const key = await createApiKey({ name: 'k1' });
    await prisma.usageEvent.create({
      data: { id: 'ue_old', apiKeyId: key.id, eventType: 'mcp.tool_call', metadata: JSON.stringify({ tool: 'list_bugs' }), createdAt: new Date('2026-09-20T10:00:00Z') },
    });
    await prisma.usageEvent.create({
      data: { id: 'ue_new', apiKeyId: key.id, eventType: 'mcp.tool_call', metadata: JSON.stringify({ tool: 'search' }), createdAt: new Date('2026-09-22T10:00:00Z') },
    });
    const items = await activityService.listRecentActivity(20);
    expect(items.map((i) => i.tool)).toEqual(['search', 'list_bugs']);
  });

  it('非 MCP 事件（auth.login）不出现在 AI 活动里', async () => {
    const key = await createApiKey({ name: 'k2' });
    await prisma.usageEvent.create({
      data: { id: 'ue_login', apiKeyId: key.id, eventType: 'auth.login', metadata: JSON.stringify({}) },
    });
    await prisma.usageEvent.create({
      data: { id: 'ue_mcp', apiKeyId: key.id, eventType: 'mcp.tool_call', metadata: JSON.stringify({ tool: 'list_notes' }) },
    });
    const items = await activityService.listRecentActivity(20);
    expect(items).toHaveLength(1);
    expect(items[0].tool).toBe('list_notes');
  });

  it('stdio 本地模式（apiKeyId 为空）也能展示，密钥字段为 null', async () => {
    await prisma.usageEvent.create({
      data: { id: 'ue_local', apiKeyId: null, eventType: 'mcp.tool_call', metadata: JSON.stringify({ tool: 'get_project_context', actor: 'local' }) },
    });
    const items = await activityService.listRecentActivity(20);
    expect(items).toHaveLength(1);
    expect(items[0].key_name).toBeNull();
    expect(items[0].key_prefix).toBeNull();
  });

  it('limit 参数生效', async () => {
    const key = await createApiKey({ name: 'k3' });
    for (let i = 0; i < 5; i++) {
      await prisma.usageEvent.create({
        data: { id: `ue_l${i}`, apiKeyId: key.id, eventType: 'mcp.tool_call', metadata: JSON.stringify({ tool: `t${i}` }) },
      });
    }
    const items = await activityService.listRecentActivity(3);
    expect(items).toHaveLength(3);
  });
});

describe('activity 路由（全员可读）', () => {
  it('member（非管理员）可读 AI 活动', async () => {
    const key = await createApiKey({ name: 'member-visible' });
    await prisma.usageEvent.create({
      data: { id: 'ue_m1', apiKeyId: key.id, eventType: 'mcp.tool_call', metadata: JSON.stringify({ tool: 'get_project_context', result: 'ok' }) },
    });
    const headers = await authHeaders(app, 'member@t.com');
    // 降到 member 角色（authHeaders 注册的是 owner——此用例换一个非 owner 账号）
    await prisma.user.update({ where: { email: 'member@t.com' }, data: { role: 'member' } });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'member@t.com', password: 'abcd1234' } });
    const memberHeaders = { authorization: `Bearer ${login.json().access_token}` };
    const res = await app.inject({ method: 'GET', url: '/api/activity/recent', headers: memberHeaders });
    expect(res.statusCode).toBe(200);
    const items = res.json() as { tool: string; key_name: string }[];
    expect(items).toHaveLength(1);
    expect(items[0].tool).toBe('get_project_context');
    expect(items[0].key_name).toBe('member-visible');
    expect(headers.authorization).toBeTruthy();
  });

  it('未登录 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/activity/recent' });
    expect(res.statusCode).toBe(401);
  });

  it('空库返回空数组', async () => {
    const headers = await authHeaders(app, 'empty@t.com');
    const res = await app.inject({ method: 'GET', url: '/api/activity/recent', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
