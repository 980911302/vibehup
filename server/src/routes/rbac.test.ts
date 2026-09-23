import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../index.js';
import { prisma } from '../core/prisma.js';
import { resetDb } from '../test-helpers.js';

/**
 * RBAC 矩阵表驱动测试（步骤 05 §5.3：4 角色 × 关键端点）。
 * 期望：200/201/204=允许，401=未登录，403=无角色。
 */

let app: FastifyInstance;

beforeEach(async () => {
  await resetDb();
  app = await buildServer();
  await app.ready();
});

type Role = 'owner' | 'admin' | 'member' | 'viewer';

interface Case {
  role: Role | null;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  payload?: unknown;
  /** 期望状态码 */
  expect: number;
  note: string;
}

/** 四角色 × 关键端点矩阵（与 00-总览 §3 角色宪法一致） */
const CASES: Case[] = [
  // --- 未登录 ---
  { role: null, method: 'GET', url: '/api/users', expect: 401, note: '未登录访问成员列表' },

  // --- 成员管理（Admin+） ---
  { role: 'viewer', method: 'GET', url: '/api/users', expect: 200, note: 'viewer 可查看成员列表' },
  { role: 'member', method: 'GET', url: '/api/users', expect: 200, note: 'member 可查看成员列表' },
  { role: 'member', method: 'POST', url: '/api/users', payload: { email: 'x@t.com', name: 'X' }, expect: 403, note: 'member 建号 403' },
  { role: 'viewer', method: 'POST', url: '/api/users', payload: { email: 'y@t.com', name: 'Y' }, expect: 403, note: 'viewer 建号 403' },
  { role: 'admin', method: 'POST', url: '/api/users', payload: { email: 'ok@t.com', name: 'OK' }, expect: 201, note: 'admin 建号 201' },
  { role: 'owner', method: 'POST', url: '/api/users', payload: { email: 'ok2@t.com', name: 'OK2' }, expect: 201, note: 'owner 建号 201' },

  // --- 模板管理（Admin+） ---
  { role: 'member', method: 'GET', url: '/api/bugs/templates', expect: 200, note: 'member 可查看模板' },
  { role: 'member', method: 'POST', url: '/api/bugs/templates', payload: { name: 'T', title_template: 'x' }, expect: 403, note: 'member 建模板 403' },
  { role: 'admin', method: 'POST', url: '/api/bugs/templates', payload: { name: 'T2', title_template: 'x' }, expect: 201, note: 'admin 建模板 201' },

  // --- CSV 导入（Admin+） ---
  { role: 'member', method: 'POST', url: '/api/bugs/import', payload: { project_id: 'p', csv: 'x' }, expect: 403, note: 'member 导入 403' },

  // --- 项目管理 ---
  { role: 'viewer', method: 'POST', url: '/api/projects', payload: { name: 'VP' }, expect: 403, note: 'viewer 建项目 403' },
  { role: 'member', method: 'POST', url: '/api/projects', payload: { name: 'MP' }, expect: 403, note: 'member 建项目 403' },
  { role: 'owner', method: 'POST', url: '/api/projects', payload: { name: 'OP' }, expect: 201, note: 'owner 建项目 201' },
  { role: 'admin', method: 'POST', url: '/api/projects', payload: { name: 'AP' }, expect: 201, note: 'admin 建项目 201' },
];

async function loginAs(role: Role): Promise<Record<string, string>> {
  const email = `${role}@t.com`;
  const password = 'abcd1234';
  const reg = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password, name: role },
  });
  // 首位是 owner；其余按需提权（直接改库，模拟既成事实）
  if (role !== 'owner') {
    await prisma.user.update({ where: { email }, data: { role } });
  }
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  void reg;
  return { authorization: `Bearer ${login.json().access_token}` };
}

describe('RBAC 矩阵', () => {
  it('表驱动：' + CASES.length + ' 个场景全部符合角色宪法', async () => {
    // 先建 owner（首位注册规则）
    await loginAs('owner');

    const headerCache = new Map<Role, Record<string, string>>();
    for (const c of CASES) {
      if (c.role && !headerCache.has(c.role)) {
        headerCache.set(c.role, await loginAs(c.role));
      }
      const headers = c.role ? headerCache.get(c.role)! : {};
      const res = await app.inject({
        method: c.method,
        url: c.url,
        headers,
        payload: c.payload as never,
      });
      expect(res.statusCode, `${c.note}（${c.method} ${c.url} as ${c.role}）`).toBe(c.expect);
    }
  });

  it('owner 转让后角色互换生效', async () => {
    const ownerHeaders = await loginAs('owner');
    // 建 admin 与 member
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'm2@t.com', password: 'abcd1234', name: 'M2' } });
    const member = await prisma.user.findUnique({ where: { email: 'm2@t.com' } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/users/transfer-ownership',
      headers: ownerHeaders,
      payload: { target_user_id: member!.id },
    });
    expect(res.statusCode).toBe(204);
    const m = await prisma.user.findUnique({ where: { id: member!.id } });
    expect(m?.role).toBe('owner');
  });

  it('LAST_OWNER：禁用最后一个 owner 被拒', async () => {
    const ownerHeaders = await loginAs('owner');
    const owner = await prisma.user.findUnique({ where: { email: 'owner@t.com' } });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/users/${owner!.id}`,
      headers: ownerHeaders,
      payload: { status: 'disabled' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('LAST_OWNER');
  });
});
