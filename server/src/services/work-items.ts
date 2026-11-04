import { ValidationError } from '../core/errors.js';
import { getToday, type TodayItem } from './today.js';

export type WorkItemScope = 'my' | 'verify' | 'active';

/**
 * WorkItem 统一读模型（R91 阶段 A）：
 * 复用 /api/today 的跨项目聚合，再按项目/队列切片。表不动，旧 bugs/tasks API 保持兼容。
 * 以后跨类型查询真的成为痛点，再换成独立查询/表合并。
 */
export async function getWorkItems(input: {
  userId: string;
  projectId: string;
  scope?: WorkItemScope;
}): Promise<{ items: TodayItem[]; scope: WorkItemScope; project_id: string }> {
  const scope = input.scope ?? 'my';
  if (!['my', 'verify', 'active'].includes(scope)) {
    throw new ValidationError('scope 必须是 my / verify / active');
  }
  if (!input.projectId) throw new ValidationError('project_id 必填：队列按当前项目取数');
  const today = await getToday(input.userId);
  const source = scope === 'my' ? today.needs_me : scope === 'verify' ? today.to_verify : today.active;
  return {
    items: source.filter((i) => i.project.id === input.projectId),
    scope,
    project_id: input.projectId,
  };
}
