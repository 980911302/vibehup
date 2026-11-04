/**
 * MCP Scope 体系（AGENTS.md §5 契约）。
 * 密钥默认最小权限：仅 context:read；写操作须显式授予。
 */

export const SCOPES = [
  'context:read',
  'attachment:read',
  'attachment:write',
  'bug:write',
  'note:write',
  'task:read',
  'task:write',
  'skill:write',
  'admin',
] as const;

export type Scope = (typeof SCOPES)[number];

/** local（stdio 无密钥）模式持有的全量 scope */
export const LOCAL_SCOPES: ReadonlySet<string> = new Set<string>(SCOPES);

export function isKnownScope(scope: string): scope is Scope {
  return (SCOPES as readonly string[]).includes(scope);
}

/** scope 守卫：集合包含或持有 admin 即通过 */
export function hasScope(scopes: ReadonlySet<string>, required: Scope): boolean {
  return scopes.has(required) || scopes.has('admin');
}

/**
 * 角色 → 密钥 scope 上限（R89：密钥即个人 AI 身份）。
 * 密钥 scope 是安全边界，不能超过人的角色；管理员也不能把自己的角色「借」给别人的密钥，
 * 因为创建时会按密钥所属人的真实角色重新校验。
 */
export const ROLE_SCOPES: Record<string, readonly Scope[]> = {
  viewer: ['context:read', 'task:read', 'attachment:read'],
  member: ['context:read', 'task:read', 'attachment:read', 'attachment:write', 'bug:write', 'note:write', 'task:write', 'skill:write'],
  admin: [...SCOPES],
  owner: [...SCOPES],
};

export function allowedScopesForRole(role: string): readonly Scope[] {
  return ROLE_SCOPES[role] ?? ROLE_SCOPES.viewer;
}

/** 返回角色不允许的 scope（空数组 = 全部合法） */
export function disallowedScopes(role: string, scopes: readonly string[]): string[] {
  const allowed = new Set<string>(allowedScopesForRole(role));
  return scopes.filter((s) => !allowed.has(s));
}
