import type { Prisma, User } from '@prisma/client';
import { prisma } from '../core/prisma.js';
import { ids } from '../core/ids.js';
import { hashPassword, validatePasswordStrength } from '../core/password.js';
import { randomBytes } from 'node:crypto';
import { buildSearchIndex, matchIndex } from '../core/search.js';
import { serializeUser, type PublicUser } from '../core/serialize-user.js';
import * as errors from '../core/errors.js';
import { logEvent } from './audit.js';

/**
 * 成员管理服务（步骤 02 §2.3 契约）。
 * 单机单团队：不带 org_id；角色 owner/admin/member/viewer 直接挂 User。
 */

export const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

/**
 * 随机一次性密码：base64url 字符集可能纯字母（约 8% 不含数字）导致不满足自家强度策略，
 * 生成后校验，不达标重采样，兜底拼接字母数字位。
 */
function randomOneTimePassword(): string {
  let pwd = randomBytes(9).toString('base64url');
  let attempts = 0;
  while (validatePasswordStrength(pwd) && attempts < 5) {
    pwd = randomBytes(9).toString('base64url');
    attempts++;
  }
  return validatePasswordStrength(pwd) ? `${pwd}a1` : pwd;
}

export interface UserWithStats extends PublicUser {
  stats: { bugs_created: number; files_uploaded: number; active_keys: number };
}

async function userStats(userId: string): Promise<UserWithStats['stats']> {
  const [filesUploaded, activeKeys] = await Promise.all([
    prisma.attachment.count({ where: { uploadedBy: userId } }),
    prisma.apiKey.count({ where: { createdBy: userId, revokedAt: null } }),
  ]);
  return { bugs_created: 0, files_uploaded: filesUploaded, active_keys: activeKeys };
}

/** 成员列表：支持 status/role 过滤与 q（姓名/邮箱/拼音）检索 */
export async function listUsers(query: {
  status?: string;
  role?: string;
  q?: string;
} = {}): Promise<UserWithStats[]> {
  const where: Prisma.UserWhereInput = {};
  if (query.status) where.status = query.status;
  if (query.role) where.role = query.role;

  let users = await prisma.user.findMany({ where, orderBy: { createdAt: 'asc' } });
  if (query.q?.trim()) {
    const q = query.q.trim();
    users = users.filter((u) => matchIndex(q, buildSearchIndex(u.name, u.email)));
  }
  return Promise.all(
    users.map(async (u) => ({ ...serializeUser(u), stats: await userStats(u.id) })),
  );
}

export async function getUser(userId: string): Promise<UserWithStats> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new errors.NotFoundError(`用户不存在: ${userId}`);
  return { ...serializeUser(user), stats: await userStats(userId) };
}

/** 管理员建号：密码缺省随机生成，返回一次性明文 */
export async function createUserByAdmin(input: {
  email: string;
  name: string;
  password?: string;
  role?: string;
}): Promise<{ user: PublicUser; one_time_password: string | null }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new errors.ValidationError('邮箱格式不正确');
  }
  if (!input.name.trim()) throw new errors.ValidationError('请填写名字');
  const role = input.role ?? 'member';
  if (!ROLES.includes(role as Role)) {
    throw new errors.ValidationError(`角色必须是 ${ROLES.join(' | ')} 之一`);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new errors.EmailTakenError(email);

  const generated = input.password ? null : randomOneTimePassword();
  const password = input.password ?? generated!;
  const strengthError = validatePasswordStrength(password);
  if (strengthError) throw new errors.ValidationError(strengthError);

  const user = await prisma.user.create({
    data: {
      id: ids.attachment(),
      email,
      name: input.name.trim(),
      passwordHash: await hashPassword(password),
      role,
    },
  });
  return { user: serializeUser(user), one_time_password: generated };
}

async function countOwners(excludeUserId?: string): Promise<number> {
  return prisma.user.count({
    where: { role: 'owner', status: 'active', ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
  });
}

/** 改角色/状态：LAST_OWNER 保护 + 不能改自己角色（防误锁） */
export async function updateUser(
  operatorId: string,
  targetId: string,
  patch: { role?: string; status?: string; name?: string },
): Promise<PublicUser> {
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) throw new errors.NotFoundError(`用户不存在: ${targetId}`);

  if (patch.role !== undefined) {
    if (!ROLES.includes(patch.role as Role)) {
      throw new errors.ValidationError(`角色必须是 ${ROLES.join(' | ')} 之一`);
    }
    if (operatorId === targetId) {
      throw new errors.ForbiddenError('不能修改自己的角色，如需转让请使用「转让 Owner」');
    }
    // 降级/禁用最后一个 Owner 保护
    if (target.role === 'owner' && patch.role !== 'owner') {
      const others = await countOwners(targetId);
      if (others === 0) throw new errors.LastOwnerError();
    }
  }
  if (patch.status !== undefined) {
    if (!['active', 'disabled'].includes(patch.status)) {
      throw new errors.ValidationError('状态必须是 active | disabled');
    }
    if (target.role === 'owner' && patch.status === 'disabled') {
      const others = await countOwners(targetId);
      if (others === 0) throw new errors.LastOwnerError();
    }
  }

  const data: Parameters<typeof prisma.user.update>[0]['data'] = {};
  if (patch.role !== undefined) data.role = patch.role;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new errors.ValidationError('名字不能为空');
    data.name = name;
  }

  const updated = await prisma.user.update({ where: { id: targetId }, data });
  await logEvent({ userId: operatorId, eventType: 'user.updated', metadata: { target: targetId, patch } });
  return serializeUser(updated);
}

/**
 * 移除成员：只摘身份，不级联删除业务数据
 * （其创建的缺陷/文件/便签保留，作者以名字快照呈现——评论流与卡片显示 name 即可）。
 */
export async function removeUser(operatorId: string, targetId: string): Promise<void> {
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) throw new errors.NotFoundError(`用户不存在: ${targetId}`);
  if (operatorId === targetId) {
    throw new errors.ForbiddenError('不能移除自己');
  }
  if (target.role === 'owner') {
    const others = await countOwners(targetId);
    if (others === 0) throw new errors.LastOwnerError();
  }
  await prisma.user.delete({ where: { id: targetId } });
  await logEvent({ userId: operatorId, eventType: 'user.removed', metadata: { target: targetId } });
}

/** Owner 转让：双方角色互换（原 Owner 降为 Admin） */
export async function transferOwnership(operatorId: string, targetUserId: string): Promise<void> {
  const operator = await prisma.user.findUnique({ where: { id: operatorId } });
  if (!operator || operator.role !== 'owner') {
    throw new errors.ForbiddenError('只有 Owner 可以转让');
  }
  if (operatorId === targetUserId) {
    throw new errors.ValidationError('不能转让给自己');
  }
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) throw new errors.NotFoundError(`用户不存在: ${targetUserId}`);

  await prisma.$transaction([
    prisma.user.update({ where: { id: operatorId }, data: { role: 'admin' } }),
    prisma.user.update({ where: { id: targetUserId }, data: { role: 'owner' } }),
  ]);
  await logEvent({ userId: operatorId, eventType: 'user.ownership_transferred', metadata: { target: targetUserId } });
}

export type { User };
