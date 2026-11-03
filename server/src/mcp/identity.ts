import { ForbiddenError, ValidationError } from '../core/errors.js';
import { prisma } from '../core/prisma.js';
import { ctxHas, mcpActor, type McpContext } from './context.js';
import * as bugsService from '../services/bugs.js';
import * as tasksService from '../services/tasks.js';
import * as bugComments from '../services/bug-comments.js';
import * as usersService from '../services/users.js';
import * as projectsService from '../services/projects.js';

/**
 * AI 身份与交接（R90）：AI 先知道「我是谁、我能做什么、团队有谁」，
 * 才能把活接住并交出去；密钥背后的人就是 AI 的身份。
 */

export async function getMe(ctx: McpContext, input: { project_slug?: string } = {}) {
  const project = input.project_slug ? await projectsService.resolveProject(input.project_slug) : null;
  return {
    mode: ctx.mode,
    actor: ctx.actorName ?? ctx.actorLabel,
    human: ctx.human ?? null,
    key: ctx.key ?? null,
    capabilities: [...ctx.scopes].sort(),
    project: project ? { id: project.id, name: project.name, slug: project.slug } : null,
    hint:
      ctx.mode === 'local'
        ? 'stdio 本地模式没有人类身份；写操作会记为「本地 AI」。要归属到具体人，请在客户端配置 VIBEHUB_API_KEY。'
        : '你就是这个密钥背后的人；handoff_work 转交时需要 assignee_id，可先调 list_members。',
  };
}

export async function listMembers(
  ctx: McpContext,
  input: { limit?: number; q?: string } = {},
) {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const users = await usersService.listUsers({ status: 'active', q: input.q });
  const isAdmin = ctxHas(ctx, 'admin');
  const items = users.slice(0, limit).map((u) => ({
    id: u.id,
    name: u.name,
    role: u.role,
    ...(isAdmin ? { email: u.email } : {}),
    is_me: ctx.human?.id === u.id,
  }));
  return {
    items,
    total: users.length,
    has_more: users.length > limit,
    ...(users.length > limit ? { next_cursor: String(limit) } : {}),
    hint: '转交时把 id 传给 handoff_work 的 assignee_id；只读成员不能作为写入负责人。',
  };
}

export async function handoffWork(
  ctx: McpContext,
  input: {
    entity_type: 'bug' | 'task';
    entity_id: string;
    assignee_id: string;
    reason: string;
  },
) {
  if (input.entity_type !== 'bug' && input.entity_type !== 'task') {
    throw new ValidationError('entity_type 必须是 bug 或 task');
  }
  const requiredScope = input.entity_type === 'bug' ? 'bug:write' : 'task:write';
  if (!ctxHas(ctx, requiredScope as never)) {
    throw new ForbiddenError(`当前密钥没有 ${requiredScope} 权限，不能转交${input.entity_type === 'bug' ? '缺陷' : '任务'}`);
  }
  const reason = input.reason?.trim();
  if (!reason) throw new ValidationError('转交必须写一句原因，方便接手人知道下一步');
  if (reason.length > 500) throw new ValidationError('转交原因最多 500 字');

  const target = await prisma.user.findUnique({
    where: { id: input.assignee_id },
    select: { id: true, name: true, role: true, status: true },
  });
  if (!target || target.status !== 'active') {
    throw new ValidationError('负责人不存在或已停用；请先调 list_members 取 active 成员');
  }
  if (target.role === 'viewer') {
    throw new ValidationError(`${target.name} 是只读成员，不能作为缺陷/任务的负责人；请换一个可写成员`);
  }

  if (input.entity_type === 'bug') {
    const bug = await bugsService.getBug(input.entity_id);
    await bugsService.updateBug(bug.id, { assigneeId: target.id, actor: mcpActor(ctx) });
    await bugComments.addComment({
      bugId: bug.id,
      authorType: 'ai',
      authorId: ctx.apiKeyId,
      content: `转交给 ${target.name}：${reason}`,
    });
    return {
      ok: true,
      entity_type: 'bug',
      id: bug.id,
      title: bug.title,
      assignee: { id: target.id, name: target.name },
      reason,
      audit: '已写入缺陷活动流，接手人可在缺陷详情看到转交原因',
    };
  }

  const task = await tasksService.getTask(input.entity_id);
  await tasksService.updateTask(task.id, { assigneeId: target.id }, mcpActor(ctx));
  return {
    ok: true,
    entity_type: 'task',
    id: task.id,
    title: task.title,
    assignee: { id: target.id, name: target.name },
    reason,
    audit: '任务已转交；MCP 调用记入用量。任务活动流暂未开放，原因已返回给调用方',
  };
}
