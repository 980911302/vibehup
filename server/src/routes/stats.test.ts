import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../index.js';
import { resetDb, authHeaders } from '../test-helpers.js';

let app: FastifyInstance;

beforeEach(async () => {
  await resetDb();
  app = await buildServer();
  await app.ready();
});

describe('GET /api/stats', () => {
  it('未登录 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats' });
    expect(res.statusCode).toBe(401);
  });

  it('viewer（只读成员）也能读（统计不是写操作）', async () => {
    const ownerHeaders = await authHeaders(app, 'owner-v2@t.com');
    const viewerEmail = 'viewer-v@t.com';
    const created = await app.inject({ method: 'POST', url: '/api/users', headers: ownerHeaders, payload: { email: viewerEmail, name: 'V', role: 'viewer' } });
    expect(created.statusCode, JSON.stringify(created.json())).toBe(201);
    const body = created.json() as { one_time_password?: string; user?: { one_time_password?: string } };
    const onePwd = body.one_time_password ?? body.user?.one_time_password;
    const viewerLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: viewerEmail, password: onePwd } });
    expect(viewerLogin.statusCode, JSON.stringify(viewerLogin.json())).toBe(200);
    const viewerHeaders = { authorization: `Bearer ${viewerLogin.json().access_token}` };

    const res = await app.inject({ method: 'GET', url: '/api/stats', headers: viewerHeaders });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('today');
  });

  it('缺省（不传 project_id）= 全部项目：scope.project_id 为 null', async () => {
    const headers = await authHeaders(app, 'owner-a@t.com');
    const res = await app.inject({ method: 'GET', url: '/api/stats', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().scope.project_id).toBeNull();
  });

  it('project_id=all 与缺省等价', async () => {
    const headers = await authHeaders(app, 'owner-b@t.com');
    const res = await app.inject({ method: 'GET', url: '/api/stats?project_id=all', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().scope.project_id).toBeNull();
  });

  it('project_id 指定已存在的项目：scope.project_id 回显该 id', async () => {
    const headers = await authHeaders(app, 'owner-c@t.com');
    const proj = await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { name: 'P' } });
    const pid = proj.json().id as string;
    const res = await app.inject({ method: 'GET', url: `/api/stats?project_id=${pid}`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().scope.project_id).toBe(pid);
  });

  it('project_id 指定不存在的项目 → 404', async () => {
    const headers = await authHeaders(app, 'owner-d@t.com');
    const res = await app.inject({ method: 'GET', url: '/api/stats?project_id=prj_does_not_exist', headers });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('响应形状完整（五个分区都在）', async () => {
    const headers = await authHeaders(app, 'owner-e@t.com');
    const res = await app.inject({ method: 'GET', url: '/api/stats', headers });
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['active', 'by_actor', 'remaining', 'scope', 'today', 'trend']);
    expect(body.trend).toHaveLength(14);
  });
});