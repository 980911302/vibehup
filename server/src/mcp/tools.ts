import path from 'node:path';
import fsp from 'node:fs/promises';
import { AppError } from '../core/errors.js';
import * as projectsService from '../services/projects.js';
import * as bugsService from '../services/bugs.js';
import * as tasksService from '../services/tasks.js';
import * as notesService from '../services/notes.js';
import * as attachmentsService from '../services/attachments.js';
import { readTextSlice, isTextFile, inspectImageAsset } from '../services/assets.js';
import { resolveLocalAttachment } from '../services/attachments.js';
import { paginate, truncateText, DEFAULT_BUDGET } from './token-budget.js';
import { bugNextStep, contextReminders } from './workflow.js';

/**
 * MCP Tools 业务实现（设计文档第 4 节）。
 * 原则：减少 Token 消耗、结构扁平、防脏写。
 * 与 HTTP 服务共享同一数据库实例。
 */

const MAX_BASE64_BYTES = 4 * 1024 * 1024; // base64 返回上限 4MB，防止撑爆上下文

function briefBug(bug: bugsService.BugWithMeta) {
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
  };
}

/** 1. get_project_context —— 冷启动：项目活跃状态简报 */
export async function getProjectContext(input: { project_slug?: string }) {
  const project = await projectsService.resolveProject(input.project_slug);
  const [board, tasks, doingTasks, notes] = await Promise.all([
    bugsService.getBugBoard(project.id, 20),
    tasksService.listTasks({ projectId: project.id, status: 'todo' }),
    tasksService.listTasks({ projectId: project.id, status: 'doing' }),
    notesService.listNotes({ projectId: project.id, limit: 5 }),
  ]);

  const openBugs = [...board.open, ...board.in_progress].map(briefBug);
  // 已修待验证 / 已验证待关闭：不摆出来，验证方就看不到该收尾的单子
  const awaitingVerification = [...board.resolved, ...board.verified].map(briefBug);
  const briefTask = (t: { id: string; title: string; priority: string; status: string }) => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    status: t.status,
  });

  return {
    project: { id: project.id, name: project.name, slug: project.slug },
    summary: {
      open_bugs: openBugs.length,
      awaiting_verification: awaitingVerification.length,
      todo_tasks: tasks.length,
      doing_tasks: doingTasks.length,
      recent_notes: notes.length,
    },
    reminders: contextReminders({
      inProgressBugs: board.in_progress.length,
      awaitingVerification: awaitingVerification.length,
      doingTasks: doingTasks.length,
    }),
    open_bugs: openBugs.slice(0, DEFAULT_BUDGET.listLimit),
    awaiting_verification: awaitingVerification.slice(0, DEFAULT_BUDGET.listLimit),
    doing_tasks: doingTasks.slice(0, 20).map(briefTask),
    todo_tasks: tasks.slice(0, 20).map(briefTask),
    recent_notes: notes.map((n) => ({
      id: n.id,
      ...truncateText(n.content, DEFAULT_BUDGET.noteMax),
      tags: n.tagList,
      created_at: n.createdAt.toISOString(),
    })),
  };
}

/** 2. list_bugs —— 缺陷列表（扁平元数据，含附件数量） */
export async function listBugs(input: {
  project_slug?: string;
  status?: string;
  page?: number;
  page_size?: number;
}) {
  const project = await projectsService.resolveProject(input.project_slug);
  const result = await bugsService.listBugs({
    projectId: project.id,
    status: input.status,
    page: input.page,
    pageSize: input.page_size,
  });
  // paginate 提供 total/returned/has_more/next_cursor（Token 经济学整形）
  return {
    project: { id: project.id, name: project.name, slug: project.slug },
    page: result.page,
    page_size: result.pageSize,
    ...paginate(result.items.map(briefBug), input.page_size ?? DEFAULT_BUDGET.listLimit),
  };
}

/** 3. get_bug_detail —— 完整复现描述与附件清单 */
export async function getBugDetail(input: { bug_id: string }) {
  const bug = await bugsService.getBugDetail(input.bug_id);
  const attachments = bug.attachments.map((a) => ({
    id: a.id,
    file_name: a.fileName,
    file_type: a.fileType,
    file_size: a.fileSize,
    width: a.width,
    height: a.height,
    is_text: isTextFile(a.fileName, a.fileType),
    is_image: a.fileType.startsWith('image/'),
    url: a.publicUrl,
  }));
  return {
    id: bug.id,
    project_id: bug.projectId,
    title: bug.title,
    priority: bug.priority,
    labels: bug.labels,
    assignee_id: bug.assigneeId,
    steps_to_reproduce: truncateText(bug.stepsToReproduce, DEFAULT_BUDGET.textFieldMax).value,
    steps_to_reproduce_truncated: truncateText(bug.stepsToReproduce, DEFAULT_BUDGET.textFieldMax).truncated,
    expected_result: truncateText(bug.expectedResult, DEFAULT_BUDGET.textFieldMax).value,
    expected_result_truncated: truncateText(bug.expectedResult, DEFAULT_BUDGET.textFieldMax).truncated,
    actual_result: truncateText(bug.actualResult, DEFAULT_BUDGET.textFieldMax).value,
    actual_result_truncated: truncateText(bug.actualResult, DEFAULT_BUDGET.textFieldMax).truncated,
    severity: bug.severity,
    status: bug.status,
    ...bugNextStep(bug.status),
    resolution_notes: bug.resolutionNotes,
    git_commit_hash: bug.gitCommitHash,
    created_by: bug.createdBy,
    created_at: bug.createdAt.toISOString(),
    updated_at: bug.updatedAt.toISOString(),
    attachments,
    tip: '长字段已按 500 字符截断；完整内容请用 read_attachment_text 或让提交者补充',
  };
}

/** 4. read_attachment_text —— 分片/范围读取文本与日志附件 */
export async function readAttachmentText(input: {
  attachment_id: string;
  offset_line?: number;
  limit_lines?: number;
  grep_keyword?: string;
}) {
  const { attachment, filePath } = await resolveLocalAttachment(input.attachment_id);
  if (!isTextFile(attachment.fileName, attachment.fileType)) {
    throw new AppError(
      `附件不是文本类型: ${attachment.fileName}（${attachment.fileType}）。图片请使用 inspect_image_asset`,
      400,
      'NOT_TEXT',
    );
  }
  const slice = await readTextSlice(filePath, {
    offsetLine: input.offset_line,
    limitLines: input.limit_lines,
    grepKeyword: input.grep_keyword,
  });
  return {
    attachment_id: attachment.id,
    file_name: attachment.fileName,
    file_type: attachment.fileType,
    content: slice.content,
    total_lines: slice.totalLines,
    returned_lines: slice.returnedLines,
    has_more: slice.hasMore,
    next_offset_line: slice.nextOffsetLine,
    grep_keyword: slice.grepKeyword,
  };
}

/** 5. inspect_image_asset —— 提取图像资产供多模态模型消费 */
export async function inspectImageAssetTool(input: {
  attachment_id: string;
  target_max_dimension?: number;
  return_mode?: 'path' | 'base64';
}) {
  const { attachment, filePath } = await resolveLocalAttachment(input.attachment_id);
  if (!attachment.fileType.startsWith('image/')) {
    throw new AppError(`附件不是图片: ${attachment.fileName}`, 400, 'NOT_IMAGE');
  }

  const info = await inspectImageAsset(filePath, attachment.id, {
    targetMaxDimension: input.target_max_dimension ?? 1080,
  });

  const result: Record<string, unknown> = {
    attachment_id: attachment.id,
    file_name: attachment.fileName,
    mime_type: info.mimeType,
    width: info.width,
    height: info.height,
    original_width: info.originalWidth,
    original_height: info.originalHeight,
    downscaled: info.downscaled,
    byte_size: info.byteSize,
    file_path: info.filePath,
  };
  const returnMode = input.return_mode ?? 'path';
  if (returnMode === 'base64') {
    const buffer = await fsp.readFile(info.filePath);
    if (buffer.byteLength > MAX_BASE64_BYTES) {
      throw new AppError(
        `图片过大（${buffer.byteLength} 字节 > ${MAX_BASE64_BYTES}），请降低 target_max_dimension`,
        413,
        'TOO_LARGE',
      );
    }
    result.base64 = buffer.toString('base64');
  }

  return result;
}

/** 6. update_bug_status —— AI 修复完成后标记状态与回填提交 */
export async function updateBugStatus(
  input: {
    bug_id: string;
    status: string;
    resolution_notes?: string;
    commit_hash?: string;
    reopen_reason?: string;
  },
  actor?: { type: 'ai'; id?: string | null },
) {
  const bug = await bugsService.updateBug(input.bug_id, {
    status: input.status,
    resolutionNotes: input.resolution_notes,
    gitCommitHash: input.commit_hash,
    reopenReason: input.reopen_reason,
    actor,
  });
  return {
    ok: true,
    bug: {
      id: bug.id,
      title: bug.title,
      status: bug.status,
      severity: bug.severity,
      resolution_notes: bug.resolutionNotes,
      git_commit_hash: bug.gitCommitHash,
      updated_at: bug.updatedAt.toISOString(),
    },
    ...bugNextStep(bug.status),
  };
}

/** 7. append_scratchpad —— AI 暂存临时想法或设计草案 */
export async function appendScratchpad(input: {
  content: string;
  project_slug?: string;
  tags?: string[];
}) {
  let projectId: string | null = null;
  if (input.project_slug) {
    const project = await projectsService.resolveProject(input.project_slug);
    projectId = project.id;
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
