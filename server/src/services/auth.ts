import type { User } from '@prisma/client';
import { prisma } from '../core/prisma.js';
import { ids } from '../core/ids.js';
import { signAccessToken, verifyAccessToken } from '../core/jwt.js';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../core/password.js';
import { generateRefreshToken, hashToken } from '../core/tokens.js';
import { serializeUser, type PublicUser } from '../core/serialize-user.js';
import { config } from '../config.js';
import * as errors from '../core/errors.js';
import { logEvent } from './audit.js';
import { isRegistrationOpen } from './system.js';

/**
 * 认证服务（步骤 02 契约）。
 * 首位注册用户自动成为 Owner；refresh 一次性 + family 重放检测；
 * 改密吊销全部会话。
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REFRESH_TTL_MS = config.refreshTokenTtlDays * 24 * 60 * 60 * 1000;
const ACCESS_TTL_SEC = config.accessTokenTtlSec;
/** 刷新令牌重复提交宽限期（R76）：多请求/多标签同时刷新时，后到者提交的是刚被轮换掉的旧令牌 */
const REUSE_GRACE_MS = 10_000;

export interface AuthResult {
  user: PublicUser;
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function issueTokens(
  user: User,
  familyId?: string,
): Promise<{ access_token: string; refresh_token: string }> {
  const accessToken = signAccessToken(
    { sub: user.id, email: user.email, role: user.role },
    ACCESS_TTL_SEC,
  );
  const { token, tokenHash } = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      id: ids.attachment(),
      userId: user.id,
      tokenHash,
      familyId: familyId ?? ids.attachment(),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });
  return { access_token: accessToken, refresh_token: token };
}

function assertActive(user: User): void {
  if (user.status === 'disabled') throw new errors.AccountDisabledError();
}

export async function register(input: { email: string; password: string; name: string }): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!EMAIL_RE.test(email)) throw new errors.ValidationError('邮箱格式不正确');
  if (!name) throw new errors.ValidationError('请填写名字');
  const strengthError = validatePasswordStrength(input.password);
  if (strengthError) throw new errors.ValidationError(strengthError);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new errors.EmailTakenError(email);

  const userCount = await prisma.user.count();
  // 注册开关：关闭后仅允许首位用户（冷启动引导），其余须由管理员建号
  if (!(await isRegistrationOpen()) && userCount > 0) {
    throw new errors.ForbiddenError('系统已关闭自助注册，请联系管理员创建账号');
  }
  const user = await prisma.user.create({
    data: {
      id: ids.attachment(),
      email,
      name,
      passwordHash: await hashPassword(input.password),
      role: userCount === 0 ? 'owner' : 'member', // 首位用户 = Owner
    },
  });

  await logEvent({ userId: user.id, eventType: 'auth.register' });
  const tokens = await issueTokens(user);
  return { user: serializeUser(user), ...tokens, expires_in: ACCESS_TTL_SEC };
}

export async function login(input: { email: string; password: string }): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  // 防枚举：用户不存在与密码错误统一同一错误
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new errors.InvalidCredentialsError();
  }
  assertActive(user);

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await logEvent({ userId: user.id, eventType: 'auth.login' });
  const tokens = await issueTokens({ ...user, lastLoginAt: new Date() });
  return { user: serializeUser({ ...user, lastLoginAt: new Date() }), ...tokens, expires_in: ACCESS_TTL_SEC };
}

/**
 * 刷新：一次性轮换 + 重放检测。
 * 已撤销令牌再次出现 = 重放 → 吊销整个 family 并 401 TOKEN_REUSED。
 */
export async function refresh(refreshToken: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const tokenHash = hashToken(refreshToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!stored || stored.expiresAt.getTime() < Date.now()) {
    throw new errors.UnauthorizedError('登录态已过期，请重新登录', 'INVALID_TOKEN');
  }
  if (stored.revokedAt && !(await isConcurrentRotation(stored))) {
    // 重放：吊销该 family 下所有未撤销令牌
    await prisma.refreshToken.updateMany({
      where: { familyId: stored.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await logEvent({ userId: stored.userId, eventType: 'auth.token_reused' });
    throw new errors.TokenReusedError();
  }

  const user = await prisma.user.findUnique({ where: { id: stored.userId } });
  if (!user) throw new errors.UnauthorizedError('登录态已过期，请重新登录', 'INVALID_TOKEN');
  assertActive(user);

  // 轮换：旧令牌撤销（并发竞态时已被先到者撤销，保留原撤销时间），同 family 发新令牌
  if (!stored.revokedAt) {
    await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  }
  const tokens = await issueTokens(user, stored.familyId);
  return { ...tokens, expires_in: ACCESS_TTL_SEC };
}

/**
 * 旧令牌刚被轮换（宽限期内）且令牌族仍有有效令牌 = 并发刷新竞态，不是盗用重放（R76）。
 * 登出 / 改密 / 重放吊销都会让整族失效，因此不会被误判放行。
 */
async function isConcurrentRotation(stored: { familyId: string; revokedAt: Date | null }): Promise<boolean> {
  if (!stored.revokedAt || Date.now() - stored.revokedAt.getTime() > REUSE_GRACE_MS) return false;
  const alive = await prisma.refreshToken.count({
    where: { familyId: stored.familyId, revokedAt: null, expiresAt: { gt: new Date() } },
  });
  return alive > 0;
}

/** 登出：吊销整个令牌族（R76：否则宽限期内并发签出的同族令牌仍可续命） */
export async function logout(refreshToken: string): Promise<void> {
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(refreshToken) } });
  if (!stored) return;
  await prisma.refreshToken.updateMany({
    where: { familyId: stored.familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** 从 Authorization 头解析并校验 access token，返回用户身份 */
export async function authenticateBearer(header: string | undefined): Promise<{ id: string; role: string; email: string }> {
  if (!header?.startsWith('Bearer ')) {
    throw new errors.UnauthorizedError();
  }
  const payload = verifyAccessToken(header.slice(7));
  if (!payload) throw new errors.UnauthorizedError();
  return { id: payload.sub, role: payload.role, email: payload.email };
}

export async function me(userId: string): Promise<PublicUser & { stats: Record<string, number> }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new errors.UnauthorizedError();
  const [filesUploaded, activeKeys] = await Promise.all([
    prisma.attachment.count({ where: { uploadedBy: userId } }),
    prisma.apiKey.count({ where: { createdBy: userId, revokedAt: null } }),
  ]);
  return {
    ...serializeUser(user),
    stats: { files_uploaded: filesUploaded, active_keys: activeKeys },
  };
}

export async function updateProfile(userId: string, patch: { name?: string }): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new errors.UnauthorizedError();
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new errors.ValidationError('名字不能为空');
    const updated = await prisma.user.update({ where: { id: userId }, data: { name } });
    return serializeUser(updated);
  }
  return serializeUser(user);
}

/** 改密：吊销该用户全部 refresh 令牌（强制所有设备重新登录） */
export async function changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new errors.UnauthorizedError();
  if (!(await verifyPassword(oldPassword, user.passwordHash))) {
    throw new errors.ValidationError('原密码不正确');
  }
  const strengthError = validatePasswordStrength(newPassword);
  if (strengthError) throw new errors.ValidationError(strengthError);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await logEvent({ userId, eventType: 'auth.password_changed' });
}
