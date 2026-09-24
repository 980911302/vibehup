import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../index.js';
import { prisma } from '../core/prisma.js';
import { resetDb } from '../test-helpers.js';
import * as projectsService from '../services/projects.js';

/** 任务 REST：字段映射（snake_case）、详情、按标签过滤、删除、角色限制 */

let app: FastifyInstance;
let owner: Record<string, string>;
let projectId: string;

async function login(email: string, role?: string): Promise<Record<string, string>> {
  const password = 'abcd1234';
  await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password, name: email.split('@')[0] } });
  if (role) await prisma.user.update({ where: { email }, data: { role } });
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  return { authorization: `Bearer ${res.json().access_token}` };
}

beforeEach(async () => {
  await resetDb();
  app = await buildServer();
  await app.ready();
  owner = await login('owner@t.com');
  projectId = (await projectsService.createProject({ name: '任务项目', slug: 'tp' })).id;
});

async function create(payload: Record<string, unknown>, headers = owner) {
  return app.inject({ method: 'POST', url: '/api/tasks', headers, payload: { project_id: projectId, ...payload } });
}

describe('任务 REST', () => {
  it('新建带标签与负责人，返回 snake_case 字段与可走的下一步', async () => {
    const me = await prisma.user.findUnique({ where: { email: 'owner@t.com' } });
    const res = await create({ title: '接入企业微信', labels: ['登录'], assignee_id: me!.id, priority: 'high' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      title: '接入企业微信',
      labels: ['登录'],
      assignee_id: me!.id,
      assignee: { id: me!.id, name: 'owner' },
      status: 'todo',
      reopen_reason: null,
      reopened_count: 0,
      allowed_next_statuses: ['doing', 'cancelled'],
    });
  });

  it('PATCH 映射 assignee_id / labels / reopen_reason（此前 assignee_id 被静默忽略）', async () => {
    const t = (await create({ title: 'x' })).json();
    const me = await prisma.user.findUnique({ where: { email: 'owner@t.com' } });
    const patch = (payload: Record<string, unknown>) =>
      app.inject({ method: 'PATCH', url: `/api/tasks/${t.id}`, headers: owner, payload });

    expect((await patch({ assignee_id: me!.id, labels: ['a', 'b'] })).json()).toMatchObject({ assignee_id: me!.id, labels: ['a', 'b'] });
    await patch({ status: 'doing' });
    await patch({ status: 'review' });
    const bad = await patch({ status: 'doing' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_ERROR');
    const back = await patch({ status: 'doing', reopen_reason: '验收没过' });
    expect(back.json()).toMatchObject({ status: 'doing', reopen_reason: '验收没过', reopened_count: 1 });
    expect((await patch({ assignee_id: null })).json().assignee_id).toBeNull();
  });

  it('GET 详情含附件；列表可按标签过滤', async () => {
    const a = (await create({ title: '前端任务', labels: ['前端'] })).json();
    await create({ title: '后端任务', labels: ['后端'] });
    await prisma.attachment.create({
      data: { id: 'att_t1', projectId, entityType: 'task', entityId: a.id, fileName: 'spec.md', fileType: 'text/markdown', fileSize: 3, storagePath: 'x/spec.md' },
    });

    const detail = await app.inject({ method: 'GET', url: `/api/tasks/${a.id}`, headers: owner });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().attachments.map((x: { file_name: string }) => x.file_name)).toEqual(['spec.md']);

    const list = await app.inject({ method: 'GET', url: `/api/tasks?project_id=${projectId}&label=${encodeURIComponent('前端')}`, headers: owner });
    expect(list.json().map((x: { title: string }) => x.title)).toEqual(['前端任务']);
  });

  it('DELETE 204 后 GET 404', async () => {
    const t = (await create({ title: '删我' })).json();
    const del = await app.inject({ method: 'DELETE', url: `/api/tasks/${t.id}`, headers: owner });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({ method: 'GET', url: `/api/tasks/${t.id}`, headers: owner });
    expect(get.statusCode).toBe(404);
  });

  it('只读成员不能新建、修改、删除任务；普通成员可以', async () => {
    const viewer = await login('viewer@t.com', 'viewer');
    const member = await login('member@t.com', 'member');
    const t = (await create({ title: 'x' })).json();

    expect((await create({ title: 'v' }, viewer)).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: `/api/tasks/${t.id}`, headers: viewer, payload: { title: 'v' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/tasks/${t.id}`, headers: viewer })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/tasks/${t.id}`, headers: viewer })).statusCode).toBe(200);

    expect((await create({ title: 'm' }, member)).statusCode).toBe(201);
    expect((await app.inject({ method: 'DELETE', url: `/api/tasks/${t.id}`, headers: member })).statusCode).toBe(204);
  });
});
