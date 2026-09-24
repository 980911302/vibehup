import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { buildServer } from '../index.js';
import { prisma } from '../core/prisma.js';
import { resetDb } from '../test-helpers.js';
import * as projectsService from '../services/projects.js';

/** 技能 REST：上传（JSON / zip）、列表、详情、单文件、下载、调整归属、删除、角色限制 */

let app: FastifyInstance;
let owner: Record<string, string>;
let projectId: string;

const md = (name: string, description = '团队的提交规范') => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;

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
  projectId = (await projectsService.createProject({ name: '用户中心', slug: 'uc' })).id;
});

const upload = (payload: Record<string, unknown>, headers = owner) =>
  app.inject({ method: 'POST', url: '/api/skills', headers, payload });

describe('技能 REST', () => {
  it('JSON 上传：新建 201，同名再传覆盖 200；详情含 SKILL.md 与文件清单', async () => {
    const first = await upload({
      project_id: projectId,
      skill_md: md('commit-style'),
      files: [{ path: 'scripts/check.sh', content: 'echo ok' }, { path: 'logo.png', content_base64: Buffer.from([0x89, 0, 1]).toString('base64') }],
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      action: 'created',
      skill: { name: 'commit-style', scope: 'project', project_id: projectId, file_count: 2, source: 'human' },
    });
    const id = first.json().skill.id;

    const again = await upload({ project_id: projectId, skill_md: md('commit-style', '改过的描述') });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ action: 'updated', skill: { id, description: '改过的描述', file_count: 0 } });

    const detail = await app.inject({ method: 'GET', url: `/api/skills/${id}`, headers: owner });
    expect(detail.json().content).toContain('name: commit-style');
    expect(detail.json().files).toEqual([]);
  });

  it('zip 上传：带顶层目录的技能包', async () => {
    const zip = zipSync({ 'deploy/SKILL.md': strToU8(md('deploy')), 'deploy/run.sh': strToU8('echo deploy') });
    const res = await upload({ project_id: null, zip_base64: Buffer.from(zip).toString('base64') });
    expect(res.statusCode).toBe(201);
    expect(res.json().skill).toMatchObject({ name: 'deploy', scope: 'global', file_count: 1 });
  });

  it('解析失败给人话 400', async () => {
    const res = await upload({ project_id: projectId, skill_md: '# 没有 frontmatter' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('frontmatter');
    expect((await upload({ project_id: projectId })).json().error.message).toContain('skill_md');
  });

  it('列表：本项目 + 通用；单文件读取；下载 zip', async () => {
    const s = (await upload({ project_id: projectId, skill_md: md('proj-skill'), files: [{ path: 'a.txt', content: '你好' }] })).json().skill;
    await upload({ project_id: null, skill_md: md('global-skill') });

    const list = await app.inject({ method: 'GET', url: `/api/skills?project_id=${projectId}`, headers: owner });
    expect(list.json().map((x: { name: string }) => x.name)).toEqual(['global-skill', 'proj-skill']);
    const onlyProject = await app.inject({ method: 'GET', url: `/api/skills?project_id=${projectId}&include_global=false`, headers: owner });
    expect(onlyProject.json()).toHaveLength(1);

    const f = await app.inject({ method: 'GET', url: `/api/skills/${s.id}/file?path=a.txt`, headers: owner });
    expect(f.json()).toEqual({ path: 'a.txt', size: 6, is_text: true, content: '你好' });

    const dl = await app.inject({ method: 'GET', url: `/api/skills/${s.id}/download`, headers: owner });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toBe('application/zip');
    expect(dl.headers['content-disposition']).toContain('proj-skill.zip');
    expect(Object.keys(unzipSync(new Uint8Array(dl.rawPayload))).sort()).toEqual(['proj-skill/SKILL.md', 'proj-skill/a.txt']);
  });

  it('PATCH 改为通用；DELETE 204 后 404', async () => {
    const s = (await upload({ project_id: projectId, skill_md: md('movable') })).json().skill;
    const moved = await app.inject({ method: 'PATCH', url: `/api/skills/${s.id}`, headers: owner, payload: { project_id: null } });
    expect(moved.json()).toMatchObject({ scope: 'global', project_id: null });

    expect((await app.inject({ method: 'DELETE', url: `/api/skills/${s.id}`, headers: owner })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/skills/${s.id}`, headers: owner })).statusCode).toBe(404);
  });

  it('只读成员能看不能改；普通成员可以上传', async () => {
    const viewer = await login('viewer@t.com', 'viewer');
    const member = await login('member@t.com', 'member');
    const s = (await upload({ project_id: projectId, skill_md: md('guarded') })).json().skill;

    expect((await upload({ project_id: projectId, skill_md: md('by-viewer') }, viewer)).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/skills/${s.id}`, headers: viewer })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: `/api/skills/${s.id}`, headers: viewer, payload: { project_id: null } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/skills/${s.id}`, headers: viewer })).statusCode).toBe(200);

    expect((await upload({ project_id: projectId, skill_md: md('by-member') }, member)).statusCode).toBe(201);
  });

  it('未登录 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/skills' })).statusCode).toBe(401);
  });
});
