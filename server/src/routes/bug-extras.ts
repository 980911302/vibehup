import type { FastifyPluginAsync } from 'fastify';
import * as bugsService from '../services/bugs.js';
import * as bugComments from '../services/bug-comments.js';
import * as bugTemplates from '../services/bug-templates.js';
import * as savedViews from '../services/saved-views.js';
import * as bugImport from '../services/bug-import.js';
import { ValidationError } from '../core/errors.js';

/**
 * 缺陷域扩展路由（步骤 04 §4.3）：批量 / 评论 / 模板 / 视图 / CSV 导入导出。
 */

const BATCH_ACTIONS = ['status', 'assign', 'label', 'priority', 'move_project', 'delete'] as const;

export const bugExtrasRoutes: FastifyPluginAsync = async (app) => {
  // ============ 批量操作（Excel 式，部分失败逐条报原因） ============
  app.post('/batch', { preHandler: [app.authenticate] }, async (request) => {
    const body = request.body as {
      ids?: string[];
      action?: string;
      payload?: Record<string, unknown>;
    };
    if (!Array.isArray(body?.ids) || body.ids.length === 0) {
      throw new ValidationError('ids 不能为空');
    }
    if (!BATCH_ACTIONS.includes(body.action as never)) {
      throw new ValidationError(`action 必须是 ${BATCH_ACTIONS.join(' | ')} 之一`);
    }
    const actor = { type: 'user' as const, id: request.user!.id };
    const payload = body.payload ?? {};

    let updated = 0;
    const skipped: { id: string; reason: string }[] = [];

    for (const id of body.ids) {
      try {
        switch (body.action) {
          case 'status':
            await bugsService.updateBug(id, {
              status: payload.status as string,
              reopenReason: payload.reopen_reason as string | undefined,
              actor,
            });
            break;
          case 'assign':
            await bugsService.updateBug(id, { assigneeId: (payload.assignee_id as string) ?? null, actor });
            break;
          case 'label':
            await bugsService.updateBug(id, { labels: (payload.labels as string[]) ?? [], actor });
            break;
          case 'priority':
            await bugsService.updateBug(id, { priority: payload.priority as string, actor });
            break;
          case 'move_project':
            await bugsService.moveBugToProject(id, payload.project_id as string);
            break;
          case 'delete':
            await bugsService.deleteBug(id);
            break;
        }
        updated++;
      } catch (err) {
        skipped.push({ id, reason: err instanceof Error ? err.message : '操作失败' });
      }
    }
    return { updated, skipped };
  });

  // ============ 评论 / 活动流 ============
  app.get('/:bugId/comments', { preHandler: [app.authenticate] }, async (request) => {
    const { bugId } = request.params as { bugId: string };
    return bugComments.listComments(bugId);
  });

  app.post('/:bugId/comments', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { bugId } = request.params as { bugId: string };
    const body = request.body as { content?: string };
    const { id } = await bugComments.addComment({
      bugId,
      authorType: 'user',
      authorId: request.user!.id,
      content: body?.content ?? '',
    });
    reply.code(201);
    return { id };
  });

  // ============ 缺陷模板 ============
  app.get('/templates', { preHandler: [app.authenticate] }, async () => {
    return bugTemplates.listTemplates();
  });

  app.post('/templates', { preHandler: [app.authenticate, app.requireRole('owner', 'admin')] }, async (request, reply) => {
    const body = request.body as { name?: string; title_template?: string; fields?: Record<string, unknown> };
    const t = await bugTemplates.createTemplate({
      name: body?.name ?? '',
      titleTemplate: body?.title_template ?? '',
      fields: body?.fields,
      createdBy: request.user!.id,
    });
    reply.code(201);
    return t;
  });

  app.patch('/templates/:templateId', { preHandler: [app.authenticate, app.requireRole('owner', 'admin')] }, async (request) => {
    const { templateId } = request.params as { templateId: string };
    const body = request.body as { name?: string; title_template?: string; fields?: Record<string, unknown> };
    return bugTemplates.updateTemplate(templateId, {
      name: body?.name,
      titleTemplate: body?.title_template,
      fields: body?.fields,
    });
  });

  app.delete('/templates/:templateId', { preHandler: [app.authenticate, app.requireRole('owner', 'admin')] }, async (request, reply) => {
    const { templateId } = request.params as { templateId: string };
    await bugTemplates.deleteTemplate(templateId);
    reply.code(204);
    return null;
  });

  // ============ 保存的视图 ============
  app.get('/views', { preHandler: [app.authenticate] }, async (request) => {
    const { entity } = request.query as { entity?: string };
    return savedViews.listViews(request.user!.id, entity);
  });

  app.post('/views', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = request.body as {
      entity?: string;
      name?: string;
      filters?: Record<string, unknown>;
      sort?: Record<string, unknown>;
      columns?: Record<string, unknown>;
      is_default?: boolean;
    };
    const v = await savedViews.createView(request.user!.id, {
      entity: body?.entity ?? 'bug',
      name: body?.name ?? '',
      filters: body?.filters,
      sort: body?.sort,
      columns: body?.columns,
      is_default: body?.is_default,
    });
    reply.code(201);
    return v;
  });

  app.patch('/views/:viewId', { preHandler: [app.authenticate] }, async (request) => {
    const { viewId } = request.params as { viewId: string };
    const body = request.body as Record<string, unknown>;
    return savedViews.updateView(request.user!.id, viewId, body);
  });

  app.delete('/views/:viewId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { viewId } = request.params as { viewId: string };
    await savedViews.deleteView(request.user!.id, viewId);
    reply.code(204);
    return null;
  });

  // ============ CSV 导入导出 ============
  app.get('/export', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { project_id } = request.query as { project_id?: string };
    if (!project_id) throw new ValidationError('project_id 不能为空');
    const csv = await bugImport.exportBugsCsv(project_id);
    // Buffer 显式发送：避免 Fastify 对 string 的序列化层丢失 UTF-8 BOM
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="bugs-export.csv"')
      .send(Buffer.from(csv, 'utf-8'));
  });

  app.post('/import', { preHandler: [app.authenticate, app.requireRole('owner', 'admin')] }, async (request, reply) => {
    const body = request.body as { project_id?: string; csv?: string };
    if (!body?.project_id) throw new ValidationError('project_id 不能为空');
    if (!body?.csv) throw new ValidationError('csv 内容不能为空');
    const result = await bugImport.importBugsCsv(body.project_id, body.csv);
    reply.code(200);
    return result;
  });
};
