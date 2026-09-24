import type { McpContext } from './context.js';
import * as projectsService from '../services/projects.js';
import * as notesService from '../services/notes.js';
import * as tasksService from '../services/tasks.js';
import * as bugsService from '../services/bugs.js';
import * as bugComments from '../services/bug-comments.js';
import * as attachmentsService from '../services/attachments.js';
import * as apiKeysService from '../services/api-keys.js';
import { globalSearch } from '../services/search.js';
import { config } from '../config.js';
import { ValidationError, PayloadTooLargeError } from '../core/errors.js';
import { DEFAULT_BUDGET, truncateText } from './token-budget.js';
import { taskFlow } from './workflow.js';

/**
 * MCP 新增 7 工具（步骤 03 §3.2 矩阵）：
 * list_notes / search / create_bug / add_bug_comment / upload_attachment / list_tasks / create_task / update_task / purge_trash
 * 全部经 guard 包装（scope + 打点 + Token 经济学）。
 */

/** 8. list_notes —— 便签列表（content 截断） */
export async function listNotes(_ctx: McpContext, input: { project_slug?: string; limit?: number }) {
  const project = input.project_slug
    ? await projectsService.getProjectBySlug(input.project_slug)
    : null;
  const notes = await notesService.listNotes({
    projectId: project ? project.id : undefined,
    limit: input.limit ?? 10,
  });
  return {
    total: notes.length,
    notes: notes.map((n) => ({
      id: n.id,
      content: truncateText(n.content, DEFAULT_BUDGET.noteMax).value,
      tags: n.tags,
      project_id: n.projectId,
      created_at: n.createdAt.toISOString(),
    })),
  };
}

/** 9. search —— 五类实体全局检索（拼音/模糊） */
export async function search(_ctx: McpContext, input: { q: string; limit?: number }) {
  if (!input.q?.trim()) {
    throw new ValidationError('q 不能为空');
  }
  return globalSearch(input.q, input.limit ?? 5);
}

/** 10. create_bug —— AI 自己建单（可关联已上传附件；落 ai 活动流） */
export async function createBug(ctx: McpContext, input: {
  project_slug?: string;
  title: string;
  severity?: string;
  steps_to_reproduce?: string;
  expected_result?: string;
  actual_result?: string;
  attachment_ids?: string[];
}) {
  if (!input.title?.trim()) {
    throw new ValidationError('title 不能为空');
  }
  const bug = await bugsService.createBug({
    projectId: input.project_slug
      ? (await projectsService.getProjectBySlug(input.project_slug)).id
      : (await projectsService.resolveProject(undefined)).id,
    title: input.title,
    severity: input.severity,
    stepsToReproduce: input.steps_to_reproduce,
    expectedResult: input.expected_result,
    actualResult: input.actual_result,
    createdBy: 'ai',
    // 提出人记为密钥创建人（「张磊的 Cursor」建的单算张磊提的）；本地无密钥模式为空
    reporterId: ctx.apiKeyId ? await apiKeysService.getKeyCreatorId(ctx.apiKeyId) : null,
    attachmentIds: input.attachment_ids,
  });
  await bugComments.addComment({
    bugId: bug.id,
    authorType: 'ai',
    authorId: ctx.apiKeyId,
    content: `AI 创建缺陷（${ctx.actorLabel}）`,
  });
  return { ok: true, bug: { id: bug.id, title: bug.title, status: bug.status, severity: bug.severity } };
}

/** 11. add_bug_comment —— AI 修复过程记录 / 追问 */
export async function addBugComment(ctx: McpContext, input: { bug_id: string; content: string }) {
  const { id } = await bugComments.addComment({
    bugId: input.bug_id,
    authorType: 'ai',
    authorId: ctx.apiKeyId,
    content: input.content,
  });
  return { ok: true, comment_id: id };
}

/** 12. upload_attachment —— AI 把日志/截图贴回工单 */
export async function uploadAttachment(ctx: McpContext, input: {
  project_slug?: string;
  bug_id?: string;
  file_name: string;
  file_type: string;
  data_base64: string;
}) {
  const buffer = Buffer.from(input.data_base64, 'base64');
  if (buffer.byteLength > config.maxUploadBytes) {
    throw new PayloadTooLargeError(`文件超过 ${config.maxUploadBytes} 字节限制`);
  }
  const project = await projectsService.resolveProject(input.project_slug);
  const attachment = await attachmentsService.uploadFromBuffer({
    projectId: project.id,
    entityType: input.bug_id ? 'bug' : 'general',
    entityId: input.bug_id ?? null,
    fileName: input.file_name,
    fileType: input.file_type,
    buffer,
    uploadedBy: ctx.apiKeyId ?? ctx.actorLabel,
  });
  return {
    ok: true,
    attachment: {
      id: attachment.id,
      file_name: attachment.fileName,
      file_type: attachment.fileType,
      file_size: attachment.fileSize,
      url: attachment.publicUrl,
    },
  };
}

/** 13. list_tasks / create_task / update_task —— 任务协同 */
export async function listTasks(_ctx: McpContext, input: { project_slug?: string; status?: string; label?: string }) {
  const project = await projectsService.resolveProject(input.project_slug);
  const tasks = await tasksService.listTasks({ projectId: project.id, status: input.status, label: input.label });
  return {
    total: tasks.length,
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: truncateText(t.description, DEFAULT_BUDGET.noteMax).value,
      priority: t.priority,
      status: t.status,
      labels: t.labels,
      assignee_id: t.assigneeId,
    })),
  };
}

/** AI 把拆出来的工作项建成任务（可关联已上传附件）；与 Web「新建任务」同走 tasksService */
export async function createTask(_ctx: McpContext, input: {
  project_slug?: string;
  title: string;
  description?: string;
  priority?: string;
  status?: string;
  labels?: string[];
  attachment_ids?: string[];
}) {
  if (!input.title?.trim()) {
    throw new ValidationError('title 不能为空');
  }
  const project = await projectsService.resolveProject(input.project_slug);
  const task = await tasksService.createTask({
    projectId: project.id,
    title: input.title.trim(),
    description: input.description,
    priority: input.priority,
    status: input.status,
    labels: input.labels,
  });
  if (input.attachment_ids?.length) {
    await attachmentsService.linkMany(input.attachment_ids, 'task', task.id);
  }
  return {
    ok: true,
    task: { id: task.id, title: task.title, status: task.status, priority: task.priority, labels: task.labels, project_slug: project.slug },
    ...taskFlow(task.status),
  };
}

export async function updateTask(_ctx: McpContext, input: {
  task_id: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  labels?: string[];
  reopen_reason?: string;
}) {
  if (input.title !== undefined && !input.title.trim()) {
    throw new ValidationError('title 不能为空');
  }
  const task = await tasksService.updateTask(input.task_id, {
    title: input.title?.trim(),
    description: input.description,
    status: input.status,
    priority: input.priority,
    labels: input.labels,
    reopenReason: input.reopen_reason,
  });
  return {
    ok: true,
    task: { id: task.id, title: task.title, status: task.status, priority: task.priority, labels: task.labels },
    ...taskFlow(task.status),
  };
}

/** 14. purge_trash —— 清理超期回收区（admin scope） */
export async function purgeTrash(_ctx: McpContext, _input: Record<string, unknown>) {
  const { storage } = await import('../services/storage.js');
  const purged = await storage.purgeOlderThan(config.attachmentTrashDays);
  return { ok: true, purged };
}
