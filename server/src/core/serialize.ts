import type { Attachment, Bug, Note, Project, Task } from '@prisma/client';

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

export function serializeBug(b: Bug & { attachmentCount?: number; commentCount?: number; assignee?: { id: string; name: string } | null }) {
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
    due_date: b.dueDate?.toISOString() ?? null,
    labels: b.labels,
    reopened_count: b.reopenedCount,
    git_commit_hash: b.gitCommitHash,
    created_by: b.createdBy,
    resolution_notes: b.resolutionNotes,
    attachment_count: b.attachmentCount,
    comment_count: b.commentCount,
    created_at: b.createdAt.toISOString(),
    updated_at: b.updatedAt.toISOString(),
  };
}

export function serializeTask(t: Task & { attachmentCount?: number }) {
  return {
    id: t.id,
    project_id: t.projectId,
    title: t.title,
    description: t.description,
    priority: t.priority,
    status: t.status,
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
    public_url: a.publicUrl,
    width: a.width,
    height: a.height,
    created_at: a.createdAt.toISOString(),
  };
}
