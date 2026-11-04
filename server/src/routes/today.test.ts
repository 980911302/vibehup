import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../index.js';
import { prisma } from '../core/prisma.js';
import { resetDb, authHeaders } from '../test-helpers.js';

let app: FastifyInstance;

beforeEach(async () => {
  await resetDb();
  app = await buildServer();
  await app.ready();
});

async function login(email: string, password = 'abcd1234') {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  expect(res.statusCode, JSON.stringify(res.json())).toBe(200);
  return {
    headers: { authorization: `Bearer ${res.json().access_token}` },
    user: res.json().user as { id: string; role: string },
  };
}

async function makeProject(headers: Record<string, string>, name: string) {
  const res = await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { name } });
  expect(res.statusCode, JSON.stringify(res.json())).toBe(201);
  return res.json() as { id: string; name: string };
}

describe('GET /api/today 今日工作台', () => {
  it('未登录 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/today' });
    expect(res.statusCode).toBe(401);
  });

  it('viewer 也能读（只读聚合）', async () => {
    const ownerHeaders = await authHeaders(app, 'today-owner@t.com');
    const viewerEmail = 'today-viewer@t.com';
    const created = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: ownerHeaders,
      payload: { email: viewerEmail, name: 'V', role: 'viewer' },
    });
    expect(created.statusCode, JSON.stringify(created.json())).toBe(201);
    const onePwd = created.json().one_time_password ?? created.json().user?.one_time_password;
    const viewer = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: viewerEmail, password: onePwd } });
    expect(viewer.statusCode, JSON.stringify(viewer.json())).toBe(200);
    const res = await app.inject({
      method: 'GET',
      url: '/api/today',
      headers: { authorization: `Bearer ${viewer.json().access_token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('needs_me');
  });

  it('跨项目聚合：待我处理 / 待验收 / AI 进行中 / 正在干 + 今日统计', async () => {
    const ownerHeaders = await authHeaders(app, 'today-owner2@t.com');
    const owner = await login('today-owner2@t.com');
    const p1 = await makeProject(ownerHeaders, '今日项目 A');
    const p2 = await makeProject(ownerHeaders, '今日项目 B');

    const bugMine = (
      await app.inject({
        method: 'POST',
        url: '/api/bugs',
        headers: ownerHeaders,
        payload: { project_id: p1.id, title: '等 owner 处理的缺陷', assignee_id: owner.user.id },
      })
    ).json();
    const bugVerify = (
      await app.inject({
        method: 'POST',
        url: '/api/bugs',
        headers: ownerHeaders,
        payload: { project_id: p2.id, title: '等 owner 验收的缺陷', assignee_id: owner.user.id },
      })
    ).json();
    const bugAi = (
      await app.inject({
        method: 'POST',
        url: '/api/bugs',
        headers: ownerHeaders,
        payload: { project_id: p1.id, title: 'AI 正在处理的缺陷' },
      })
    ).json();
    const taskMine = (
      await app.inject({
        method: 'POST',
        url: '/api/tasks',
        headers: ownerHeaders,
        payload: { project_id: p2.id, title: '等 owner 处理的任务', assignee_id: owner.user.id },
      })
    ).json();
    const taskReview = (
      await app.inject({
        method: 'POST',
        url: '/api/tasks',
        headers: ownerHeaders,
        payload: { project_id: p1.id, title: '等 owner 验收的任务', assignee_id: owner.user.id },
      })
    ).json();

    // 状态流转走 API，随后把 AI 经手快照写进库（真实路径由 MCP 写入）
    await app.inject({ method: 'PATCH', url: `/api/bugs/${bugVerify.id}`, headers: ownerHeaders, payload: { status: 'in_progress' } });
    await app.inject({ method: 'PATCH', url: `/api/bugs/${bugVerify.id}`, headers: ownerHeaders, payload: { status: 'resolved' } });
    await app.inject({ method: 'PATCH', url: `/api/bugs/${bugAi.id}`, headers: ownerHeaders, payload: { status: 'in_progress' } });
    await prisma.bug.update({
      where: { id: bugAi.id },
      data: {
        statusActorType: 'ai',
        statusActorName: 'cursor-main',
        statusChangedAt: new Date(Date.now() - 40 * 60_000),
      },
    });
    await app.inject({ method: 'PATCH', url: `/api/tasks/${taskReview.id}`, headers: ownerHeaders, payload: { status: 'doing' } });
    await app.inject({ method: 'PATCH', url: `/api/tasks/${taskReview.id}`, headers: ownerHeaders, payload: { status: 'review' } });

    const res = await app.inject({ method: 'GET', url: '/api/today', headers: ownerHeaders });
    expect(res.statusCode, JSON.stringify(res.json())).toBe(200);
    const body = res.json() as {
      date: string;
      needs_me: { id: string; project: { name: string } }[];
      to_verify: { id: string }[];
      ai_active: { id: string; actor: { type: string; name: string } | null }[];
      active: { id: string }[];
      today: Record<string, number>;
      remaining: Record<string, unknown>;
      trend: unknown[];
      projects: { id: string }[];
    };

    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.projects.map((p) => p.id)).toEqual(expect.arrayContaining([p1.id, p2.id]));
    expect(body.needs_me.map((i) => i.id)).toEqual(expect.arrayContaining([bugMine.id, taskMine.id]));
    expect(body.to_verify.map((i) => i.id)).toEqual(expect.arrayContaining([bugVerify.id, taskReview.id]));
    expect(body.ai_active.map((i) => i.id)).toContain(bugAi.id);
    expect(body.ai_active.find((i) => i.id === bugAi.id)?.actor).toMatchObject({ type: 'ai', name: 'cursor-main' });
    expect(body.active.map((i) => i.id)).toEqual(expect.arrayContaining([bugAi.id, bugVerify.id, taskReview.id]));
    expect(body.today).toHaveProperty('bugs_fixed');
    expect(body.remaining).toHaveProperty('bugs');
    expect(body.trend).toHaveLength(14);
    // 跨项目：两条待我处理分别来自 A/B
    expect(body.needs_me.find((i) => i.id === bugMine.id)?.project.name).toBe('今日项目 A');
    expect(body.needs_me.find((i) => i.id === taskMine.id)?.project.name).toBe('今日项目 B');
  });

  it('归档项目不出现在今日列表', async () => {
    const headers = await authHeaders(app, 'today-owner3@t.com');
    const owner = await login('today-owner3@t.com');
    const active = await makeProject(headers, '进行中项目');
    const archived = await makeProject(headers, '已归档项目');
    await app.inject({ method: 'PATCH', url: `/api/projects/${archived.id}`, headers, payload: { archived_at: new Date().toISOString() } });

    const activeBug = (
      await app.inject({ method: 'POST', url: '/api/bugs', headers, payload: { project_id: active.id, title: '有效项目缺陷', assignee_id: owner.user.id } })
    ).json();
    await app.inject({ method: 'POST', url: '/api/bugs', headers, payload: { project_id: archived.id, title: '归档项目缺陷', assignee_id: owner.user.id } });

    const res = await app.inject({ method: 'GET', url: '/api/today', headers });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { needs_me: { id: string; title: string }[]; projects: { id: string }[]; remaining: { bugs: { unresolved: number } } };
    expect(body.needs_me.map((i) => i.id)).toContain(activeBug.id);
    expect(body.needs_me.some((i) => i.title === '归档项目缺陷')).toBe(false);
    expect(body.projects.map((p) => p.id)).not.toContain(archived.id);
    expect(body.remaining.bugs.unresolved).toBe(1);
  });
});
