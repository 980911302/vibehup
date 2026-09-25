import path from 'node:path';
import fs from 'node:fs/promises';
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../core/prisma.js';
import { resetDb, createUser, createApiKey } from '../test-helpers.js';
import * as projectsService from './projects.js';
import * as bugsService from './bugs.js';
import * as tasksService from './tasks.js';
import * as notesService from './notes.js';
import * as attachmentsService from './attachments.js';
import { storage } from './storage.js';
import { paths, config } from '../config.js';
import { readTextSlice, isTextFile, inspectImageAsset } from './assets.js';
import sharp from 'sharp';

/** 核心服务 + 资产治理单测（替代 v1 services.test.ts，对齐 v2） */

beforeEach(async () => {
  await resetDb();
  await fs.rm(paths.uploads, { recursive: true, force: true });
  await fs.rm(paths.trash, { recursive: true, force: true });
});

describe('项目服务', () => {
  it('拼音检索：yhzx / yonghu / 用户 命中「用户中心」，不误报', async () => {
    await projectsService.createProject({ name: '用户中心', slug: 'user-center' });
    await projectsService.createProject({ name: '订单系统', slug: 'order' });
    for (const q of ['yhzx', 'yzx', 'yonghu', '用户']) {
      const r = await projectsService.listProjects({ q });
      expect(r.map((p) => p.name)).toEqual(['用户中心']);
    }
    expect(await projectsService.listProjects({ q: 'vibehub' })).toHaveLength(0);
  });

  it('按 ID / slug / 当前目录解析项目', async () => {
    const p = await projectsService.createProject({ name: '解析', slug: 'resolve' });
    expect((await projectsService.resolveProject(p.slug)).id).toBe(p.id);
    expect((await projectsService.resolveProject(p.id)).id).toBe(p.id);
    await expect(projectsService.resolveProject('不存在')).rejects.toThrow('项目不存在');
  });

  it('统计计数（open 缺陷 / 待办任务 / 附件）', async () => {
    const p = await projectsService.createProject({ name: '统计', slug: 'stats' });
    await bugsService.createBug({ projectId: p.id, title: 'A' });
    const b2 = await bugsService.createBug({ projectId: p.id, title: 'B' });
    await bugsService.updateBug(b2.id, { status: 'in_progress' });
    await tasksService.createTask({ projectId: p.id, title: 'T' });
    const list = await projectsService.listProjects({});
    expect(list[0].openBugCount).toBe(2);
    expect(list[0].todoTaskCount).toBe(1);
  });
});

describe('缺陷与任务', () => {
  it('看板按状态分组且顺序确定（同毫秒创建）', async () => {
    const p = await projectsService.createProject({ name: 'B', slug: 'board' });
    await bugsService.createBug({ projectId: p.id, title: 'A' });
    await bugsService.createBug({ projectId: p.id, title: 'B' });
    const c = await bugsService.createBug({ projectId: p.id, title: 'C' });
    await bugsService.updateBug(c.id, { status: 'in_progress' });
    const board = await bugsService.getBugBoard(p.id);
    expect(board.open.map((b) => b.title)).toEqual(['B', 'A']);
    expect(board.in_progress.map((b) => b.title)).toEqual(['C']);
  });

  it('任务状态与优先级校验 + 指派字段', async () => {
    const p = await projectsService.createProject({ name: 'T', slug: 'task' });
    const t = await tasksService.createTask({ projectId: p.id, title: '任务', priority: 'high', assigneeId: 'usr_1' });
    expect(t.assigneeId).toBe('usr_1');
    await expect(tasksService.createTask({ projectId: p.id, title: 'x', priority: 'urgent' })).rejects.toThrow('priority');
    // 流转不能跳级：待办 → 进行中 → 待验证 → 验证中 → 已完成
    await tasksService.updateTask(t.id, { status: 'doing' });
    await tasksService.updateTask(t.id, { status: 'review' });
    await tasksService.updateTask(t.id, { status: 'verifying' });
    const done = await tasksService.updateTask(t.id, { status: 'done' });
    expect(done.status).toBe('done');
  });

  it('删除缺陷', async () => {
    const p = await projectsService.createProject({ name: 'D', slug: 'del' });
    const bug = await bugsService.createBug({ projectId: p.id, title: '删' });
    const keep = await bugsService.createBug({ projectId: p.id, title: '留' });
    await prisma.bugComment.createMany({
      data: [
        { id: 'cmt_del_1', bugId: bug.id, authorType: 'ai', content: '随缺陷一起删' },
        { id: 'cmt_keep_1', bugId: keep.id, authorType: 'ai', content: '别的缺陷的评论要留着' },
      ],
    });
    await bugsService.deleteBug(bug.id);
    await expect(bugsService.getBug(bug.id)).rejects.toThrow('缺陷不存在');
    // bug_comments 无外键级联：删缺陷必须连带删评论，不留孤儿
    expect(await prisma.bugComment.count({ where: { bugId: bug.id } })).toBe(0);
    expect(await prisma.bugComment.count({ where: { bugId: keep.id } })).toBe(1);
  });
});

describe('便签原生数组 tags', () => {
  it('写数组读数组（无需 JSON.parse）', async () => {
    await notesService.createNote({ content: 'x', tags: ['a', 'b'] });
    const notes = await notesService.listNotes({});
    expect(notes[0].tags).toEqual(['a', 'b']);
    expect(notes[0].tagList).toEqual(['a', 'b']);
  });

  it('标签过滤 + 聚合 + 全局便签', async () => {
    const p = await projectsService.createProject({ name: '便签', slug: 'notes' });
    await notesService.createNote({ projectId: p.id, content: 'x', tags: ['auth'] });
    await notesService.createNote({ projectId: p.id, content: 'y', tags: ['misc'] });
    await notesService.createNote({ content: '全局' }); // projectId=null
    const filtered = await notesService.listNotes({ projectId: p.id, tag: 'auth' });
    expect(filtered).toHaveLength(1);
    const tags = await notesService.listNoteTags(p.id);
    expect(tags.map((t) => t.tag).sort()).toEqual(['auth', 'misc']);
    const globals = await notesService.listNotes({ projectId: null });
    expect(globals).toHaveLength(1);
    expect(globals[0].content).toBe('全局');
  });
});

describe('资产治理：归属 / 回收区 / 分片 / 图片', () => {
  async function seedAttachment(uploadedBy: string | null, fileName = 'f.log') {
    const p = await projectsService.createProject({ name: '资产', slug: 'assets' });
    const stored = await storage.writeBuffer(Buffer.from('L1\nL2\nL3'), randomId(), 'log');
    return attachmentsService.createAttachment({
      projectId: p.id,
      entityType: 'general',
      fileName,
      fileType: 'text/plain',
      fileSize: 8,
      storagePath: stored.storagePath,
      uploadedBy,
    });
  }
  function randomId() {
    return `att_${Math.random().toString(36).slice(2, 10)}`;
  }

  it('uploadedBy 落库 + mine 过滤隔离', async () => {
    const u1 = await createUser({ email: 'u1@t.com' });
    const u2 = await createUser({ email: 'u2@t.com' });
    const a1 = await seedAttachment(u1.user.id);
    const a2 = await seedAttachment(u2.user.id);
    expect(a1.uploadedBy).toBe(u1.user.id);
    const mine1 = await attachmentsService.listAttachments({ mine: u1.user.id });
    expect(mine1.map((a) => a.id)).toEqual([a1.id]);
    expect(await attachmentsService.listAttachments({ mine: u2.user.id })).toHaveLength(1);
    expect(a2.uploadedBy).toBe(u2.user.id);
  });

  it('uploadFromBuffer：图片提取尺寸，AI 密钥归属', async () => {
    const p = await projectsService.createProject({ name: 'AI资产', slug: 'ai-assets' });
    const key = await createApiKey({ scopes: ['attachment:write'] });
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    const att = await attachmentsService.uploadFromBuffer({
      projectId: p.id,
      fileName: 'ai.png',
      fileType: 'image/png',
      buffer: png,
      uploadedBy: key.id,
    });
    expect(att.uploadedBy).toBe(key.id);
    expect(att.width).toBe(40);
    expect(att.height).toBe(30);
  });

  it('回收区：moveToTrash 保留相对路径；purgeOlderThan 清理', async () => {
    const stored = await storage.writeBuffer(Buffer.from('trash'), randomId(), 'txt');
    const trashed = await storage.moveToTrash(stored.storagePath);
    expect(storage.exists(stored.storagePath)).toBe(false);
    expect(storage.exists(trashed)).toBe(true);
    expect(trashed.startsWith(paths.trash)).toBe(true);

    // 未超期不清理
    expect(await storage.purgeOlderThan(30)).toBe(0);
    expect(storage.exists(trashed)).toBe(true);
    // 超期清理（days=0）
    expect(await storage.purgeOlderThan(0)).toBe(1);
    expect(storage.exists(trashed)).toBe(false);
  });

  it('文本分片：行号偏移 + grep + has_more', async () => {
    const stored = await storage.writeBuffer(
      Buffer.from(Array.from({ length: 50 }, (_, i) => (i === 9 || i === 29 ? 'ERROR boom' : `info ${i}`)).join('\n')),
      randomId(),
      'log',
    );
    const r1 = await readTextSlice(stored.storagePath, { offsetLine: 1, limitLines: 10 });
    expect(r1.returnedLines).toBe(10);
    expect(r1.totalLines).toBe(50);
    expect(r1.hasMore).toBe(true);
    const rg = await readTextSlice(stored.storagePath, { grepKeyword: 'ERROR' });
    expect(rg.totalLines).toBe(2);
    expect(rg.content).toContain('L10: ERROR');
    expect(isTextFile('a.log', 'text/plain')).toBe(true);
    expect(isTextFile('a.png', 'image/png')).toBe(false);
  });

  it('图片降采样：大图缩放 + 缓存复用 + 小图原样', async () => {
    const big = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    const stored = await storage.writeBuffer(big, randomId(), 'png');
    const id = randomId();
    const info = await inspectImageAsset(stored.storagePath, id, { targetMaxDimension: 500 });
    expect(info.downscaled).toBe(true);
    expect(info.width).toBe(500);
    expect(info.height).toBe(250);
    const info2 = await inspectImageAsset(stored.storagePath, id, { targetMaxDimension: 500 });
    expect(info2.filePath).toBe(info.filePath); // 缓存命中

    const small = await sharp({ create: { width: 100, height: 80, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    const smallStored = await storage.writeBuffer(small, randomId(), 'png');
    const smallInfo = await inspectImageAsset(smallStored.storagePath, randomId(), { targetMaxDimension: 1080 });
    expect(smallInfo.downscaled).toBe(false);
    expect(smallInfo.width).toBe(100);
  });

  it('删除附件清理元数据（物理文件移回收区由调用方决定）', async () => {
    const a = await seedAttachment(null);
    await attachmentsService.deleteAttachment(a.id);
    await expect(attachmentsService.getAttachment(a.id)).rejects.toThrow('附件不存在');
    expect(config.attachmentTrashDays).toBeGreaterThan(0);
  });
});

describe('path.normalize 无关回归', () => {
  it('paths.trash 在 dataDir 下', () => {
    expect(paths.trash.startsWith(config.dataDir)).toBe(true);
    expect(path.basename(paths.trash)).toBe('trash');
  });
});
