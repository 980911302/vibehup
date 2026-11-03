/**
 * 角色 → 密钥 scope 上限的前端镜像。
 * 唯一权威在 server/src/mcp/scopes.ts 的 ROLE_SCOPES；改一处必须同改。
 * 前端用它只显示「当前角色能申请的权限」，真正的拦截仍在服务端。
 */
export const ROLE_SCOPES: Record<string, readonly string[]> = {
  viewer: ['context:read', 'task:read', 'attachment:read'],
  member: ['context:read', 'task:read', 'attachment:read', 'attachment:write', 'bug:write', 'note:write', 'task:write', 'skill:write'],
  admin: ['context:read', 'task:read', 'attachment:read', 'attachment:write', 'bug:write', 'note:write', 'task:write', 'skill:write', 'admin'],
  owner: ['context:read', 'task:read', 'attachment:read', 'attachment:write', 'bug:write', 'note:write', 'task:write', 'skill:write', 'admin'],
};

export function allowedScopesForRole(role: string | undefined): string[] {
  return [...(ROLE_SCOPES[role ?? 'viewer'] ?? ROLE_SCOPES.viewer)];
}
