import type { FastifyPluginAsync } from 'fastify';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import sharp from 'sharp';
import * as attachmentsService from '../services/attachments.js';
import { randomIdAttachment } from '../core/ids.js';
import { serializeAttachment } from '../core/serialize.js';
import { storage } from '../services/storage.js';
import { isTextFile, readTextSlice, inspectImageAsset } from '../services/assets.js';
import { ValidationError, PayloadTooLargeError } from '../core/errors.js';
import { verifyAssetSignature } from '../core/asset-sign.js';
import { config } from '../config.js';
import { WRITER_ROLES } from '../plugins/authenticate.js';

export const attachmentRoutes: FastifyPluginAsync = async (fastify) => {
  // 写操作限 owner/admin/member：viewer（只读）只能看（功能巡检 B2）
  const canWrite = { preHandler: [fastify.requireRole(...WRITER_ROLES)] };

  // GET /api/attachments?project_id=&entity_type=&entity_id=&q=&mine=true
  fastify.get('/', async (request) => {
    const q = request.query as Record<string, string>;
    const items = await attachmentsService.listAttachments({
      projectId: q.project_id,
      entityType: q.entity_type,
      entityId: q.entity_id,
      q: q.q,
      limit: q.limit ? Number(q.limit) : undefined,
      // mine=true 时只回当前用户上传的（我的文件）
      mine: q.mine === 'true' ? request.user?.id : undefined,
    });
    return items.map(serializeAttachment);
  });

  // GET /api/attachments/:attachmentId —— 元数据
  fastify.get('/:attachmentId', async (request) => {
    const { attachmentId } = request.params as { attachmentId: string };
    const attachment = await attachmentsService.getAttachment(attachmentId);
    return serializeAttachment(attachment);
  });

  // GET /:attachmentId/raw 见下方 attachmentRawRoutes（不挂登录守卫，签名或 Bearer 二选一）

  /**
   * GET /api/attachments/:attachmentId/text?offset_line=&limit_lines=&grep_keyword=
   * 文本/日志分片读取（Web 端在线查看，防上下文爆炸）。
   */
  fastify.get('/:attachmentId/text', async (request) => {
    const { attachmentId } = request.params as { attachmentId: string };
    const q = request.query as Record<string, string>;
    const { attachment, filePath } = await attachmentsService.resolveLocalAttachment(attachmentId);
    if (!isTextFile(attachment.fileName, attachment.fileType)) {
      throw new ValidationError(`非文本类附件: ${attachment.fileName}（${attachment.fileType}）`);
    }
    const slice = await readTextSlice(filePath, {
      offsetLine: q.offset_line ? Number(q.offset_line) : undefined,
      limitLines: q.limit_lines ? Number(q.limit_lines) : undefined,
      grepKeyword: q.grep_keyword,
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
  });

  /**
   * GET /api/attachments/:attachmentId/image?target_max_dimension=1080
   * 图片降采样信息（Web 端可直接用 raw 或派生图）。
   */
  fastify.get('/:attachmentId/image', async (request) => {
    const { attachmentId } = request.params as { attachmentId: string };
    const q = request.query as Record<string, string>;
    const { attachment, filePath } = await attachmentsService.resolveLocalAttachment(attachmentId);
    if (!attachment.fileType.startsWith('image/')) {
      throw new ValidationError(`非图片附件: ${attachment.fileName}`);
    }
    const info = await inspectImageAsset(filePath, attachmentId, {
      targetMaxDimension: q.target_max_dimension ? Number(q.target_max_dimension) : undefined,
    });
    return {
      attachment_id: attachment.id,
      file_name: attachment.fileName,
      file_path: info.filePath,
      width: info.width,
      height: info.height,
      format: info.format,
      downscaled: info.downscaled,
      original_width: info.originalWidth,
      original_height: info.originalHeight,
      mime_type: info.mimeType,
      byte_size: info.byteSize,
      /** 降采样后文件的本服务访问地址 */
      url: `/api/attachments/${attachmentId}/image-file?max=${info.width}x${info.height}`,
    };
  });

  /** 派生降采样图片文件输出 */
  fastify.get('/:attachmentId/image-file', async (request, reply) => {
    const { attachmentId } = request.params as { attachmentId: string };
    const q = request.query as Record<string, string>;
    const { attachment, filePath } = await attachmentsService.resolveLocalAttachment(attachmentId);
    const max = q.max ? Number(q.max.split('x')[0]) : 1080;
    const info = await inspectImageAsset(filePath, attachmentId, { targetMaxDimension: max });
    const buffer = await fsp.readFile(info.filePath);
    return reply
      .header('Content-Type', info.mimeType)
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .send(buffer);
  });

  // DELETE /api/attachments/:attachmentId
  fastify.delete('/:attachmentId', canWrite, async (request, reply) => {
    const { attachmentId } = request.params as { attachmentId: string };
    await attachmentsService.deleteAttachment(attachmentId);
    reply.code(204);
    return null;
  });
};

/** 仅这些类型允许在浏览器内 inline 展示；其余（html/svg/xml/js/pdf…）一律强制下载 */
const INLINE_SAFE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'text/plain',
]);

/** 用户上传内容的 CSP：禁一切子资源 + sandbox（不透明源、禁脚本），即使被直接打开也碰不到应用同源 */
const USER_CONTENT_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/** RFC 6266/5987：ASCII 兜底名 + UTF-8 编码名（中文文件名下载不乱码） */
function contentDisposition(type: 'inline' | 'attachment', fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * GET /api/attachments/:attachmentId/raw —— 原文件下发（R76）。
 * 不挂全局登录守卫：<img>、新标签页带不了 Authorization 头，改为「签名链接 或 Bearer」二选一
 * （public_url 由 serialize 签发 exp+sig，见 core/asset-sign.ts）。
 * 上传方提供的 MIME 不可信：统一 nosniff + CSP sandbox，仅白名单类型 inline，
 * 防止 .html/.svg 在应用同源执行脚本、读走 localStorage 里的令牌。
 */
export const attachmentRawRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/:attachmentId/raw', async (request, reply) => {
    const { attachmentId } = request.params as { attachmentId: string };
    const { exp, sig } = request.query as { exp?: string; sig?: string };
    if (!verifyAssetSignature(attachmentId, exp, sig)) {
      await fastify.authenticate(request, reply);
    }
    const { attachment, filePath } = await attachmentsService.resolveLocalAttachment(attachmentId);
    const disposition = INLINE_SAFE_TYPES.has(attachment.fileType) ? 'inline' : 'attachment';
    return reply
      .header('Content-Type', attachment.fileType)
      .header('Content-Length', String(attachment.fileSize))
      .header('Content-Disposition', contentDisposition(disposition, attachment.fileName))
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', USER_CONTENT_CSP)
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .send(await fsp.readFile(filePath));
  });
};

/** 上传路由：挂载于 /api/upload（设计文档第 5 节 Web 端交互流程） */
export const uploadRoutes: FastifyPluginAsync = async (fastify) => {
  const canWrite = { preHandler: [fastify.requireRole(...WRITER_ROLES)] };

  /**
   * POST /api/upload
   * multipart 表单：files[] + project_id + entity_type(选填, 默认 general) + entity_id(选填)
   * 返回附件元数据数组（含 attachment_id 与 public_url），前端拿到后即可预览缩略图。
   */
  fastify.post('/', canWrite, async (request, reply) => {
    // parts() 同时 yield 字段与文件（files() 只会 yield 文件）。
    // TS 类型为 Multipart = MultipartFile | MultipartValue，此处收敛为本路由使用的形态。
    const parts = request.parts({
      limits: {
        fileSize: config.maxUploadBytes,
        files: config.maxUploadFiles,
      },
    }) as unknown as AsyncIterableIterator<
      | { type: 'file'; filename: string; mimetype: string; file: import('stream').Readable }
      | { type: 'field'; fieldname: string; value: unknown }
    >;

    // 两段式处理：multipart part 到达顺序客户端不保证（文件可能先于 project_id 字段），
    // 故遍历时只落盘 + 收集元信息，循环结束后（字段已齐）才建附件记录（卡片 30 实测 bug 修复）。
    const pending: {
      attId: string;
      targetPath: string;
      fileName: string;
      fileType: string;
      fileSize: number;
      width: number | null;
      height: number | null;
    }[] = [];
    let projectId = '';
    let entityType = 'general';
    let entityId: string | null = null;

    for await (const part of parts) {
      if (part.type === 'file') {
        const attId = randomIdAttachment();
        const ext = path.extname(part.filename) || '.bin';
        const targetPath = storage.resolvePath(attId, ext.replace(/^\./, ''));

        await fsp.mkdir(path.dirname(targetPath), { recursive: true });
        await pipeline(part.file, createWriteStream(targetPath));

        let width: number | null = null;
        let height: number | null = null;
        if (part.mimetype.startsWith('image/')) {
          try {
            const meta = await sharp(targetPath).metadata();
            width = meta.width ?? null;
            height = meta.height ?? null;
          } catch {
            // 非有效图片则跳过尺寸提取
          }
        }

        const stat = await fsp.stat(targetPath);
        pending.push({
          attId,
          targetPath,
          fileName: part.filename || 'clipboard.png',
          fileType: part.mimetype || 'application/octet-stream',
          fileSize: stat.size,
          width,
          height,
        });
      } else {
        // 普通字段
        const value = String(part.value ?? '');
        if (part.fieldname === 'project_id') projectId = value;
        if (part.fieldname === 'entity_type') entityType = value || 'general';
        if (part.fieldname === 'entity_id') entityId = value || null;
      }
    }

    if (!pending.length) throw new ValidationError('未收到任何文件');
    if (!projectId) throw new ValidationError('缺少 project_id 字段');

    const created = [];
    for (const p of pending) {
      const attachment = await attachmentsService.createAttachment({
        id: p.attId,
        projectId,
        entityType,
        entityId,
        fileName: p.fileName,
        fileType: p.fileType,
        fileSize: p.fileSize,
        storagePath: p.targetPath,
        publicUrl: storage.publicUrl(p.attId),
        width: p.width,
        height: p.height,
        uploadedBy: request.user?.id ?? null,
      });
      created.push(serializeAttachment(attachment));
    }

    reply.code(201);
    return { attachments: created };
  });

  /**
   * POST /api/upload/base64
   * 剪贴板图片兜底通道：前端将 clipboard item 转为 base64 后提交。
   */
  fastify.post('/base64', canWrite, async (request, reply) => {
    const body = request.body as {
      project_id?: string;
      file_name?: string;
      file_type?: string;
      data_base64?: string;
      entity_type?: string;
      entity_id?: string | null;
    };
    if (!body?.project_id) throw new ValidationError('project_id 不能为空');
    if (!body?.data_base64) throw new ValidationError('data_base64 不能为空');

    const buffer = Buffer.from(body.data_base64, 'base64');
    if (buffer.byteLength > config.maxUploadBytes) {
      throw new PayloadTooLargeError(`文件超过 ${config.maxUploadBytes} 字节限制`);
    }

    const attId = randomIdAttachment();
    const ext = path.extname(body.file_name ?? '') || '.png';
    const stored = await storage.writeBuffer(buffer, attId, ext.replace(/^\./, ''));

    let width: number | null = null;
    let height: number | null = null;
    if ((body.file_type ?? '').startsWith('image/')) {
      try {
        const meta = await sharp(stored.storagePath).metadata();
        width = meta.width ?? null;
        height = meta.height ?? null;
      } catch {
        // ignore
      }
    }

    const attachment = await attachmentsService.createAttachment({
      id: attId,
      projectId: body.project_id,
      entityType: body.entity_type ?? 'general',
      entityId: body.entity_id ?? null,
      fileName: body.file_name ?? 'clipboard.png',
      fileType: body.file_type ?? 'image/png',
      fileSize: buffer.byteLength,
      storagePath: stored.storagePath,
      publicUrl: stored.publicUrl,
      width,
      height,
      uploadedBy: request.user?.id ?? null,
    });
    reply.code(201);
    return serializeAttachment(attachment);
  });

};
