import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../index.js';
import { prisma } from '../core/prisma.js';
import { resetDb, createApiKey } from '../test-helpers.js';
import * as projectsService from '../services/projects.js';
import * as usersService from '../services/users.js';
import * as ext from '../mcp/tools-extended.js';

/**
 * 缺陷「提出人」（功能巡检 G8/B7）：此前只记来源是人还是 AI，不记是谁提的——
 * 成员页「建单」恒为 0，也没法筛「我提的」。
 */

let app: FastifyInstance;
let owner: Record<string, string>;
let ownerId: string;
let projectId: string;

async function login(email: string, role?: string): Promise<{ headers: Record<string, string>; id: string }> {
  const password = 'abcd1234';
  await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password, name: email.split('@')[0] } });
  if (role) await prisma.user.update({ where: { email }, data: { role } });
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  return { headers: { authorization: `Bearer ${res.json().access_token}` }, id: res.json().user.id };
}

beforeEach(async () => {
  await resetDb();
  app = await buildServer();
  await app.ready();
  const o = await login('owner@t.com');
  owner = o.headers;
  ownerId = o.id;
  projectId = (await projectsService.createProject({ name: 'P', slug: 'p' })).id;
});

describe('缺陷提出人', () => {
  it('网页录入：提出人是当前用户，列表/看板/详情都带 reporter', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/bugs', headers: owner, payload: { project_id: projectId, title: '登录白屏' } });
    expect(created.json()).toMatchObject({ reporter_id: ownerId, reporter: { id: ownerId, name: 'owner' } });
    const id = created.json().id;

    const board = await app.inject({ method: 'GET', url: `/api/bugs/board/${projectId}`, headers: owner });
    expect(board.json().open[0].reporter).toEqual({ id: ownerId, name: 'owner' });
    const detail = await app.inject({ method: 'GET', url: `/api/bugs/${id}`, headers: owner });
    expect(detail.json().reporter).toEqual({ id: ownerId, name: 'owner' });
    const list = await app.inject({ method: 'GET', url: `/api/bugs?project_id=${projectId}`, headers: owner });
    expect(list.json().items[0].reporter_id).toBe(ownerId);
  });

  it('AI 经 MCP 建单：提出人记为该密钥的创建人；本地无密钥模式为空', async () => {
    const key = await createApiKey({ scopes: ['bug:write'], createdBy: ownerId });
    const viaKey = await ext.createBug({ mode: 'keyed', apiKeyId: key.id, scopes: new Set(['bug:write']), actorLabel: 'cursor' }, { project_slug: 'p', title: 'AI 发现的问题' });
    expect(await prisma.bug.findUnique({ where: { id: viaKey.bug.id } })).toMatchObject({ reporterId: ownerId, createdBy: 'ai' });

    const local = await ext.createBug({ mode: 'local', apiKeyId: null, scopes: new Set(['admin']), actorLabel: 'local' }, { project_slug: 'p', title: '本地 AI' });
    expect((await prisma.bug.findUnique({ where: { id: local.bug.id } }))?.reporterId).toBeNull();
  });

  it('CSV 导入：提出人是导入者，且缺陷 ID 以 bug_ 开头（此前误用附件 ID 生成器）', async () => {
    const csv = '标题,严重度,状态,指派邮箱,标签,优先级,截止日,复现步骤\n导入的缺陷,normal,open,,,medium,,\n';
    const res = await app.inject({ method: 'POST', url: '/api/bugs/import', headers: owner, payload: { project_id: projectId, csv } });
    expect(res.json().imported).toBe(1);
    const bug = await prisma.bug.findFirst({ where: { title: '导入的缺陷' } });
    expect(bug?.id.startsWith('bug_')).toBe(true);
    expect(bug?.reporterId).toBe(ownerId);
  });

  it('成员页「建单」按提出人统计；移除成员后缺陷保留、提出人置空', async () => {
    const member = await login('member@t.com', 'member');
    for (const title of ['一', '二']) {
      await app.inject({ method: 'POST', url: '/api/bugs', headers: member.headers, payload: { project_id: projectId, title } });
    }
    await app.inject({ method: 'POST', url: '/api/bugs', headers: owner, payload: { project_id: projectId, title: '三' } });

    const users = await app.inject({ method: 'GET', url: '/api/users', headers: owner });
    const stats = Object.fromEntries(users.json().map((u: { name: string; stats: { bugs_created: number } }) => [u.name, u.stats.bugs_created]));
    expect(stats).toMatchObject({ member: 2, owner: 1 });

    await usersService.removeUser(ownerId, member.id);
    const orphaned = await prisma.bug.findMany({ where: { title: { in: ['一', '二'] } } });
    expect(orphaned).toHaveLength(2);
    expect(orphaned.every((b) => b.reporterId === null)).toBe(true);
  });
});
