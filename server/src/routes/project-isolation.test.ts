import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../index.js';
import { authHeaders, resetDb } from '../test-helpers.js';
import * as notifications from '../services/notifications.js';

let app: FastifyInstance;

beforeEach(async () => {
  await resetDb();
  app = await buildServer();
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await resetDb();
});

async function login(email: string, password = 'abcd1234') {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return {
    headers: { authorization: `Bearer ${res.json().access_token}` },
    user: res.json().user as { id: string; name: string },
  };
}

async function createProject(headers: Record<string, string>, name: string) {
  const res = await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { name } });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; name: string; slug: string };
}

describe('单项目工作区物理隔离契约（today / search / notifications / skills）', () => {
  it('GET /api/today?project_id= 只返回指定项目的待办、待验收、在办与统计', async () => {
    const headers = await authHeaders(app, 'iso-owner@t.com');
    const owner = await login('iso-owner@t.com');
    const projA = await createProject(headers, '隔离项目 Alpha');
    const projB = await createProject(headers, '隔离项目 Beta');

    const bugA = (
      await app.inject({
        method: 'POST',
        url: '/api/bugs',
        headers,
        payload: { project_id: projA.id, title: 'Alpha 登录异常', assignee_id: owner.user.id },
      })
    ).json();
    const bugB = (
      await app.inject({
        method: 'POST',
        url: '/api/bugs',
        headers,
        payload: { project_id: projB.id, title: 'Beta 结算异常', assignee_id: owner.user.id },
      })
    ).json();

    await app.inject({ method: 'PATCH', url: `/api/bugs/${bugB.id}`, headers, payload: { status: 'in_progress' } });
    await app.inject({ method: 'PATCH', url: `/api/bugs/${bugB.id}`, headers, payload: { status: 'resolved' } });

    const resA = await app.inject({
      method: 'GET',
      url: `/api/today?project_id=${projA.id}`,
      headers,
    });
    expect(resA.statusCode).toBe(200);
    const bodyA = resA.json();
    expect(bodyA.project_id).toBe(projA.id);
    expect(bodyA.needs_me.map((i: { id: string }) => i.id)).toEqual([bugA.id]);
    expect(bodyA.to_verify).toHaveLength(0);
    expect(bodyA.active).toHaveLength(0);
    expect(bodyA.today.bugs_created).toBe(1);
    expect(bodyA.remaining.bugs.unresolved).toBe(1);
    expect(bodyA.remaining.bugs.unverified).toBe(0);

    const resB = await app.inject({
      method: 'GET',
      url: `/api/today?project_id=${projB.id}`,
      headers,
    });
    expect(resB.statusCode).toBe(200);
    const bodyB = resB.json();
    expect(bodyB.project_id).toBe(projB.id);
    expect(bodyB.needs_me).toHaveLength(0);
    expect(bodyB.to_verify.map((i: { id: string }) => i.id)).toEqual([bugB.id]);
    expect(bodyB.remaining.bugs.unverified).toBe(1);
  });

  it('GET /api/search?q=&project_id= 严格不跨项目泄漏缺陷、任务、随手记与项目', async () => {
    const headers = await authHeaders(app, 'iso-search@t.com');
    const projA = await createProject(headers, '商城网关 Alpha');
    const projB = await createProject(headers, '后台结算 Beta');

    await app.inject({
      method: 'POST',
      url: '/api/bugs',
      headers,
      payload: { project_id: projA.id, title: '统一鉴权超时 Alpha' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/bugs',
      headers,
      payload: { project_id: projB.id, title: '统一鉴权超时 Beta' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers,
      payload: { project_id: projB.id, title: '排查统一鉴权配置' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/notes',
      headers,
      payload: { project_id: projB.id, content: '统一鉴权密钥轮换备忘' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent('统一鉴权')}&project_id=${projA.id}`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.bugs).toHaveLength(1);
    expect(body.bugs[0].title).toBe('统一鉴权超时 Alpha');
    expect(body.tasks).toHaveLength(0);
    expect(body.notes).toHaveLength(0);

    const projSearch = await app.inject({
      method: 'GET',
      url: `/api/search?q=Beta&project_id=${projA.id}`,
      headers,
    });
    expect(projSearch.json().projects).toHaveLength(0);
  });

  it('GET /api/notifications?project_id= 与 PATCH /api/notifications/read-all?project_id= 按项目隔离未读与已读', async () => {
    const headers = await authHeaders(app, 'iso-notif@t.com');
    const owner = await login('iso-notif@t.com');
    const projA = await createProject(headers, '通知项目 A');
    const projB = await createProject(headers, '通知项目 B');

    await notifications.createNotification({
      userId: owner.user.id,
      type: 'verify',
      title: 'A 待验收',
      projectId: projA.id,
    });
    await notifications.createNotification({
      userId: owner.user.id,
      type: 'handoff',
      title: 'B 转交',
      projectId: projB.id,
    });

    const listA = await app.inject({
      method: 'GET',
      url: `/api/notifications?project_id=${projA.id}`,
      headers,
    });
    expect(listA.statusCode).toBe(200);
    expect(listA.json().unread).toBe(1);
    expect(listA.json().items.map((x: { title: string }) => x.title)).toEqual(['A 待验收']);

    const readA = await app.inject({
      method: 'PATCH',
      url: `/api/notifications/read-all?project_id=${projA.id}`,
      headers,
    });
    expect(readA.statusCode).toBe(200);
    expect(readA.json().updated).toBe(1);

    // A 已清零，B 仍保持 1 条未读
    const afterA = await app.inject({
      method: 'GET',
      url: `/api/notifications?project_id=${projA.id}`,
      headers,
    });
    expect(afterA.json().unread).toBe(0);

    const afterB = await app.inject({
      method: 'GET',
      url: `/api/notifications?project_id=${projB.id}`,
      headers,
    });
    expect(afterB.json().unread).toBe(1);
    expect(afterB.json().items.map((x: { title: string }) => x.title)).toEqual(['B 转交']);
  });
});
