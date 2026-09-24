import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../index.js';
import { prisma } from '../core/prisma.js';
import { resetDb } from '../test-helpers.js';
import * as projectsService from '../services/projects.js';
import * as bugsService from '../services/bugs.js';
import * as notesService from '../services/notes.js';
import * as attachmentsService from '../services/attachments.js';

/**
 * 功能巡检 B2：只读成员（viewer）此前能新建/修改/删除缺陷、便签、附件——只读只做在前端部分按钮上。
 * 现在缺陷、便签、附件的写接口一律限 owner/admin/member；只读成员能看、能存自己的筛选视图。
 */

let app: FastifyInstance;

async function login(email: string, role?: string): Promise<Record<string, string>> {
  const password = 'abcd1234';
  await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password, name: email.split('@')[0] } });
  if (role) await prisma.user.update({ where: { email }, data: { role } });
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  return { authorization: `Bearer ${res.json().access_token}` };
}

function multipart(projectId: string): { payload: string; headers: Record<string, string> } {
  const boundary = '----vhtest';
  const payload = [
    `--${boundary}`, 'Content-Disposition: form-data; name="project_id"', '', projectId,
    `--${boundary}`, 'Content-Disposition: form-data; name="files"; filename="a.txt"', 'Content-Type: text/plain', '', 'hello',
    `--${boundary}--`, '',
  ].join('\r\n');
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

beforeEach(async () => {
  await resetDb();
  app = await buildServer();
  await app.ready();
});

describe('只读成员（viewer）不能写缺陷、便签、附件', () => {
  it('所有写接口 403 且提示人话；读接口照常 200', async () => {
    await login('owner@t.com');
    const viewer = await login('viewer@t.com', 'viewer');
    const p = await projectsService.createProject({ name: 'P', slug: 'p' });
    const bug = await bugsService.createBug({ projectId: p.id, title: '已有缺陷' });
    const note = await notesService.createNote({ projectId: p.id, content: '已有便签' });
    const att = await attachmentsService.uploadFromBuffer({ projectId: p.id, fileName: 'x.log', fileType: 'text/plain', buffer: Buffer.from('x') });
    const mp = multipart(p.id);

    const writes: { method: 'POST' | 'PATCH' | 'DELETE'; url: string; payload?: unknown; headers?: Record<string, string> }[] = [
      { method: 'POST', url: '/api/bugs', payload: { project_id: p.id, title: 'v' } },
      { method: 'PATCH', url: `/api/bugs/${bug.id}`, payload: { title: 'v' } },
      { method: 'DELETE', url: `/api/bugs/${bug.id}` },
      { method: 'POST', url: `/api/bugs/${bug.id}/attachments`, payload: { attachment_id: att.id } },
      { method: 'DELETE', url: `/api/bugs/${bug.id}/attachments/${att.id}` },
      { method: 'POST', url: '/api/bugs/batch', payload: { ids: [bug.id], action: 'label', payload: { labels: ['x'] } } },
      { method: 'POST', url: `/api/bugs/${bug.id}/comments`, payload: { content: 'v' } },
      { method: 'POST', url: '/api/notes', payload: { project_id: p.id, content: 'v' } },
      { method: 'PATCH', url: `/api/notes/${note.id}`, payload: { content: 'v' } },
      { method: 'DELETE', url: `/api/notes/${note.id}` },
      { method: 'POST', url: '/api/upload', payload: mp.payload, headers: mp.headers },
      { method: 'POST', url: '/api/upload/base64', payload: { project_id: p.id, file_name: 'a.txt', data_base64: 'aGk=' } },
      { method: 'DELETE', url: `/api/attachments/${att.id}` },
    ];
    for (const w of writes) {
      const res = await app.inject({ method: w.method, url: w.url, payload: w.payload as never, headers: { ...viewer, ...w.headers } });
      expect(res.statusCode, `${w.method} ${w.url}`).toBe(403);
      expect(res.json().error.message, `${w.method} ${w.url}`).toContain('只读');
    }

    // 数据原样未动
    expect(await prisma.bug.findUnique({ where: { id: bug.id } })).toMatchObject({ title: '已有缺陷' });
    expect(await prisma.note.count()).toBe(1);
    expect(await prisma.attachment.count()).toBe(1);

    for (const url of [`/api/bugs?project_id=${p.id}`, `/api/bugs/${bug.id}`, `/api/notes?project_id=${p.id}`, `/api/attachments?project_id=${p.id}`]) {
      expect((await app.inject({ method: 'GET', url, headers: viewer })).statusCode, url).toBe(200);
    }
    // 个人筛选视图属于个人偏好，只读成员也能存
    const view = await app.inject({ method: 'POST', url: '/api/bugs/views', headers: viewer, payload: { name: '我的视图', filters: {} } });
    expect(view.statusCode).toBe(201);
  });

  it('普通成员照常可写', async () => {
    await login('owner@t.com');
    const member = await login('member@t.com', 'member');
    const p = await projectsService.createProject({ name: 'P', slug: 'p' });
    const bug = await app.inject({ method: 'POST', url: '/api/bugs', headers: member, payload: { project_id: p.id, title: 'm' } });
    expect(bug.statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: `/api/bugs/${bug.json().id}/comments`, headers: member, payload: { content: 'c' } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/api/notes', headers: member, payload: { project_id: p.id, content: 'n' } })).statusCode).toBe(201);
    const mp = multipart(p.id);
    expect((await app.inject({ method: 'POST', url: '/api/upload', headers: { ...member, ...mp.headers }, payload: mp.payload })).statusCode).toBe(201);
  });
});
