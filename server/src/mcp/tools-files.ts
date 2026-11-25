import fsp from 'node:fs/promises';
import sharp from 'sharp';
import { config } from '../config.js';
import { AppError, PayloadTooLargeError, ValidationError } from '../core/errors.js';
import { guessMimeType } from '../core/mime.js';
import { signUploadGrant, UPLOAD_GRANT_TTL_SEC } from '../core/upload-grant.js';
import { inspectImageAsset, isTextFile, readTextSlice } from '../services/assets.js';
import * as attachmentsService from '../services/attachments.js';
import { resolveLocalAttachment } from '../services/attachments.js';
import * as bugsService from '../services/bugs.js';
import * as projectsService from '../services/projects.js';
import * as tasksService from '../services/tasks.js';
import type { McpContext } from './context.js';
import { mcpStore } from './context-store.js';
import { ToolContent } from './guard.js';
import { resolveWorkEntityType } from './tools-work.js';

/**
 * 附件读写二合一工具（R96）：
 * 6. read_attachment（按 MIME 自动分流：image/* 返回降采样视觉图片块，文本返回行号分片与 grep）
 * 7. upload_attachment（传 content/data_base64 直接落盘；两者都不传则签发一次性 curl -T 本地直传链接）
 */

const MAX_BASE64_BYTES = 4 * 1024 * 1024;
const IMAGE_BLOCK_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** 6. read_attachment —— 自动识别截图与文本日志 */
export async function readAttachment(
  _ctx: McpContext,
  input: {
    attachment_id: string;
    offset_line?: number;
    limit_lines?: number;
    grep_keyword?: string;
    target_max_dimension?: number;
    return_mode?: 'image' | 'path' | 'base64';
  },
): Promise<Record<string, unknown> | ToolContent> {
  const { attachment, filePath } = await resolveLocalAttachment(input.attachment_id);

  if (attachment.fileType.startsWith('image/')) {
    const info = await inspectImageAsset(filePath, attachment.id, {
      targetMaxDimension: input.target_max_dimension ?? 1080,
    });
    const meta: Record<string, unknown> = {
      attachment_id: attachment.id,
      file_name: attachment.fileName,
      mime_type: info.mimeType,
      width: info.width,
      height: info.height,
      original_width: info.originalWidth,
      original_height: info.originalHeight,
      downscaled: info.downscaled,
      byte_size: info.byteSize,
    };
    const returnMode = input.return_mode ?? 'image';
    if (returnMode === 'path') return { ...meta, file_path: info.filePath };

    const buffer = await fsp.readFile(info.filePath);
    if (buffer.byteLength > MAX_BASE64_BYTES) {
      throw new AppError(
        `图片过大（${buffer.byteLength} 字节 > ${MAX_BASE64_BYTES}），请降低 target_max_dimension`,
        413,
        'PAYLOAD_TOO_LARGE',
      );
    }
    if (returnMode === 'base64') return { ...meta, file_path: info.filePath, base64: buffer.toString('base64') };

    const image = IMAGE_BLOCK_TYPES.has(info.mimeType)
      ? { data: buffer, mimeType: info.mimeType }
      : { data: await sharp(buffer).png().toBuffer(), mimeType: 'image/png' };
    return new ToolContent([
      { type: 'text', text: JSON.stringify({ ...meta, mime_type: image.mimeType }, null, 2) },
      { type: 'image', data: image.data.toString('base64'), mimeType: image.mimeType },
    ]);
  }

  if (isTextFile(attachment.fileName, attachment.fileType)) {
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

  throw new AppError(
    `附件既不是图片也不是纯文本（${attachment.fileName}, ${attachment.fileType}），请在 Web 端下载查看`,
    400,
    'BAD_REQUEST',
  );
}

async function resolveUploadTarget(workItemId: string | undefined, projectSlug: string | undefined) {
  const targetId = workItemId?.trim();
  if (targetId) {
    if (targetId.startsWith('bug_')) {
      const bug = await bugsService.getBug(targetId);
      return { projectId: bug.projectId, entityType: 'bug' as const, entityId: bug.id };
    }
    if (targetId.startsWith('tsk_')) {
      const task = await tasksService.getTask(targetId);
      return { projectId: task.projectId, entityType: 'task' as const, entityId: task.id };
    }
    const kind = await resolveWorkEntityType(targetId);
    if (kind === 'bug') {
      const bug = await bugsService.getBug(targetId);
      return { projectId: bug.projectId, entityType: 'bug' as const, entityId: bug.id };
    }
    const task = await tasksService.getTask(targetId);
    return { projectId: task.projectId, entityType: 'task' as const, entityId: task.id };
  }
  const project = await projectsService.resolveProject(projectSlug);
  return { projectId: project.id, entityType: 'general' as const, entityId: null };
}

/** 7. upload_attachment —— 传 content 直存文本；不传 content 自动签发一次性 curl -T 上传链接 */
export async function uploadAttachment(
  ctx: McpContext,
  input: {
    file_name: string;
    file_type?: string;
    work_item_id?: string;
    bug_id?: string;
    project_slug?: string;
    content?: string;
    data_base64?: string;
  },
) {
  const fileName = input.file_name?.trim();
  if (!fileName) throw new ValidationError('file_name 不能为空（带扩展名，如 screenshot.png、app.log）');

  const hasText = typeof input.content === 'string';
  const hasB64 = typeof input.data_base64 === 'string';
  if (hasText && hasB64) {
    throw new ValidationError('content 与 data_base64 只能传其中一个；上传本地文件请两者都不传以获取 curl 直传链接');
  }

  const target = await resolveUploadTarget(input.work_item_id ?? input.bug_id, input.project_slug);

  if (!hasText && !hasB64) {
    const token = signUploadGrant({
      ...target,
      fileName,
      fileType: input.file_type?.trim() || guessMimeType(fileName),
      uploadedBy: ctx.apiKeyId ?? ctx.actorLabel,
      apiKeyId: ctx.apiKeyId,
    });
    const uploadUrl = `${mcpStore.origin() ?? `http://127.0.0.1:${config.port}`}/api/uploads?token=${token}`;
    return {
      ok: true,
      mode: 'upload_url' as const,
      upload_url: uploadUrl,
      method: 'PUT' as const,
      expires_in_sec: UPLOAD_GRANT_TTL_SEC,
      curl: `curl -sS -T '<本地文件路径>' '${uploadUrl}'`,
      next_step:
        '在终端执行 curl（把 <本地文件路径> 换成实际路径）；返回 JSON 里的 attachment.id 即附件 ID。链接 10 分钟内有效、只能用一次。',
    };
  }

  const buffer = hasText ? Buffer.from(input.content as string, 'utf8') : Buffer.from(input.data_base64 as string, 'base64');
  if (buffer.byteLength > config.maxUploadBytes) {
    throw new PayloadTooLargeError(`文件超过 ${config.maxUploadBytes} 字节限制`);
  }
  const attachment = await attachmentsService.uploadFromBuffer({
    ...target,
    fileName,
    fileType: input.file_type?.trim() || guessMimeType(fileName, hasText ? 'text/plain' : 'application/octet-stream'),
    buffer,
    uploadedBy: ctx.apiKeyId ?? ctx.actorLabel,
  });
  return {
    ok: true,
    mode: 'direct' as const,
    attachment: {
      id: attachment.id,
      file_name: attachment.fileName,
      file_type: attachment.fileType,
      file_size: attachment.fileSize,
      work_item_id: target.entityId,
      bug_id: target.entityType === 'bug' ? target.entityId : null,
    },
  };
}
