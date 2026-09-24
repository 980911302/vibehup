import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../index.js';
import { resetDb } from '../test-helpers.js';
import * as projectsService from '../services/projects.js';

/**
 * R83：网页上流转缺陷/任务同样记下「谁、什么时候」，看板接口直接带出（验证中列 + status_actor）。
 */

let app: FastifyInstance;
let owner: Record<string, string>;
let projectId: string;

beforeEach(async () => {
  await resetDb();
  app = await buildServer();
  await app.ready();
  await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'o@t.com', password: 'abcd1234', name: '张磊' } });
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'o@t.com', password: 'abcd1234' } });
  owner = { authorization: `Bearer ${res.json().access_token}` };
  projectId = (await projectsService.createProject({ name: 'P', slug: 'p' })).id;
});

describe('网页流转记录操作人', () => {
  it('缺陷：PATCH 状态后返回并在看板上带 status_actor；看板有 verifying 列', async () => {
    const bug = (await app.inject({ method: 'POST', url: '/api/bugs', headers: owner, payload: { project_id: projectId, title: 'x' } })).json();
    for (const status of ['in_progress', 'resolved', 'verifying']) {
      const r = await app.inject({ method: 'PATCH', url: `/api/bugs/${bug.id}`, headers: owner, payload: { status } });
      expect(r.statusCode, r.body).toBe(200);
    }
    const board = (await app.inject({ method: 'GET', url: `/api/bugs/board/${projectId}`, headers: owner })).json();
    expect(Object.keys(board)).toContain('verifying');
    expect(board.verifying[0]).toMatchObject({ id: bug.id, status_actor: { type: 'user', name: '张磊' } });
    expect(typeof board.verifying[0].status_changed_at).toBe('string');
  });

  it('关闭缺陷缺原因给人话 400；带原因关闭成功', async () => {
    const bug = (await app.inject({ method: 'POST', url: '/api/bugs', headers: owner, payload: { project_id: projectId, title: 'dup' } })).json();
    const bad = await app.inject({ method: 'PATCH', url: `/api/bugs/${bug.id}`, headers: owner, payload: { status: 'closed' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toContain('关闭缺陷需要写明原因');
    const ok = await app.inject({ method: 'PATCH', url: `/api/bugs/${bug.id}`, headers: owner, payload: { status: 'closed', resolution_notes: '重复：bug_1' } });
    expect(ok.json()).toMatchObject({ status: 'closed', resolution_notes: '重复：bug_1' });
  });

  it('任务：PATCH 到验证中记下操作人', async () => {
    const t = (await app.inject({ method: 'POST', url: '/api/tasks', headers: owner, payload: { project_id: projectId, title: 't', status: 'doing' } })).json();
    await app.inject({ method: 'PATCH', url: `/api/tasks/${t.id}`, headers: owner, payload: { status: 'review' } });
    const r = await app.inject({ method: 'PATCH', url: `/api/tasks/${t.id}`, headers: owner, payload: { status: 'verifying' } });
    expect(r.json()).toMatchObject({ status: 'verifying', status_actor: { type: 'user', name: '张磊' }, allowed_next_statuses: ['done', 'doing', 'review', 'cancelled'] });
  });
});
