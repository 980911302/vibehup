import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../index.js';
import { resetDb, authHeaders } from '../test-helpers.js';

let app: FastifyInstance;

beforeEach(async () => {
  await resetDb();
  app = await buildServer();
  await app.ready();
});

async function setup() {
  const headers = await authHeaders(app, 'wi-owner@t.com');
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers });
  const user = me.json().user as { id: string };
  const p = await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { name: '队列项目' } });
  const project = p.json() as { id: string };
  return { headers, user, project };
}

describe('GET /api/work-items 统一读模型', () => {
  it('未登录 401；缺 project_id 400', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/work-items?project_id=x' })).statusCode).toBe(401);
    const headers = await authHeaders(app, 'wi-unauth@t.com');
    const res = await app.inject({ method: 'GET', url: '/api/work-items', headers });
    expect(res.statusCode).toBe(400);
  });

  it('scope=my：只回当前项目、指派给我的在办项', async () => {
    const { headers, user, project } = await setup();
    await app.inject({
      method: 'POST', url: '/api/bugs', headers,
      payload: { project_id: project.id, title: '我的缺陷', assignee_id: user.id },
    });
    await app.inject({
      method: 'POST', url: '/api/tasks', headers,
      payload: { project_id: project.id, title: '我的任务', assignee_id: user.id },
    });
    const res = await app.inject({ method: 'GET', url: `/api/work-items?project_id=${project.id}&scope=my`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((i: { title: string }) => i.title).sort()).toEqual(['我的任务', '我的缺陷']);
    expect(res.json().items.every((i: { project: { id: string } }) => i.project.id === project.id)).toBe(true);
  });

  it('scope=verify：回已解决/待验证，带 evidence 字段', async () => {
    const { headers, project } = await setup();
    const bug = (await app.inject({
      method: 'POST', url: '/api/bugs', headers,
      payload: { project_id: project.id, title: '等我验收' },
    })).json();
    await app.inject({ method: 'PATCH', url: `/api/bugs/${bug.id}`, headers, payload: { status: 'in_progress' } });
    await app.inject({
      method: 'PATCH', url: `/api/bugs/${bug.id}`, headers,
      payload: { status: 'resolved', evidence: { commit: 'abc123' } },
    });
    const res = await app.inject({ method: 'GET', url: `/api/work-items?project_id=${project.id}&scope=verify`, headers });
    expect(res.statusCode).toBe(200);
    const item = res.json().items.find((i: { id: string }) => i.id === bug.id);
    expect(item.status).toBe('resolved');
    expect(item.evidence).toMatchObject({ commit: 'abc123' });
  });

  it('不返回其他项目的项', async () => {
    const { headers, project } = await setup();
    const other = (await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { name: '别的项目' } })).json();
    await app.inject({ method: 'POST', url: '/api/bugs', headers, payload: { project_id: other.id, title: '别处' } });
    const res = await app.inject({ method: 'GET', url: `/api/work-items?project_id=${project.id}&scope=active`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(0);
  });
});
