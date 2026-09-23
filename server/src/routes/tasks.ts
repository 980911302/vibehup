import type { FastifyPluginAsync } from 'fastify';
import * as tasksService from '../services/tasks.js';
import * as attachmentsService from '../services/attachments.js';
import { ValidationError } from '../core/errors.js';
import { serializeTask } from '../core/serialize.js';

export const taskRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/tasks?project_id=&status=&priority=&q=
  fastify.get('/', async (request) => {
    const q = request.query as Record<string, string>;
    const tasks = await tasksService.listTasks({
      projectId: q.project_id,
      status: q.status,
      priority: q.priority,
      q: q.q,
    });
    return tasks.map(serializeTask);
  });

  // POST /api/tasks
  fastify.post('/', async (request, reply) => {
    const body = request.body as {
      project_id?: string;
      title?: string;
      description?: string;
      priority?: string;
      assignee_id?: string | null;
      attachment_ids?: string[];
    };
    if (!body?.project_id) throw new ValidationError('project_id 不能为空');
    if (!body?.title?.trim()) throw new ValidationError('title 不能为空');
    const task = await tasksService.createTask({
      projectId: body.project_id,
      title: body.title,
      description: body.description,
      priority: body.priority,
      assigneeId: body.assignee_id,
    });
    if (body.attachment_ids?.length) {
      await attachmentsService.linkMany(body.attachment_ids, 'task', task.id);
    }
    reply.code(201);
    return serializeTask(task);
  });

  // GET /api/tasks/:taskId
  fastify.get('/:taskId', async (request) => {
    const { taskId } = request.params as { taskId: string };
    const task = await tasksService.getTask(taskId);
    return serializeTask(task);
  });

  // PATCH /api/tasks/:taskId
  fastify.patch('/:taskId', async (request) => {
    const { taskId } = request.params as { taskId: string };
    const body = request.body as {
      title?: string;
      description?: string;
      priority?: string;
      status?: string;
    };
    const task = await tasksService.updateTask(taskId, body);
    return serializeTask(task);
  });

  // DELETE /api/tasks/:taskId
  fastify.delete('/:taskId', async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    await tasksService.deleteTask(taskId);
    reply.code(204);
    return null;
  });
};
