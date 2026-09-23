import type { Attachment, Prisma } from '@prisma/client';
import path from 'node:path';
import sharp from 'sharp';
import { prisma } from '../core/prisma.js';
import { ids } from '../core/ids.js';
import { eventBus } from '../core/events.js';
import { NotFoundError, ValidationError } from '../core/errors.js';
import { storage } from './storage.js';
import { buildSearchIndex, matchIndex } from '../core/search.js';

export const ENTITY_TYPES = ['bug', 'task', 'note', 'general'] as const;

export interface CreateAttachmentInput {
  projectId: string;
  entityType: string;
  entityId?: string | null;
  fileName: string;
  fileType: string;
  fileSize: number;
  storageType?: string;
  storagePath: string;
  publicUrl?: string | null;
  width?: number | null;
  height?: number | null;
  /** 上传者：用户 ID 或 MCP 密钥 ID（我的文件过滤 / AI 产物标识） */
  uploadedBy?: string | null;
}

export async function createAttachment(input: CreateAttachmentInput): Promise<Attachment> {
  if (!ENTITY_TYPES.includes(input.entityType as never)) {
    throw new ValidationError(`entity_type 必须是 ${ENTITY_TYPES.join(' | ')} 之一`);
  }
  const id = ids.attachment();
  const attachment = await prisma.attachment.create({
    data: {
      id,
      projectId: input.projectId,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      fileName: input.fileName,
      fileType: input.fileType,
      fileSize: input.fileSize,
      storageType: input.storageType ?? 'local',
      storagePath: input.storagePath,
      publicUrl: input.publicUrl ?? storage.publicUrl(id),
      width: input.width ?? null,
      height: input.height ?? null,
      uploadedBy: input.uploadedBy ?? null,
    },
  });
  eventBus.publish({
    type: 'attachment.created',
    projectId: attachment.projectId,
    attachmentId: attachment.id,
  });
  return attachment;
}

export async function getAttachment(attachmentId: string): Promise<Attachment> {
  const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  if (!attachment) throw new NotFoundError(`附件不存在: ${attachmentId}`);
  return attachment;
}

/** 获取附件并校验物理文件存在，返回可读的本地路径 */
export async function resolveLocalAttachment(attachmentId: string): Promise<{ attachment: Attachment; filePath: string }> {
  const attachment = await getAttachment(attachmentId);
  if (!storage.exists(attachment.storagePath)) {
    throw new NotFoundError(`附件物理文件缺失: ${attachment.storagePath}`);
  }
  return { attachment, filePath: attachment.storagePath };
}

export async function listAttachments(query: {
  projectId?: string;
  entityType?: string;
  entityId?: string;
  q?: string;
  limit?: number;
  /** 我的文件：上传者 = 该 ID（用户或密钥） */
  mine?: string;
} = {}): Promise<Attachment[]> {
  const where: Prisma.AttachmentWhereInput = {};
  if (query.projectId) where.projectId = query.projectId;
  if (query.entityType) where.entityType = query.entityType;
  if (query.entityId) where.entityId = query.entityId;
  if (query.mine) where.uploadedBy = query.mine;

  let items = await prisma.attachment.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  if (query.q?.trim()) {
    const q = query.q.trim();
    items = items.filter((a) => matchIndex(q, buildSearchIndex(a.fileName)));
  }
  return items.slice(0, query.limit ?? 200);
}

export async function countAttachments(entityType: string, entityId: string): Promise<number> {
  return prisma.attachment.count({ where: { entityType, entityId } });
}

/** 将附件关联到实体（如上传后回填 bug_id） */
export async function linkAttachment(
  attachmentId: string,
  entityType: string,
  entityId: string,
): Promise<Attachment> {
  if (!ENTITY_TYPES.includes(entityType as never)) {
    throw new ValidationError(`entity_type 必须是 ${ENTITY_TYPES.join(' | ')} 之一`);
  }
  return prisma.attachment.update({
    where: { id: attachmentId },
    data: { entityType, entityId },
  });
}

/** 批量关联（上传时先挂 general，实体创建后回填） */
export async function linkMany(
  attachmentIds: string[],
  entityType: string,
  entityId: string,
): Promise<void> {
  if (!ENTITY_TYPES.includes(entityType as never)) {
    throw new ValidationError(`entity_type 必须是 ${ENTITY_TYPES.join(' | ')} 之一`);
  }
  await prisma.attachment.updateMany({
    where: { id: { in: attachmentIds }, entityType: 'general' },
    data: { entityType, entityId },
  });
}

/**
 * 从 Buffer 上传附件（MCP upload_attachment：AI 把日志/截图贴回工单）。
 * uploadedBy 传 API Key ID，标记 AI 产物。
 */
export async function uploadFromBuffer(input: {
  projectId: string;
  entityType?: string;
  entityId?: string | null;
  fileName: string;
  fileType: string;
  buffer: Buffer;
  uploadedBy?: string | null;
}): Promise<Attachment> {
  const ext = path.extname(input.fileName) || '.bin';
  const attId = ids.attachment();
  const stored = await storage.writeBuffer(input.buffer, attId, ext.replace(/^\./, ''));

  let width: number | null = null;
  let height: number | null = null;
  if (input.fileType.startsWith('image/')) {
    try {
      const meta = await sharp(stored.storagePath).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
    } catch {
      // 非有效图片跳过尺寸提取
    }
  }

  return createAttachment({
    projectId: input.projectId,
    entityType: input.entityType ?? 'general',
    entityId: input.entityId ?? null,
    fileName: input.fileName,
    fileType: input.fileType,
    fileSize: input.buffer.byteLength,
    storagePath: stored.storagePath,
    publicUrl: stored.publicUrl,
    width,
    height,
    uploadedBy: input.uploadedBy ?? null,
  });
}

/** 删除附件元数据与物理文件 */
export async function deleteAttachment(attachmentId: string): Promise<void> {
  const attachment = await getAttachment(attachmentId);
  await storage.delete(attachment.storagePath);
  await prisma.attachment.delete({ where: { id: attachmentId } });
  eventBus.publish({
    type: 'attachment.deleted',
    projectId: attachment.projectId,
    attachmentId: attachment.id,
  });
}
