import type { FastifyPluginAsync } from 'fastify';
import * as bugsService from '../services/bugs.js';
import * as attachmentsService from '../services/attachments.js';
import { serializeAttachment } from '../core/serialize.js';
import { ValidationError } from '../core/errors.js';
import { serializeBug } from '../core/serialize.js';
import { WRITER_ROLES } from '../plugins/authenticate.js';

export const bugRoutes: FastifyPluginAsync = async (fastify) => {
  // 写操作限 owner/admin/member：viewer（只读）只能看（功能巡检 B2）
  const canWrite = { preHandler: [fastify.requireRole(...WRITER_ROLES)] };

  // GET /api/bugs?project_id=&status=&severity=&q=&page=&page_size=
  fastify.get('/', async (request) => {
    const q = request.query as Record<string, string>;
    const result = await bugsService.listBugs({
      projectId: q.project_id,
      status: q.status,
      severity: q.severity,
      q: q.q,
      page: q.page ? Number(q.page) : undefined,
      pageSize: q.page_size ? Number(q.page_size) : undefined,
    });
    return { ...result, items: result.items.map(serializeBug) };
  });

  // GET /api/bugs/board/:projectId —— 看板视图（Open / In Progress / Resolved 分组）
  fastify.get('/board/:projectId', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const board = await bugsService.getBugBoard(projectId);
    return {
      open: board.open.map(serializeBug),
      in_progress: board.in_progress.map(serializeBug),
      resolved: board.resolved.map(serializeBug),
      verified: board.verified.map(serializeBug),
      closed: board.closed.map(serializeBug),
    };
  });

  // POST /api/bugs
  fastify.post('/', canWrite, async (request, reply) => {
    const body = request.body as {
      project_id?: string;
      title?: string;
      steps_to_reproduce?: string;
      expected_result?: string;
      actual_result?: string;
      severity?: string;
      priority?: string;
      assignee_id?: string | null;
      due_date?: string | null;
      labels?: string[];
      attachment_ids?: string[];
      template_id?: string;
    };
    if (!body?.project_id) throw new ValidationError('project_id 不能为空');
    if (!body?.title?.trim()) throw new ValidationError('title 不能为空');

    // 模板填充：title 为空时按模板标题骨架生成；fields 提供默认值
    let title = body.title;
    let defaults: Record<string, unknown> = {};
    if (body.template_id) {
      const { getTemplate } = await import('../services/bug-templates.js');
      const tpl = await getTemplate(body.template_id);
      if (tpl) {
        if (!title.trim()) title = tpl.title_template;
        defaults = tpl.fields;
      }
    }

    const bug = await bugsService.createBug({
      projectId: body.project_id,
      title,
      stepsToReproduce: body.steps_to_reproduce ?? (defaults.steps_to_reproduce as string) ?? undefined,
      expectedResult: body.expected_result,
      actualResult: body.actual_result,
      severity: body.severity ?? (defaults.severity as string) ?? undefined,
      priority: body.priority ?? (defaults.priority as string) ?? undefined,
      assigneeId: body.assignee_id ?? null,
      dueDate: body.due_date ?? null,
      labels: body.labels ?? (defaults.labels as string[]) ?? undefined,
      attachmentIds: body.attachment_ids,
      reporterId: request.user?.id ?? null,
    });
    reply.code(201);
    return serializeBug(bug);
  });

  // GET /api/bugs/:bugId —— 完整详情 + 附件清单
  fastify.get('/:bugId', async (request) => {
    const { bugId } = request.params as { bugId: string };
    const bug = await bugsService.getBugDetail(bugId);
    return {
      ...serializeBug({ ...bug, attachmentCount: bug.attachments.length }),
      attachments: bug.attachments.map(serializeAttachment),
    };
  });

  // PATCH /api/bugs/:bugId —— 拖拽改状态 / 编辑
  fastify.patch('/:bugId', canWrite, async (request) => {
    const { bugId } = request.params as { bugId: string };
    const body = request.body as {
      title?: string;
      steps_to_reproduce?: string;
      expected_result?: string;
      actual_result?: string;
      severity?: string;
      status?: string;
      priority?: string;
      assignee_id?: string | null;
      due_date?: string | null;
      labels?: string[];
      resolution_notes?: string;
      git_commit_hash?: string;
      reopen_reason?: string;
    };
    const bug = await bugsService.updateBug(bugId, {
      title: body.title,
      stepsToReproduce: body.steps_to_reproduce,
      expectedResult: body.expected_result,
      actualResult: body.actual_result,
      severity: body.severity,
      status: body.status,
      priority: body.priority,
      assigneeId: body.assignee_id,
      dueDate: body.due_date,
      labels: body.labels,
      resolutionNotes: body.resolution_notes,
      gitCommitHash: body.git_commit_hash,
      reopenReason: body.reopen_reason,
      actor: { type: 'user', id: request.user?.id },
    });
    return serializeBug(bug);
  });

  // DELETE /api/bugs/:bugId
  fastify.delete('/:bugId', canWrite, async (request, reply) => {
    const { bugId } = request.params as { bugId: string };
    await bugsService.deleteBug(bugId);
    reply.code(204);
    return null;
  });

  // POST /api/bugs/:bugId/attachments —— 关联已有附件
  fastify.post('/:bugId/attachments', canWrite, async (request, reply) => {
    const { bugId } = request.params as { bugId: string };
    const body = request.body as { attachment_id?: string };
    if (!body?.attachment_id) throw new ValidationError('attachment_id 不能为空');
    const attachment = await attachmentsService.linkAttachment(body.attachment_id, 'bug', bugId);
    reply.code(201);
    return serializeAttachment(attachment);
  });

  // DELETE /api/bugs/:bugId/attachments/:attachmentId
  fastify.delete('/:bugId/attachments/:attachmentId', canWrite, async (request, reply) => {
    const { attachmentId } = request.params as { attachmentId: string };
    await attachmentsService.deleteAttachment(attachmentId);
    reply.code(204);
    return null;
  });
};
