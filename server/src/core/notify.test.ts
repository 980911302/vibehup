import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import pg from 'pg';
import { prisma } from './prisma.js';
import { resetDb, createUser, createApiKey } from '../test-helpers.js';
import * as projectsService from '../services/projects.js';
import * as bugsService from '../services/bugs.js';
import * as notesService from '../services/notes.js';

/**
 * PG LISTEN/NOTIFY 跨进程事件通道（卡片 29）：
 * eventBus.publish 后发 pg_notify，独立 pg Client LISTEN 应收达——
 * 这正是 MCP stdio 跨进程写入能被 SSE 通道感知的机制。
 */

const CHANNEL = 'vibehub_events';

interface Listener {
  client: pg.Client;
  received: { channel: string; payload: string }[];
}

async function openListener(): Promise<Listener> {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  await client.query(`LISTEN ${CHANNEL}`);
  const received: { channel: string; payload: string }[] = [];
  client.on('notification', (msg) => {
    if (msg.channel === CHANNEL) received.push({ channel: msg.channel, payload: msg.payload });
  });
  return { client, received };
}

async function waitFor(listener: Listener, predicate: (p: string) => boolean, timeoutMs = 3000): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hit = listener.received.find((r) => predicate(r.payload));
    if (hit) return hit.payload;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

beforeEach(async () => {
  await resetDb();
});

describe('PG NOTIFY 事件通道（卡片 29）', () => {
  let listener: Listener | null = null;

  afterEach(async () => {
    if (listener) {
      await listener.client.end().catch(() => undefined);
      listener = null;
    }
  });

  it('createBug 后 LISTEN 端收到 bug.created 通知（含 bugId）', async () => {
    listener = await openListener();
    const project = await projectsService.createProject({ name: '通知项目', slug: 'notify-p' });
    const bug = await bugsService.createBug({ projectId: project.id, title: '通知测试缺陷' });
    const payload = await waitFor(listener, (p) => p.includes(bug.id) && p.includes('bug.created'));
    expect(payload).not.toBeNull();
    const parsed = JSON.parse(payload as string) as { type: string; bugId: string; projectId: string };
    expect(parsed.type).toBe('bug.created');
    expect(parsed.bugId).toBe(bug.id);
    expect(parsed.projectId).toBe(project.id);
  });

  it('createNote 后收到 note.created 通知', async () => {
    listener = await openListener();
    const note = await notesService.createNote({ content: '通知测试便签' });
    const payload = await waitFor(listener, (p) => p.includes(note.id) && p.includes('note.created'));
    expect(payload).not.toBeNull();
  });

  it('updateBug 状态流转后收到 bug.updated 通知', async () => {
    listener = await openListener();
    const project = await projectsService.createProject({ name: '流转项目', slug: 'notify-f' });
    const bug = await bugsService.createBug({ projectId: project.id, title: '流转缺陷' });
    await bugsService.updateBug(bug.id, { status: 'in_progress' });
    const payload = await waitFor(listener, (p) => p.includes('bug.updated') && p.includes(bug.id));
    expect(payload).not.toBeNull();
  });

  it('通知 payload 为扁平 JSON 且远小于 NOTIFY 8KB 上限', async () => {
    listener = await openListener();
    const project = await projectsService.createProject({ name: '体积项目', slug: 'notify-s' });
    const bug = await bugsService.createBug({ projectId: project.id, title: '体积测试' });
    const payload = await waitFor(listener, (p) => p.includes(bug.id));
    expect(payload).not.toBeNull();
    expect(Buffer.byteLength(payload as string, 'utf8')).toBeLessThan(8000);
    expect(() => JSON.parse(payload as string)).not.toThrow();
    // 扁平：无嵌套对象
    const parsed = JSON.parse(payload as string) as Record<string, unknown>;
    for (const v of Object.values(parsed)) {
      expect(typeof v === 'object' && v !== null).toBe(false);
    }
  });

  it('api key 创建不依赖事件通道（usage 打点路径不发 vibe 事件）', async () => {
    listener = await openListener();
    const user = await createUser();
    await createApiKey({ createdBy: user.user.id });
    const stray = await waitFor(listener, () => true, 800);
    expect(stray).toBeNull();
  });

  it('业务写入失败时不发通知（createBug 抛错前无 bug.created）', async () => {
    listener = await openListener();
    await projectsService.createProject({ name: '失败项目', slug: 'notify-x' });
    await expect(
      bugsService.createBug({ projectId: 'prj_不存在', title: '坏缺陷' }),
    ).rejects.toThrow();
    const stray = await waitFor(listener, () => true, 800);
    expect(stray).toBeNull();
  });
});

// prisma 连接保持（池由测试框架管理，无需显式断开）
void prisma;
