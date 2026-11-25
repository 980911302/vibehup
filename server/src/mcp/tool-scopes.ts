import type { Scope } from './scopes.js';

/**
 * R96 精简后的 9 个核心 MCP 工具及其外层 scope 要求（唯一出处，server.ts 注册时引用）。
 * 跨实体工具（search / get_work_item / create_work_item / update_work_item）在外层放行任一相关权限后，
 * 会在函数内部按 bug / task 进一步做精确 scope 校验，保证最小权限边界不变。
 */
export const TOOL_SCOPES = {
  get_project_context: ['context:read'],
  search: ['context:read', 'task:read'],
  get_work_item: ['context:read', 'task:read'],
  create_work_item: ['bug:write', 'task:write'],
  update_work_item: ['bug:write', 'task:write'],
  read_attachment: ['attachment:read'],
  upload_attachment: ['attachment:write'],
  append_note: ['note:write'],
  get_skill: ['context:read'],
} as const satisfies Record<string, readonly Scope[]>;

export type ToolName = keyof typeof TOOL_SCOPES;
