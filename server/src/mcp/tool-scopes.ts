import type { Scope } from './scopes.js';

/**
 * 每个 MCP 工具所需的 scope（唯一出处，server.ts 注册时引用）。
 * 删除跟着对应数据的写权限走；技能的查看/下载属于上下文读取（context:read），上传/删除要 skill:write。
 */
export const TOOL_SCOPES = {
  // 读取
  get_project_context: 'context:read',
  list_bugs: 'context:read',
  get_bug_detail: 'context:read',
  read_attachment_text: 'attachment:read',
  inspect_image_asset: 'attachment:read',
  list_notes: 'context:read',
  search: 'context:read',
  list_tasks: 'task:read',
  get_task_detail: 'task:read',
  list_skills: 'context:read',
  download_skill: 'context:read',
  // 写入
  update_bug_status: 'bug:write',
  create_bug: 'bug:write',
  add_bug_comment: 'bug:write',
  delete_bug: 'bug:write',
  append_scratchpad: 'note:write',
  update_note: 'note:write',
  delete_note: 'note:write',
  upload_attachment: 'attachment:write',
  create_upload_url: 'attachment:write',
  delete_attachment: 'attachment:write',
  create_task: 'task:write',
  update_task: 'task:write',
  delete_task: 'task:write',
  upload_skill: 'skill:write',
  delete_skill: 'skill:write',
  purge_trash: 'admin',
} as const satisfies Record<string, Scope>;

export type ToolName = keyof typeof TOOL_SCOPES;
