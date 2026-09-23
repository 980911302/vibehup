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
