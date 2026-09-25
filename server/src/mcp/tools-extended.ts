import { mcpActor, type McpContext } from './context.js';
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
import { mcpStore } from './context-store.js';
import { signUploadGrant, UPLOAD_GRANT_TTL_SEC } from '../core/upload-grant.js';
import { guessMimeType } from '../core/mime.js';
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
    actor: mcpActor(ctx),
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
/**
 * 附件落在哪（R84）：给了 bug_id 就以缺陷所在项目为准（并校验缺陷存在，不留指向空缺陷的附件）；
 * 否则按 project_slug 解析（多项目未传时报错并列出可选 slug）。
 */
async function resolveUploadTarget(bugId: string | undefined, projectSlug: string | undefined) {
  if (bugId?.trim()) {
    const bug = await bugsService.getBug(bugId.trim());
    return { projectId: bug.projectId, entityType: 'bug' as const, entityId: bug.id };
  }
  const project = await projectsService.resolveProject(projectSlug);
  return { projectId: project.id, entityType: 'general' as const, entityId: null };
}

/**
 * 12. upload_attachment（R84 起 AI 友好）：文本（日志/JSON/堆栈）直接传 content，不用 base64；
 * 很小的二进制仍可传 data_base64；本地文件请用 create_upload_url 走 curl，内容不经过对话。
 */
export async function uploadAttachment(ctx: McpContext, input: {
  project_slug?: string;
  bug_id?: string;
  file_name: string;
  file_type?: string;
  content?: string;
  data_base64?: string;
}) {
  const hasText = typeof input.content === 'string';
  if (hasText === (typeof input.data_base64 === 'string')) {
    throw new ValidationError(
      '请提供 content（文本原文）或 data_base64（很小的二进制）二者之一；本地文件请用 create_upload_url 拿到 curl 命令直接上传，内容不经过对话',
    );
  }
  const buffer = hasText ? Buffer.from(input.content as string, 'utf8') : Buffer.from(input.data_base64 as string, 'base64');
  if (buffer.byteLength > config.maxUploadBytes) {
    throw new PayloadTooLargeError(`文件超过 ${config.maxUploadBytes} 字节限制`);
  }
  const target = await resolveUploadTarget(input.bug_id, input.project_slug);
  const attachment = await attachmentsService.uploadFromBuffer({
    ...target,
    fileName: input.file_name,
    fileType: input.file_type?.trim() || guessMimeType(input.file_name, hasText ? 'text/plain' : 'application/octet-stream'),
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
      bug_id: target.entityId,
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
export async function createTask(ctx: McpContext, input: {
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
  }, mcpActor(ctx));
  if (input.attachment_ids?.length) {
    await attachmentsService.linkMany(input.attachment_ids, 'task', task.id);
  }
  return {
    ok: true,
    task: { id: task.id, title: task.title, status: task.status, priority: task.priority, labels: task.labels, project_slug: project.slug },
    ...taskFlow(task.status),
  };
}

export async function updateTask(ctx: McpContext, input: {
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
  }, mcpActor(ctx));
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

/**
 * create_upload_url（R84）：本地文件（截图、二进制、大文件）走签名直传——返回一条 curl 命令，
 * AI 在终端执行即可把文件传到 VibeHub，文件内容不经过对话（不占 token、不会被模型抄错）。
 * 链接基于 SSE 握手时客户端连进来的地址（stdio 回落本机端口），10 分钟有效、只能用一次。
 */
export async function createUploadUrl(ctx: McpContext, input: {
  file_name: string;
  file_type?: string;
  bug_id?: string;
  project_slug?: string;
}) {
  const fileName = input.file_name?.trim();
  if (!fileName) throw new ValidationError('file_name 不能为空（带扩展名，如 screenshot.png、app.log）');
  const target = await resolveUploadTarget(input.bug_id, input.project_slug);
  const token = signUploadGrant({
    ...target,
    fileName,
    fileType: input.file_type?.trim() || guessMimeType(fileName),
    uploadedBy: ctx.apiKeyId ?? ctx.actorLabel,
    apiKeyId: ctx.apiKeyId,
  });
  const uploadUrl = `${mcpStore.origin() ?? `http://127.0.0.1:${config.port}`}/api/uploads?token=${token}`;
  return {
    upload_url: uploadUrl,
    method: 'PUT',
    expires_in_sec: UPLOAD_GRANT_TTL_SEC,
    curl: `curl -sS -T '<本地文件路径>' '${uploadUrl}'`,
    next_step:
      '在终端执行 curl（把 <本地文件路径> 换成实际路径）；返回 JSON 里的 attachment.id 就是附件 ID，可传给 create_bug 的 attachment_ids。链接 10 分钟内有效、只能用一次。',
  };
}
