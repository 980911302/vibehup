import { EventEmitter } from 'node:events';
import { prisma } from './prisma.js';

/** 领域事件类型：Web 看板通过 SSE 订阅，实现 AI 修复后实时刷新（阶段二能力，MVP 已内置） */
export type VibeEvent =
  | { type: 'bug.created'; projectId: string; bugId: string }
  | { type: 'bug.updated'; projectId: string; bugId: string; status: string }
  | { type: 'task.created'; projectId: string; taskId: string }
  | { type: 'task.updated'; projectId: string; taskId: string; status: string }
  | { type: 'note.created'; projectId: string | null; noteId: string }
  | { type: 'note.updated'; projectId: string | null; noteId: string }
  | { type: 'attachment.created'; projectId: string; attachmentId: string }
  | { type: 'attachment.deleted'; projectId: string; attachmentId: string };

/** PG LISTEN/NOTIFY 通道名（卡片 29）：MCP stdio 等独立进程写入后，SSE 经此 <1s 感知 */
export const NOTIFY_CHANNEL = 'vibehub_events';

/**
 * 进程内事件总线。HTTP 服务与 MCP Server 共享同一实例，
 * 任一端写入数据库后 emit，SSE 端点广播给所有 Web 看板连接。
 * publish 同时发 pg_notify（跨进程通道，emitNotify 异步且失败隔离）。
 */
class VibeEventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(event: VibeEvent): void {
    this.emitter.emit('vibe', event);
    void emitNotify(event);
  }

  subscribe(handler: (event: VibeEvent) => void): () => void {
    this.emitter.on('vibe', handler);
    return () => this.emitter.off('vibe', handler);
  }
}

async function emitNotify(event: VibeEvent): Promise<void> {
  try {
    // payload 均为扁平小对象（远小于 NOTIFY 8KB 上限）；失败仅丢加速通道，5s 轮询兜底
    await prisma.$executeRawUnsafe('SELECT pg_notify($1, $2)', NOTIFY_CHANNEL, JSON.stringify(event));
  } catch {
    // 通知失败不阻断业务
  }
}

export const eventBus = new VibeEventBus();
