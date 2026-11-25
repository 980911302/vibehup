import { ForbiddenError, ValidationError } from '../core/errors.js';
import { prisma } from '../core/prisma.js';
import * as projectsService from '../services/projects.js';
import * as bugsService from '../services/bugs.js';
import * as tasksService from '../services/tasks.js';
import * as bugComments from '../services/bug-comments.js';
import * as attachmentsService from '../services/attachments.js';
import * as apiKeysService from '../services/api-keys.js';
import { notifyUser } from '../services/notifications.js';
import { ctxHas, mcpActor, type McpContext } from './context.js';
import { getWorkItem, resolveWorkEntityType, type WorkEntityType } from './tools-work-read.js';
import { bugNextStep, taskFlow } from './workflow.js';

export { getWorkItem, resolveWorkEntityType, type WorkEntityType };

async function resolveValidAssignee(assigneeId: string) {
  const target = await prisma.user.findUnique({
    where: { id: assigneeId },
    select: { id: true, name: true, role: true, status: true },
  });
  if (!target || target.status !== 'active') {
    throw new ValidationError('负责人不存在或已停用；请从 get_project_context.members 选择 active 成员');
  }
  if (target.role === 'viewer') {
    throw new ValidationError(`${target.name} 是只读成员，不能作为缺陷/任务的负责人；请换一个可写成员`);
  }
  return target;
}

export interface CreateWorkItemInput {
  type: WorkEntityType;
  project_slug?: string;
  title: string;
  description?: string;
  priority?: string;
  severity?: string;
  status?: string;
  labels?: string[];
  assignee_id?: string;
  steps_to_reproduce?: string;
  expected_result?: string;
  actual_result?: string;
  attachment_ids?: string[];
}

/** 4. create_work_item —— 创建缺陷（type="bug"）或任务（type="task"） */
export async function createWorkItem(ctx: McpContext, input: CreateWorkItemInput) {
  if (input.type !== 'bug' && input.type !== 'task') {
    throw new ValidationError('type 必须是 bug 或 task');
  }
  if (!input.title?.trim()) throw new ValidationError('title 不能为空');
  const requiredScope = input.type === 'bug' ? 'bug:write' : 'task:write';
  if (!ctxHas(ctx, requiredScope)) {
    throw new ForbiddenError(`当前密钥缺少 scope: ${requiredScope}，不能创建${input.type === 'bug' ? '缺陷' : '任务'}`);
  }
  const assignee = input.assignee_id ? await resolveValidAssignee(input.assignee_id) : null;
  const project = input.project_slug
    ? await projectsService.getProjectBySlug(input.project_slug)
    : await projectsService.resolveProject(undefined);

  if (input.type === 'bug') {
    const bug = await bugsService.createBug({
      projectId: project.id,
      title: input.title.trim(),
      severity: input.severity,
      priority: input.priority,
      labels: input.labels,
      assigneeId: assignee?.id,
      stepsToReproduce: input.steps_to_reproduce ?? input.description,
      expectedResult: input.expected_result,
      actualResult: input.actual_result,
      createdBy: 'ai',
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
    return {
      ok: true,
      entity_type: 'bug' as const,
      bug: { id: bug.id, title: bug.title, status: bug.status, severity: bug.severity, priority: bug.priority, labels: bug.labels, project_slug: project.slug },
      ...bugNextStep(bug.status),
    };
  }

  const task = await tasksService.createTask({
    projectId: project.id,
    title: input.title.trim(),
    description: input.description,
    priority: input.priority,
    status: input.status,
    labels: input.labels,
    assigneeId: assignee?.id,
  }, mcpActor(ctx));
  if (input.attachment_ids?.length) {
    await attachmentsService.linkMany(input.attachment_ids, 'task', task.id);
  }
  return {
    ok: true,
    entity_type: 'task' as const,
    task: { id: task.id, title: task.title, status: task.status, priority: task.priority, labels: task.labels, project_slug: project.slug },
    ...taskFlow(task.status),
  };
}

export interface UpdateWorkItemInput {
  id: string;
  type?: WorkEntityType;
  status?: string;
  resolution_notes?: string;
  commit_hash?: string;
  reopen_reason?: string;
  evidence?: Record<string, unknown>;
  comment?: string;
  assignee_id?: string;
  handoff_reason?: string;
  title?: string;
  description?: string;
  priority?: string;
  severity?: string;
  labels?: string[];
}

/** 5. update_work_item —— 状态流转、交付证据、追加评论、转交负责人一站完成 */
export async function updateWorkItem(ctx: McpContext, input: UpdateWorkItemInput) {
  const kind = await resolveWorkEntityType(input.id, input.type);
  const requiredScope = kind === 'bug' ? 'bug:write' : 'task:write';
  if (!ctxHas(ctx, requiredScope)) {
    throw new ForbiddenError(`当前密钥缺少 scope: ${requiredScope}，不能更新${kind === 'bug' ? '缺陷' : '任务'}`);
  }
  if (input.title !== undefined && !input.title.trim()) throw new ValidationError('title 不能为空');

  const handoffReason = (input.handoff_reason ?? input.comment)?.trim();
  if (input.assignee_id !== undefined) {
    if (!handoffReason) throw new ValidationError('转交负责人必须提供 handoff_reason（或 comment）写明交接原因');
    if (handoffReason.length > 500) throw new ValidationError('转交原因最多 500 字');
  }
  const targetAssignee = input.assignee_id ? await resolveValidAssignee(input.assignee_id) : null;
  const actor = mcpActor(ctx);

  if (kind === 'bug') {
    const hasBugPatch =
      input.status !== undefined ||
      input.resolution_notes !== undefined ||
      input.commit_hash !== undefined ||
      input.reopen_reason !== undefined ||
      input.evidence !== undefined ||
      input.title !== undefined ||
      input.priority !== undefined ||
      input.severity !== undefined ||
      input.labels !== undefined ||
      targetAssignee !== null;

    if (!hasBugPatch && !input.comment?.trim()) {
      throw new ValidationError('至少传入 status、comment、assignee_id、evidence 或字段修改中的一项');
    }

    const bug = hasBugPatch
      ? await bugsService.updateBug(input.id.trim(), {
          title: input.title?.trim(),
          status: input.status,
          priority: input.priority,
          severity: input.severity,
          labels: input.labels,
          assigneeId: targetAssignee?.id,
          resolutionNotes: input.resolution_notes,
          gitCommitHash: input.commit_hash,
          reopenReason: input.reopen_reason,
          evidence: input.evidence,
          actor,
        })
      : await bugsService.getBug(input.id.trim());

    let commentId: string | undefined;
    if (input.comment?.trim()) {
      const added = await bugComments.addComment({
        bugId: bug.id,
        authorType: 'ai',
        authorId: ctx.apiKeyId,
        content: input.comment.trim(),
      });
      commentId = added.id;
    }
    if (targetAssignee && handoffReason) {
      await notifyUser({
        userId: targetAssignee.id,
        type: 'handoff',
        title: `转交给你：${bug.title}`,
        body: handoffReason,
        entityType: 'bug',
        entityId: bug.id,
        projectId: bug.projectId,
      });
      if (!input.comment?.trim() || input.handoff_reason?.trim()) {
        await bugComments.addComment({
          bugId: bug.id,
          authorType: 'ai',
          authorId: ctx.apiKeyId,
          content: `转交给 ${targetAssignee.name}：${handoffReason}`,
        });
      }
    }

    return {
      ok: true,
      entity_type: 'bug' as const,
      bug: {
        id: bug.id,
        title: bug.title,
        status: bug.status,
        severity: bug.severity,
        priority: bug.priority,
        labels: bug.labels,
        resolution_notes: bug.resolutionNotes,
        git_commit_hash: bug.gitCommitHash,
        evidence: bug.evidence ?? null,
        updated_at: bug.updatedAt.toISOString(),
      },
      ...(targetAssignee ? { assignee: { id: targetAssignee.id, name: targetAssignee.name } } : {}),
      ...(commentId ? { comment_id: commentId } : {}),
      ...bugNextStep(bug.status),
    };
  }

  const task = await tasksService.updateTask(
    input.id.trim(),
    {
      title: input.title?.trim(),
      description: input.description,
      status: input.status,
      priority: input.priority,
      labels: input.labels,
      assigneeId: targetAssignee?.id,
      reopenReason: input.reopen_reason,
      evidence: input.evidence,
    },
    actor,
  );
  if (targetAssignee && handoffReason) {
    await notifyUser({
      userId: targetAssignee.id,
      type: 'handoff',
      title: `转交给你：${task.title}`,
      body: handoffReason,
      entityType: 'task',
      entityId: task.id,
      projectId: task.projectId,
    });
  }
  return {
    ok: true,
    entity_type: 'task' as const,
    task: {
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      labels: task.labels,
      evidence: task.evidence ?? null,
    },
    ...(targetAssignee ? { assignee: { id: targetAssignee.id, name: targetAssignee.name } } : {}),
    ...taskFlow(task.status),
  };
}
