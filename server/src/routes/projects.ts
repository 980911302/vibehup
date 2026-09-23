import type { FastifyPluginAsync } from 'fastify';
import * as projectsService from '../services/projects.js';
import { ValidationError } from '../core/errors.js';
import { serializeProject } from '../core/serialize.js';

export const projectRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/projects?q=  —— 支持拼音/模糊检索
  fastify.get('/', async (request) => {
    const { q } = request.query as { q?: string };
    const list = await projectsService.listProjects({ q });
    return list.map((p) =>
      serializeProject(p, {
        openBugCount: p.openBugCount,
        todoTaskCount: p.todoTaskCount,
        attachmentCount: p.attachmentCount,
      }),
    );
  });

  // POST /api/projects（宪法：创建项目 Owner/Admin only）
  fastify.post('/', { preHandler: [fastify.authenticate, fastify.requireRole('owner', 'admin')] }, async (request, reply) => {
    const body = request.body as { name?: string; slug?: string; description?: string };
    if (!body?.name?.trim()) throw new ValidationError('name 不能为空');
    const project = await projectsService.createProject(body as never);
    reply.code(201);
    return serializeProject(project);
  });

  // GET /api/projects/:projectId
  fastify.get('/:projectId', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const project = await projectsService.getProject(projectId);
    return serializeProject(project);
  });

  // PATCH /api/projects/:projectId（管理操作）
  fastify.patch('/:projectId', { preHandler: [fastify.authenticate, fastify.requireRole('owner', 'admin')] }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = request.body as { name?: string; slug?: string; description?: string | null };
    const project = await projectsService.updateProject(projectId, body);
    return serializeProject(project);
  });

  // DELETE /api/projects/:projectId（宪法：删除项目 Owner/Admin only）
  fastify.delete('/:projectId', { preHandler: [fastify.authenticate, fastify.requireRole('owner', 'admin')] }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    await projectsService.deleteProject(projectId);
    reply.code(204);
    return null;
  });
};
