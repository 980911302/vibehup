import type { FastifyPluginAsync } from 'fastify';
import type { Task } from '@prisma/client';
import * as tasksService from '../services/tasks.js';
import * as attachmentsService from '../services/attachments.js';
import { ValidationError } from '../core/errors.js';
import { WRITER_ROLES } from '../plugins/authenticate.js';
import { serializeAttachment, serializeTask } from '../core/serialize.js';

interface TaskBody {
  project_id?: string;
  title?: string;
  description?: string | null;
  priority?: string;
  status?: string;
  assignee_id?: string | null;
  labels?: string[];
  reopen_reason?: string;
  attachment_ids?: string[];
}

/** 单条序列化：附带负责人名字与可走的下一步 */
async function present(task: Task & { attachmentCount?: number }) {
  const assigneeNames = await tasksService.resolveAssigneeNames([task.assigneeId]);
  return serializeTask(task, { assigneeNames, allowedNext: tasksService.allowedNextTaskStatuses(task.status) });
}

export const taskRoutes: FastifyPluginAsync = async (fastify) => {
  // 写操作限 owner/admin/member：viewer（只读）只能看（登录校验已由外层 onRequest 钩子完成）
  const canWrite = { preHandler: [fastify.requireRole(...WRITER_ROLES)] };

  // GET /api/tasks?project_id=&status=&priority=&label=&q=
  fastify.get('/', async (request) => {
    const q = request.query as Record<string, string>;
    const tasks = await tasksService.listTasks({
      projectId: q.project_id,
      status: q.status,
      priority: q.priority,
      label: q.label,
      q: q.q,
    });
    const assigneeNames = await tasksService.resolveAssigneeNames(tasks.map((t) => t.assigneeId));
    return tasks.map((t) =>
      serializeTask(t, { assigneeNames, allowedNext: tasksService.allowedNextTaskStatuses(t.status) }),
    );
  });

  // POST /api/tasks
  fastify.post('/', canWrite, async (request, reply) => {
    const body = request.body as TaskBody;
    if (!body?.project_id) throw new ValidationError('project_id 不能为空');
    if (!body?.title?.trim()) throw new ValidationError('title 不能为空');
    const task = await tasksService.createTask({
      projectId: body.project_id,
      title: body.title.trim(),
      description: body.description,
      priority: body.priority,
      status: body.status,
      assigneeId: body.assignee_id,
      labels: body.labels,
    }, { type: 'user', id: request.user?.id });
    if (body.attachment_ids?.length) {
      await attachmentsService.linkMany(body.attachment_ids, 'task', task.id);
    }
    reply.code(201);
    return present(task);
  });

  // GET /api/tasks/:taskId —— 详情（含附件）
  fastify.get('/:taskId', async (request) => {
    const { taskId } = request.params as { taskId: string };
    const { attachments, ...task } = await tasksService.getTaskDetail(taskId);
    return { ...(await present(task)), attachments: attachments.map(serializeAttachment) };
  });

  // PATCH /api/tasks/:taskId
  fastify.patch('/:taskId', canWrite, async (request) => {
    const { taskId } = request.params as { taskId: string };
    const body = (request.body ?? {}) as TaskBody;
    if (body.title !== undefined && !body.title.trim()) throw new ValidationError('title 不能为空');
    const task = await tasksService.updateTask(taskId, {
      title: body.title?.trim(),
      description: body.description,
      priority: body.priority,
      status: body.status,
      assigneeId: body.assignee_id,
      labels: body.labels,
      reopenReason: body.reopen_reason,
    }, { type: 'user', id: request.user?.id });
    return present(task);
  });

  // DELETE /api/tasks/:taskId
  fastify.delete('/:taskId', canWrite, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    await tasksService.deleteTask(taskId);
    reply.code(204);
    return null;
  });
};
