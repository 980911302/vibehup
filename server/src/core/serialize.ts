import type { Attachment, Bug, Note, Project, Skill, Task } from '@prisma/client';
import { signAssetUrl } from './asset-sign.js';

/**
 * API 序列化：统一输出 snake_case（与设计文档 SQL 字段风格一致），
 * 并将 Note.tags 的 JSON 字符串解码为数组。
 */

export function serializeProject(
  p: Project,
  counts?: { openBugCount: number; todoTaskCount: number; attachmentCount: number },
) {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    archived_at: p.archivedAt?.toISOString() ?? null,
    ...(counts
      ? {
          open_bug_count: counts.openBugCount,
          todo_task_count: counts.todoTaskCount,
          attachment_count: counts.attachmentCount,
        }
      : {}),
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };
}

type PersonRef = { id: string; name: string } | null;

/** 最近一次流转的「谁、什么时候」（R83）：历史数据没有记录时 status_actor 为 null */
function statusActorFields(x: { statusChangedAt: Date | null; statusActorType: string | null; statusActorName: string | null }) {
  return {
    status_changed_at: x.statusChangedAt?.toISOString() ?? null,
    status_actor: x.statusActorType ? { type: x.statusActorType as 'user' | 'ai', name: x.statusActorName ?? '' } : null,
  };
}

export function serializeBug(b: Bug & { attachmentCount?: number; commentCount?: number; assignee?: PersonRef; reporter?: PersonRef }) {
  return {
    id: b.id,
    project_id: b.projectId,
    title: b.title,
    steps_to_reproduce: b.stepsToReproduce,
    expected_result: b.expectedResult,
    actual_result: b.actualResult,
    severity: b.severity,
    status: b.status,
    priority: b.priority,
    assignee_id: b.assigneeId,
    assignee: b.assignee ? { id: b.assignee.id, name: b.assignee.name } : null,
    reporter_id: b.reporterId,
    reporter: b.reporter ? { id: b.reporter.id, name: b.reporter.name } : null,
    due_date: b.dueDate?.toISOString() ?? null,
    labels: b.labels,
    reopened_count: b.reopenedCount,
    ...statusActorFields(b),
    git_commit_hash: b.gitCommitHash,
    created_by: b.createdBy,
    resolution_notes: b.resolutionNotes,
    attachment_count: b.attachmentCount,
    comment_count: b.commentCount,
    created_at: b.createdAt.toISOString(),
    updated_at: b.updatedAt.toISOString(),
  };
}

/**
 * assigneeNames：负责人 id → 名字（任务表不建外键，由路由批量查出后传入）；
 * allowedNext：状态机给出的可走下一步（由 services/tasks 计算，序列化层不依赖 service）。
 */
export function serializeTask(
  t: Task & { attachmentCount?: number },
  extra: { assigneeNames?: Map<string, string>; allowedNext?: string[] } = {},
) {
  const assigneeName = t.assigneeId ? extra.assigneeNames?.get(t.assigneeId) : undefined;
  return {
    id: t.id,
    project_id: t.projectId,
    title: t.title,
    description: t.description,
    priority: t.priority,
    status: t.status,
    labels: t.labels,
    assignee_id: t.assigneeId,
    assignee: t.assigneeId && assigneeName ? { id: t.assigneeId, name: assigneeName } : null,
    reopen_reason: t.reopenReason,
    reopened_count: t.reopenedCount,
    ...statusActorFields(t),
    allowed_next_statuses: extra.allowedNext,
    attachment_count: t.attachmentCount,
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString(),
  };
}

export function serializeNote(n: Note & { tagList?: string[]; attachmentCount?: number }) {
  return {
    id: n.id,
    project_id: n.projectId,
    content: n.content,
    tags: n.tagList ?? [],
    is_archived: n.isArchived,
    pinned_at: n.pinnedAt?.toISOString() ?? null,
    attachment_count: n.attachmentCount,
    created_at: n.createdAt.toISOString(),
    updated_at: n.updatedAt.toISOString(),
  };
}

/**
 * 本地代理地址签名（R76）：<img> 带不了令牌，签名链接无需 Authorization 即可取回。
 * 本地存储一律按记录 ID 生成——存量行的 publicUrl 曾指向落盘 ID（≠ 记录 ID），不可信。
 */
function signedPublicUrl(a: Attachment): string | null {
  if (a.storageType === 'local') return signAssetUrl(`/api/attachments/${a.id}/raw`, a.id);
  return a.publicUrl;
}

export function serializeAttachment(a: Attachment) {
  return {
    id: a.id,
    project_id: a.projectId,
    entity_type: a.entityType,
    entity_id: a.entityId,
    file_name: a.fileName,
    file_type: a.fileType,
    file_size: a.fileSize,
    storage_type: a.storageType,
    uploaded_by: a.uploadedBy,
    public_url: signedPublicUrl(a),
    width: a.width,
    height: a.height,
    created_at: a.createdAt.toISOString(),
  };
}

/** 技能：scope=project（挂在某项目下）| global（全团队通用） */
export function serializeSkill(
  s: Omit<Skill, 'content'> & { content?: string; fileCount?: number; totalSize?: number },
  files?: { path: string; size: number; isText: boolean }[],
) {
  return {
    id: s.id,
    project_id: s.projectId,
    scope: s.projectId ? 'project' : 'global',
    name: s.name,
    description: s.description,
    source: s.source,
    uploaded_by: s.uploadedBy,
    file_count: files ? files.length : s.fileCount,
    size: files ? files.reduce((n, f) => n + f.size, 0) : s.totalSize,
    ...(s.content !== undefined ? { content: s.content } : {}),
    ...(files ? { files: files.map((f) => ({ path: f.path, size: f.size, is_text: f.isText })) } : {}),
    created_at: s.createdAt.toISOString(),
    updated_at: s.updatedAt.toISOString(),
  };
}
