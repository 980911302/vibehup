import { ForbiddenError, NotFoundError, ValidationError } from '../core/errors.js';
import { prisma } from '../core/prisma.js';
import * as projectsService from '../services/projects.js';
import * as bugsService from '../services/bugs.js';
import * as tasksService from '../services/tasks.js';
import { isTextFile } from '../services/assets.js';
import { ctxHas, type McpContext } from './context.js';
import { DEFAULT_BUDGET, truncateText } from './token-budget.js';
import { bugNextStep, taskFlow } from './workflow.js';

export type WorkEntityType = 'bug' | 'task';

export async function resolveWorkEntityType(id: string, explicit?: WorkEntityType): Promise<WorkEntityType> {
  const trimmed = id?.trim();
  if (!trimmed) throw new ValidationError('id 不能为空');
  if (explicit === 'bug' || explicit === 'task') return explicit;
  if (trimmed.startsWith('bug_')) return 'bug';
  if (trimmed.startsWith('tsk_')) return 'task';
  const bugExists = await prisma.bug.findUnique({ where: { id: trimmed }, select: { id: true } });
  if (bugExists) return 'bug';
  const taskExists = await prisma.task.findUnique({ where: { id: trimmed }, select: { id: true } });
  if (taskExists) return 'task';
  throw new NotFoundError(`工作项不存在: ${trimmed}`);
}

/** 3. get_work_item —— 读取缺陷或任务完整详情、附件与可走下一步 */
export async function getWorkItem(
  ctx: McpContext,
  input: { id: string; type?: WorkEntityType; full?: boolean },
) {
  const kind = await resolveWorkEntityType(input.id, input.type);
  if (kind === 'bug') {
    if (!ctxHas(ctx, 'context:read')) throw new ForbiddenError('缺少 scope: context:read');
    const bug = await bugsService.getBugDetail(input.id.trim());
    const fmt = (s: string | null) =>
      input.full ? { value: s, truncated: false } : truncateText(s, DEFAULT_BUDGET.textFieldMax);
    const steps = fmt(bug.stepsToReproduce);
    const expected = fmt(bug.expectedResult);
    const actual = fmt(bug.actualResult);
    return {
      entity_type: 'bug' as const,
      id: bug.id,
      project_id: bug.projectId,
      title: bug.title,
      priority: bug.priority,
      labels: bug.labels,
      assignee_id: bug.assigneeId,
      steps_to_reproduce: steps.value,
      steps_to_reproduce_truncated: steps.truncated,
      expected_result: expected.value,
      expected_result_truncated: expected.truncated,
      actual_result: actual.value,
      actual_result_truncated: actual.truncated,
      severity: bug.severity,
      status: bug.status,
      ...bugNextStep(bug.status),
      resolution_notes: bug.resolutionNotes,
      evidence: bug.evidence ?? null,
      git_commit_hash: bug.gitCommitHash,
      created_by: bug.createdBy,
      created_at: bug.createdAt.toISOString(),
      updated_at: bug.updatedAt.toISOString(),
      attachments: bug.attachments.map((a) => ({
        id: a.id,
        file_name: a.fileName,
        file_type: a.fileType,
        file_size: a.fileSize,
        width: a.width,
        height: a.height,
        is_text: isTextFile(a.fileName, a.fileType),
        is_image: a.fileType.startsWith('image/'),
        url: a.publicUrl,
      })),
      ...(steps.truncated || expected.truncated || actual.truncated
        ? { tip: '长字段已按 500 字符截断；需要全文时传 full: true，读附件用 read_attachment' }
        : {}),
    };
  }

  if (!ctxHas(ctx, 'task:read') && !ctxHas(ctx, 'context:read')) {
    throw new ForbiddenError('缺少 scope: task:read 或 context:read');
  }
  const task = await tasksService.getTaskDetail(input.id.trim());
  const [project, names] = await Promise.all([
    projectsService.getProject(task.projectId),
    tasksService.resolveAssigneeNames([task.assigneeId]),
  ]);
  const desc = input.full
    ? { value: task.description, truncated: false }
    : truncateText(task.description, DEFAULT_BUDGET.textFieldMax);
  return {
    entity_type: 'task' as const,
    id: task.id,
    project_slug: project.slug,
    title: task.title,
    description: desc.value,
    description_truncated: desc.truncated,
    status: task.status,
    ...taskFlow(task.status),
    priority: task.priority,
    labels: task.labels,
    assignee: task.assigneeId ? { id: task.assigneeId, name: names.get(task.assigneeId) ?? null } : null,
    reopen_reason: task.reopenReason,
    evidence: task.evidence ?? null,
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
    ...(desc.truncated ? { tip: '描述已截断，需要全文时传 full: true 再调一次' } : {}),
  };
}
