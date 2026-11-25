import { ForbiddenError, ValidationError } from '../core/errors.js';
import * as projectsService from '../services/projects.js';
import * as bugsService from '../services/bugs.js';
import * as tasksService from '../services/tasks.js';
import * as skillsService from '../services/skills.js';
import * as memoryService from '../services/memory.js';
import * as notesService from '../services/notes.js';
import * as usersService from '../services/users.js';
import { globalSearch } from '../services/search.js';
import { isStale } from '../services/stale.js';
import { ctxHas, type McpContext } from './context.js';
import { DEFAULT_BUDGET, paginate, truncateText } from './token-budget.js';
import { contextReminders } from './workflow.js';

/**
 * MCP 核心上下文、检索与便签工具（R96 9 工具精简版）：
 * 1. get_project_context（吸收 get_me + list_members + list_skills）
 * 2. search（吸收 list_bugs + list_tasks + list_notes + 关键词/语义全局检索）
 * 8. append_note（原 append_scratchpad，单活跃项目时自动归属当前项目）
 */

export function handledBy(x: { statusActorName: string | null; statusChangedAt: Date | null; status: string }) {
  return {
    status_actor: x.statusActorName,
    status_changed_at: x.statusChangedAt?.toISOString() ?? null,
    ...(isStale(x.status, x.statusChangedAt) ? { stale: true } : {}),
  };
}

export function briefBug(bug: bugsService.BugWithMeta) {
  return {
    id: bug.id,
    title: bug.title,
    severity: bug.severity,
    status: bug.status,
    priority: bug.priority,
    labels: bug.labels,
    assignee_id: bug.assigneeId,
    attachment_count: bug.attachmentCount,
    updated_at: bug.updatedAt.toISOString(),
    ...handledBy(bug),
  };
}

function briefTask(t: tasksService.TaskWithMeta) {
  return {
    id: t.id,
    title: t.title,
    description: truncateText(t.description, DEFAULT_BUDGET.noteMax).value,
    priority: t.priority,
    status: t.status,
    labels: t.labels,
    assignee_id: t.assigneeId,
    ...handledBy(t),
  };
}

/** 1. get_project_context —— 一次冷启动拿到身份、团队成员、项目记忆、在办/待验收与技能清单 */
export async function getProjectContext(ctx: McpContext, input: { project_slug?: string } = {}) {
  const project = await projectsService.resolveProject(input.project_slug);
  const [board, tasks, doingTasks, reviewTasks, verifyingTasks, notes, skills, memory, activeUsers] = await Promise.all([
    bugsService.getBugBoard(project.id, 20),
    tasksService.listTasks({ projectId: project.id, status: 'todo' }),
    tasksService.listTasks({ projectId: project.id, status: 'doing' }),
    tasksService.listTasks({ projectId: project.id, status: 'review' }),
    tasksService.listTasks({ projectId: project.id, status: 'verifying' }),
    notesService.listNotes({ projectId: project.id, limit: 5 }),
    skillsService.listSkills({ projectId: project.id }),
    memoryService.getProjectMemoryForMcp(project.id),
    usersService.listUsers({ status: 'active' }),
  ]);

  const isAdmin = ctxHas(ctx, 'admin');
  const members = activeUsers.slice(0, 50).map((u) => ({
    id: u.id,
    name: u.name,
    role: u.role,
    writable: u.role !== 'viewer',
    ...(isAdmin ? { email: u.email } : {}),
    is_me: ctx.human?.id === u.id,
  }));

  const openBugs = [...board.open, ...board.in_progress].map(briefBug);
  const awaitingVerification = board.resolved.map(briefBug);
  const verifyingBugs = board.verifying.map(briefBug);
  const staleBugs = [...board.in_progress, ...board.verifying].filter((b) => isStale(b.status, b.statusChangedAt));
  const staleTasks = [...doingTasks, ...verifyingTasks].filter((t) => isStale(t.status, t.statusChangedAt));

  return {
    me: {
      mode: ctx.mode,
      actor: ctx.actorName ?? ctx.actorLabel,
      human: ctx.human ?? null,
      key: ctx.key ?? null,
      capabilities: [...ctx.scopes].sort(),
    },
    members,
    project: { id: project.id, name: project.name, slug: project.slug },
    summary: {
      open_bugs: openBugs.length,
      awaiting_verification: awaitingVerification.length,
      todo_tasks: tasks.length,
      doing_tasks: doingTasks.length,
      review_tasks: reviewTasks.length,
      verifying: verifyingBugs.length + verifyingTasks.length,
      stale: staleBugs.length + staleTasks.length,
      recent_notes: notes.length,
      skills: skills.length,
      members: activeUsers.length,
    },
    reminders: contextReminders({
      inProgressBugs: board.in_progress.length,
      awaitingVerification: awaitingVerification.length,
      doingTasks: doingTasks.length,
      reviewTasks: reviewTasks.length,
      staleBugs: staleBugs.length,
      staleTasks: staleTasks.length,
    }),
    memory,
    open_bugs: openBugs.slice(0, DEFAULT_BUDGET.listLimit),
    awaiting_verification: awaitingVerification.slice(0, DEFAULT_BUDGET.listLimit),
    doing_tasks: doingTasks.slice(0, 20).map(briefTask),
    review_tasks: reviewTasks.slice(0, 20).map(briefTask),
    verifying_bugs: verifyingBugs.slice(0, DEFAULT_BUDGET.listLimit),
    verifying_tasks: verifyingTasks.slice(0, 20).map(briefTask),
    stale_items: [...staleBugs.map(briefBug), ...staleTasks.map(briefTask)].slice(0, DEFAULT_BUDGET.listLimit),
    todo_tasks: tasks.slice(0, 20).map(briefTask),
    skills: skills.slice(0, DEFAULT_BUDGET.listLimit).map((s) => ({
      name: s.name,
      description: truncateText(s.description, DEFAULT_BUDGET.noteMax).value,
      scope: s.projectId ? 'project' : 'global',
    })),
    recent_notes: notes.map((n) => ({
      id: n.id,
      ...truncateText(n.content, DEFAULT_BUDGET.noteMax),
      tags: n.tagList,
      created_at: n.createdAt.toISOString(),
    })),
  };
}

export interface SearchInput {
  q?: string;
  project_slug?: string;
  type?: 'bug' | 'task' | 'note' | 'all';
  status?: string;
  label?: string;
  page?: number;
  limit?: number;
}

/** 2. search —— 关键词/语义检索（传 q）+ 项目内结构化列表过滤（不传 q）二合一 */
export async function search(ctx: McpContext, input: SearchInput) {
  const entityType = input.type ?? 'all';
  if (entityType !== 'task' && !ctxHas(ctx, 'context:read')) {
    throw new ForbiddenError('缺少 scope: context:read');
  }
  if (entityType === 'task' && !ctxHas(ctx, 'task:read') && !ctxHas(ctx, 'context:read')) {
    throw new ForbiddenError('缺少 scope: task:read 或 context:read');
  }

  const limit = Math.min(Math.max(input.limit ?? DEFAULT_BUDGET.listLimit, 1), 100);
  const q = input.q?.trim();

  if (q) {
    const project = input.project_slug ? await projectsService.getProjectBySlug(input.project_slug) : null;
    const raw = await globalSearch(q, Math.min(limit, 50), project?.id);
    const filterStatus = <T extends { status: string }>(arr: T[]) => (input.status ? arr.filter((x) => x.status === input.status) : arr);
    const filterLabel = <T extends { labels?: string[]; tags?: string[] }>(arr: T[]) =>
      input.label ? arr.filter((x) => (x.labels ?? x.tags ?? []).includes(input.label!)) : arr;

    return {
      mode: 'query' as const,
      project: project ? { id: project.id, name: project.name, slug: project.slug } : null,
      bugs: entityType === 'all' || entityType === 'bug' ? filterLabel(filterStatus(raw.bugs)) : [],
      tasks: entityType === 'all' || entityType === 'task' ? filterLabel(filterStatus(raw.tasks)) : [],
      notes: entityType === 'all' || entityType === 'note' ? filterLabel(raw.notes) : [],
      projects: entityType === 'all' ? raw.projects : [],
      attachments: entityType === 'all' ? raw.attachments : [],
      similar: {
        bugs: entityType === 'all' || entityType === 'bug' ? raw.similar.bugs : [],
        notes: entityType === 'all' || entityType === 'note' ? raw.similar.notes : [],
      },
    };
  }

  const page = Math.max(input.page ?? 1, 1);
  const offset = (page - 1) * limit;
  const project = await projectsService.resolveProject(input.project_slug);

  const [bugsRes, tasksRes, notesRes] = await Promise.all([
    entityType === 'all' || entityType === 'bug'
      ? bugsService.listBugs({ projectId: project.id, status: input.status, page: 1, pageSize: 200 })
      : null,
    entityType === 'all' || entityType === 'task'
      ? tasksService.listTasks({ projectId: project.id, status: input.status, label: input.label })
      : null,
    entityType === 'all' || entityType === 'note'
      ? notesService.listNotes({ projectId: project.id, tag: input.label, limit })
      : null,
  ]);

  const bugItems = (bugsRes?.items ?? [])
    .filter((b) => !input.label || b.labels.includes(input.label))
    .map(briefBug);
  const taskItems = (tasksRes ?? []).map(briefTask);

  return {
    mode: 'list' as const,
    project: { id: project.id, name: project.name, slug: project.slug },
    page,
    limit,
    ...(bugsRes ? { bugs: paginate(bugItems.slice(offset), limit) } : {}),
    ...(tasksRes ? { tasks: paginate(taskItems.slice(offset), limit) } : {}),
    ...(notesRes
      ? {
          notes: notesRes.map((n) => ({
            id: n.id,
            content: truncateText(n.content, DEFAULT_BUDGET.noteMax).value,
            tags: n.tagList,
            project_id: n.projectId,
            created_at: n.createdAt.toISOString(),
          })),
        }
      : {}),
  };
}

/** 8. append_note —— AI 暂存排查记录或设计草案（单活跃项目自动挂该项目，多项目要求传 project_slug） */
export async function appendNote(
  _ctx: McpContext,
  input: { content: string; project_slug?: string; tags?: string[] },
) {
  if (!input.content?.trim()) {
    throw new ValidationError('content 不能为空');
  }
  let projectId: string | null = null;
  if (input.project_slug?.trim()) {
    projectId = (await projectsService.resolveProject(input.project_slug)).id;
  } else {
    const active = (await projectsService.listProjects()).filter((p) => !p.archivedAt);
    if (active.length === 1) {
      projectId = active[0].id;
    } else if (active.length > 1) {
      projectId = (await projectsService.resolveProject(undefined)).id;
    }
  }
  const note = await notesService.createNote({
    projectId,
    content: input.content,
    tags: input.tags,
  });
  return {
    id: note.id,
    project_id: note.projectId,
    content: note.content,
    tags: notesService.parseTags(note.tags),
    created_at: note.createdAt.toISOString(),
  };
}
