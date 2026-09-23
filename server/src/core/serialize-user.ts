import type { User } from '@prisma/client';

/**
 * PublicUser 序列化（AGENTS.md API 契约：绝不含 password_hash）。
 */
export function serializeUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    last_login_at: u.lastLoginAt?.toISOString() ?? null,
    created_at: u.createdAt.toISOString(),
  };
}

export type PublicUser = ReturnType<typeof serializeUser>;
