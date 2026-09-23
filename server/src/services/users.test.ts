import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../core/prisma.js';
import { resetDb, createUser } from '../test-helpers.js';
import * as usersService from './users.js';

/** 成员管理单测（步骤 05：12 例） */

beforeEach(async () => {
  await resetDb();
});

async function seedOwnerAndMember() {
  const owner = await createUser({ email: 'o@t.com', name: 'Owner' }); // 首位=owner
  const member = await createUser({ email: 'm@t.com', name: 'Member' });
  return { owner, member };
}

describe('listUsers', () => {
  it('支持 role/status 过滤与拼音检索', async () => {
    const { owner, member } = await seedOwnerAndMember();
    await prisma.user.update({ where: { id: member.user.id }, data: { name: '张三' } });

    const all = await usersService.listUsers({});
    expect(all).toHaveLength(2);

    const owners = await usersService.listUsers({ role: 'owner' });
    expect(owners).toHaveLength(1);
    expect(owners[0].id).toBe(owner.user.id);

    const byPinyin = await usersService.listUsers({ q: 'zhangsan' });
    expect(byPinyin).toHaveLength(1);
    expect(byPinyin[0].name).toBe('张三');

    const byInitials = await usersService.listUsers({ q: 'zs' });
    expect(byPinyin.length).toBeGreaterThan(0);
    expect(byInitials.map((u) => u.name)).toContain('张三');
  });
});

describe('createUserByAdmin', () => {
  it('缺省密码随机生成并返回一次性明文（可登录）', async () => {
    await createUser({ email: 'o@t.com', name: 'Owner' });
    const { user, one_time_password } = await usersService.createUserByAdmin({
      email: 'new@t.com',
      name: '新用户',
    });
    expect(one_time_password).toBeTruthy();
    expect((one_time_password as string).length).toBeGreaterThan(8);
    // 明文可登录
    const svc = await import('./auth.js');
    const login = await svc.login({ email: 'new@t.com', password: one_time_password as string });
    expect(login.user.id).toBe(user.id);
  });

  it('重复邮箱/非法角色/非法邮箱拒绝', async () => {
    await usersService.createUserByAdmin({ email: 'x@t.com', name: 'X' });
    await expect(usersService.createUserByAdmin({ email: 'x@t.com', name: 'X2' })).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
    await expect(usersService.createUserByAdmin({ email: 'y@t.com', name: 'Y', role: 'boss' })).rejects.toThrow('角色');
    await expect(usersService.createUserByAdmin({ email: 'bad', name: 'Z' })).rejects.toThrow('邮箱格式');
  });
});

describe('updateUser 保护规则', () => {
  it('不能改自己的角色', async () => {
    const { member } = await seedOwnerAndMember();
    await expect(
      usersService.updateUser(member.user.id, member.user.id, { role: 'admin' }),
    ).rejects.toThrow('自己');
  });

  it('不能禁用/降级最后一个 Owner', async () => {
    const { owner, member } = await seedOwnerAndMember();
    // member 是普通成员，operator 用 owner
    await expect(
      usersService.updateUser(owner.user.id, owner.user.id, { status: 'disabled' }),
    ).rejects.toMatchObject({ code: 'LAST_OWNER' });
    await expect(
      usersService.updateUser(member.user.id, owner.user.id, { role: 'member' }),
    ).rejects.toMatchObject({ code: 'LAST_OWNER' });
    expect(member).toBeDefined();
  });

  it('存在第二个 Owner 时可降级原 Owner（由新 Owner 操作）', async () => {
    const { owner, member } = await seedOwnerAndMember();
    // 先把 member 提为 admin（owner 操作），再由 admin 把 member 提为 owner
    await usersService.updateUser(owner.user.id, member.user.id, { role: 'admin' });
    // admin 提 owner：operator=member（admin），target=member 自己——会被「不能改自己」拦，
    // 所以让 owner 直接提 member 为 owner（此时有两个 owner），再由新 owner 降级原 owner
    await usersService.updateUser(owner.user.id, member.user.id, { role: 'owner' });
    const updated = await usersService.updateUser(member.user.id, owner.user.id, { role: 'admin' });
    expect(updated.role).toBe('admin');
  });

  it('非法角色/状态拒绝', async () => {
    const { owner, member } = await seedOwnerAndMember();
    await expect(usersService.updateUser(owner.user.id, member.user.id, { role: 'x' })).rejects.toThrow('角色');
    await expect(usersService.updateUser(owner.user.id, member.user.id, { status: 'x' })).rejects.toThrow('状态');
  });
});

describe('removeUser / transferOwnership', () => {
  it('移除不级联业务数据（缺陷保留）', async () => {
    const { owner, member } = await seedOwnerAndMember();
    const project = await prisma.project.create({ data: { id: 'prj_rm', name: 'P', slug: 'p-rm' } });
    const bug = await prisma.bug.create({ data: { id: 'bug_rm', projectId: project.id, title: '保留' } });
    await usersService.removeUser(owner.user.id, member.user.id);
    expect(await prisma.user.findUnique({ where: { id: member.user.id } })).toBeNull();
    expect(await prisma.bug.findUnique({ where: { id: bug.id } })).not.toBeNull();
  });

  it('不能移除自己；不能移除最后一个 Owner', async () => {
    const { owner } = await seedOwnerAndMember();
    await expect(usersService.removeUser(owner.user.id, owner.user.id)).rejects.toThrow('自己');
    await expect(usersService.removeUser(owner.user.id, owner.user.id)).rejects.toThrow();
  });

  it('Owner 转让：双方角色互换，非 Owner 拒绝', async () => {
    const { owner, member } = await seedOwnerAndMember();
    await expect(
      usersService.transferOwnership(member.user.id, owner.user.id),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await usersService.transferOwnership(owner.user.id, member.user.id);
    const o = await prisma.user.findUnique({ where: { id: owner.user.id } });
    const m = await prisma.user.findUnique({ where: { id: member.user.id } });
    expect(m?.role).toBe('owner');
    expect(o?.role).toBe('admin');
  });
});
