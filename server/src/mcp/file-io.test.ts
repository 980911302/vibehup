import fsp from 'node:fs/promises';
import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { buildServer } from '../index.js';
import { prisma } from '../core/prisma.js';
import { resetDb, createApiKey } from '../test-helpers.js';
import * as projectsService from '../services/projects.js';
import * as bugsService from '../services/bugs.js';
import * as attachmentsService from '../services/attachments.js';
import { storage } from '../services/storage.js';
import { randomIdAttachment } from '../core/ids.js';
import { readTextSlice } from '../services/assets.js';
import { revokeKey } from '../services/api-keys.js';
import { signUploadGrant } from '../core/upload-grant.js';
import * as ext from './tools-extended.js';
import * as mcpTools from './tools.js';
import { guarded } from './guard.js';
import { loadKeyedContext, type McpContext } from './context.js';
import { mcpStore } from './context-store.js';

/**
 * MCP 文件收发对 AI 友好（R84，试用反馈）：
 * ① upload_attachment 只收 base64——AI 得把整个文件「手写」成 base64 塞进参数（膨胀 1/3、慢、易错），
 *   连纯文本日志也不例外；
 * ② 本地文件（图片/二进制/大文件）没有不经过对话的通道；
 * ③ inspect_image_asset 默认返回服务端路径（容器部署时 IDE 打不开），base64 又塞在 JSON 文本里，
 *   模型「看」不到截图。
 */

const localCtx: McpContext = {
  mode: 'local',
  apiKeyId: null,
  scopes: new Set(['attachment:write', 'attachment:read']),
  actorLabel: 'local',
};

let app: FastifyInstance;

beforeEach(async () => {
  await resetDb();
  delete process.env.VIBEHUB_API_KEY;
  app = await buildServer();
  await app.ready();
});

async function pngAttachment(projectId: string, width = 2000) {
  const png = await storage.writeBuffer(
    await sharp({ create: { width, height: width / 2, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer(),
    randomIdAttachment(),
    'png',
  );
  return attachmentsService.createAttachment({
    projectId,
    entityType: 'general',
    fileName: 'shot.png',
    fileType: 'image/png',
    fileSize: 100,
    storagePath: png.storagePath,
  });
}

describe('upload_attachment：文本直接传，不用 base64', () => {
  it('content 传原文 → 存为文本附件，类型按扩展名推断', async () => {
    await projectsService.createProject({ name: '文本上传' });
    const r = await ext.uploadAttachment(localCtx, { file_name: 'app.log', content: 'boot ok\nERROR NullPointerException at Foo.bar' });
    const att = await prisma.attachment.findUniqueOrThrow({ where: { id: r.attachment.id } });
    expect(att.fileType).toBe('text/plain');
    expect(att.fileSize).toBe(Buffer.byteLength('boot ok\nERROR NullPointerException at Foo.bar'));
    const slice = await readTextSlice(att.storagePath, { grepKeyword: 'ERROR' });
    expect(slice.content).toContain('NullPointerException');
  });

  it('content 与 data_base64 都不给 → 人话报错，并指路 create_upload_url', async () => {
    await projectsService.createProject({ name: '空上传' });
    await expect(ext.uploadAttachment(localCtx, { file_name: 'a.bin' })).rejects.toThrow('create_upload_url');
  });

  it('给了 bug_id 就挂到该缺陷所在项目（多项目也不必再传 project_slug）', async () => {
    await projectsService.createProject({ name: '项目甲' });
    const b = await projectsService.createProject({ name: '项目乙' });
    const bug = await bugsService.createBug({ projectId: b.id, title: '乙的缺陷' });
    const r = await ext.uploadAttachment(localCtx, { bug_id: bug.id, file_name: 'trace.txt', content: 'stack' });
    const att = await prisma.attachment.findUniqueOrThrow({ where: { id: r.attachment.id } });
    expect(att.projectId).toBe(b.id);
    expect(att.entityType).toBe('bug');
    expect(att.entityId).toBe(bug.id);
  });

  it('bug_id 不存在 → 报错，不留下指向空缺陷的附件', async () => {
    await projectsService.createProject({ name: '孤儿' });
    await expect(ext.uploadAttachment(localCtx, { bug_id: 'bug_nope', file_name: 'a.txt', content: 'x' })).rejects.toThrow('缺陷不存在');
    expect(await prisma.attachment.count()).toBe(0);
  });
});

describe('create_upload_url：本地文件用 curl 直传，内容不经过对话', () => {
  async function keyedCtx() {
    const key = await createApiKey({ scopes: ['attachment:write'] });
    return { key, ctx: await loadKeyedContext(key.key) };
  }

  it('返回上传链接与 curl 命令；SSE 会话用握手时的地址', async () => {
    await projectsService.createProject({ name: '链接' });
    const { ctx } = await keyedCtx();
    const r = await mcpStore.run(ctx, () => ext.createUploadUrl(ctx, { file_name: 'screen.png' }), { origin: 'http://192.168.0.105:3210' });
    expect(r.upload_url.startsWith('http://192.168.0.105:3210/api/uploads?token=')).toBe(true);
    expect(r.method).toBe('PUT');
    expect(r.curl).toContain('curl');
    expect(r.curl).toContain('-T');
    expect(r.curl).toContain(r.upload_url);
    expect(r.expires_in_sec).toBe(600);
  });

  it('PUT 原始字节即上传成功：挂到缺陷、字节一致、归属密钥；同一链接只能用一次', async () => {
    const p = await projectsService.createProject({ name: '直传' });
    const bug = await bugsService.createBug({ projectId: p.id, title: '要截图的缺陷' });
    const { key, ctx } = await keyedCtx();
    const r = await ext.createUploadUrl(ctx, { file_name: 'screen.png', bug_id: bug.id });
    const bytes = await sharp({ create: { width: 64, height: 32, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    const u = new URL(r.upload_url);
    const url = u.pathname + u.search;

    const put = await app.inject({ method: 'PUT', url, payload: bytes });
    expect(put.statusCode).toBe(201);
    const att = await prisma.attachment.findUniqueOrThrow({ where: { id: put.json().attachment.id } });
    expect(att.entityType).toBe('bug');
    expect(att.entityId).toBe(bug.id);
    expect(att.fileType).toBe('image/png');
    expect(att.uploadedBy).toBe(key.id);
    expect((await fsp.readFile(att.storagePath)).equals(bytes)).toBe(true);

    const again = await app.inject({ method: 'PUT', url, payload: bytes });
    expect(again.statusCode).toBe(401);
    expect(await prisma.attachment.count()).toBe(1);
  });

  it('链接被篡改 / 已过期 → 401', async () => {
    const p = await projectsService.createProject({ name: '篡改' });
    const { ctx } = await keyedCtx();
    const r = await ext.createUploadUrl(ctx, { file_name: 'a.txt' });
    const u = new URL(r.upload_url);
    const tampered = await app.inject({ method: 'PUT', url: `${u.pathname}${u.search}x`, payload: 'x' });
    expect(tampered.statusCode).toBe(401);

    const expired = signUploadGrant(
      { projectId: p.id, entityType: 'general', entityId: null, fileName: 'a.txt', fileType: 'text/plain', uploadedBy: null, apiKeyId: null },
      Date.now() - 3600_000,
    );
    const late = await app.inject({ method: 'PUT', url: `/api/uploads?token=${expired}`, payload: 'x' });
    expect(late.statusCode).toBe(401);
    expect(await prisma.attachment.count()).toBe(0);
  });

  it('申请链接后密钥被撤销 → 链接随之失效', async () => {
    await projectsService.createProject({ name: '撤销' });
    const { key, ctx } = await keyedCtx();
    const r = await ext.createUploadUrl(ctx, { file_name: 'a.txt' });
    await revokeKey(key.id);
    const u = new URL(r.upload_url);
    const put = await app.inject({ method: 'PUT', url: u.pathname + u.search, payload: 'x' });
    expect(put.statusCode).toBe(401);
  });
});

describe('inspect_image_asset：模型能直接看到截图', () => {
  it('默认返回 MCP 图片内容（降采样到 1080），元信息不再带服务端路径', async () => {
    const p = await projectsService.createProject({ name: '看图' });
    const att = await pngAttachment(p.id);
    const handler = guarded('inspect_image_asset', 'attachment:read', (_ctx, args) =>
      mcpTools.inspectImageAssetTool(args as { attachment_id: string }),
    );
    const res = await handler({ attachment_id: att.id });
    expect(res.isError).toBeFalsy();
    const image = res.content.find((c) => c.type === 'image') as { data: string; mimeType: string } | undefined;
    expect(image?.mimeType).toBe('image/png');
    const meta = await sharp(Buffer.from(image!.data, 'base64')).metadata();
    expect(meta.width).toBe(1080);
    const text = res.content.find((c) => c.type === 'text') as { text: string };
    expect(JSON.parse(text.text).width).toBe(1080);
    expect(text.text).not.toContain('file_path');
  });

  it('path 模式仍可显式使用（与服务同机的 stdio 场景）', async () => {
    const p = await projectsService.createProject({ name: '路径' });
    const att = await pngAttachment(p.id, 400);
    const r = (await mcpTools.inspectImageAssetTool({ attachment_id: att.id, return_mode: 'path' })) as { file_path: string };
    expect(typeof r.file_path).toBe('string');
  });
});
