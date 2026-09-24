import type { McpContext } from './context.js';
import { prisma } from '../core/prisma.js';
import * as tasksService from '../services/tasks.js';
import * as bugsService from '../services/bugs.js';
import * as notesService from '../services/notes.js';
import * as attachmentsService from '../services/attachments.js';
import { ValidationError } from '../core/errors.js';
import { DEFAULT_BUDGET, truncateText } from './token-budget.js';
import { taskFlow } from './workflow.js';
import { isTextFile } from '../services/assets.js';

/**
 * MCP 补全（R80）：任务详情、删除（任务/缺陷/便签/附件）、修改便签。
 * 删除一律跟着对应数据的写权限（见 tool-scopes.ts）；工具描述要求 AI 删除前先向用户确认。
 */

/** get_task_detail —— 任务全貌：描述、标签、负责人、打回原因、附件与可走的下一步 */
export async function getTaskDetail(_ctx: McpContext, input: { task_id: string; full?: boolean }) {
  const task = await tasksService.getTaskDetail(input.task_id);
  const [project, names] = await Promise.all([
    prisma.project.findUnique({ where: { id: task.projectId }, select: { slug: true } }),
    tasksService.resolveAssigneeNames([task.assigneeId]),
  ]);
  const desc = input.full ? { value: task.description, truncated: false } : truncateText(task.description, DEFAULT_BUDGET.textFieldMax);
  return {
    id: task.id,
    project_slug: project?.slug ?? null,
    title: task.title,
    description: desc.value,
    description_truncated: desc.truncated,
    status: task.status,
    ...taskFlow(task.status),
    priority: task.priority,
    labels: task.labels,
    assignee: task.assigneeId ? { id: task.assigneeId, name: names.get(task.assigneeId) ?? null } : null,
    reopen_reason: task.reopenReason,
    reopened_count: task.reopenedCount,
    attachments: task.attachments.map((a) => ({
      id: a.id,
      file_name: a.fileName,
      file_type: a.fileType,
      file_size: a.fileSize,
      is_text: isTextFile(a.fileName, a.fileType),
      is_image: a.fileType.startsWith('image/'),
    })),
    created_at: task.createdAt.toISOString(),
    updated_at: task.updatedAt.toISOString(),
    ...(desc.truncated ? { tip: '描述已截断，需要全文时带 full: true 再调一次' } : {}),
  };
}

export async function deleteTask(_ctx: McpContext, input: { task_id: string }) {
  const task = await tasksService.getTask(input.task_id);
  await tasksService.deleteTask(task.id);
  return { ok: true, deleted: { id: task.id, title: task.title } };
}

export async function deleteBug(_ctx: McpContext, input: { bug_id: string }) {
  const bug = await bugsService.getBug(input.bug_id);
  await bugsService.deleteBug(bug.id);
  return { ok: true, deleted: { id: bug.id, title: bug.title } };
}

export async function updateNote(
  _ctx: McpContext,
  input: { note_id: string; content?: string; tags?: string[]; pinned?: boolean },
) {
  if (input.content === undefined && input.tags === undefined && input.pinned === undefined) {
    throw new ValidationError('至少要改 content、tags、pinned 中的一项');
  }
  if (input.content !== undefined && !input.content.trim()) throw new ValidationError('content 不能为空');
  const note = await notesService.updateNote(input.note_id, {
    content: input.content,
    tags: input.tags,
    pinned: input.pinned,
  });
  return {
    ok: true,
    note: {
      id: note.id,
      content: truncateText(note.content, DEFAULT_BUDGET.noteMax).value,
      tags: notesService.parseTags(note.tags),
      pinned: note.pinnedAt !== null,
    },
  };
}

export async function deleteNote(_ctx: McpContext, input: { note_id: string }) {
  const note = await notesService.getNote(input.note_id);
  await notesService.deleteNote(note.id);
  return { ok: true, deleted: { id: note.id, content: truncateText(note.content, 80).value } };
}

export async function deleteAttachment(_ctx: McpContext, input: { attachment_id: string }) {
  const attachment = await attachmentsService.getAttachment(input.attachment_id);
  await attachmentsService.deleteAttachment(attachment.id);
  return { ok: true, deleted: { id: attachment.id, file_name: attachment.fileName } };
}
