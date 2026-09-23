import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetDb } from '../test-helpers.js';
import { NOTIFY_CHANNEL, eventBus } from '../core/events.js';
import * as sse from './sse-listener.js';

/**
 * F5 SSE 加固：
 * ① 进程内共享**一条** LISTEN 连接分发给所有订阅者（原本每个 EventSource 独占一条 PG 连接）；
 * ② 连接被断开后能自愈重建（新订阅者仍能收到通知）；
 * ③ 失败不炸进程（错误只丢加速，前端仍有 5s 轮询兜底）。
 */

/** 等待条件成立（避免固定 sleep 造成的偶发失败） */
async function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('等待超时');
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeEach(async () => {
  await resetDb();
  sse.__resetForTest();
});

afterEach(async () => {
  await sse.stopSharedListener();
});

describe('F5 SSE 共享 LISTEN 连接', () => {
  it('多个订阅者共用一条连接，且都能收到通知', async () => {
    const a: string[] = [];
    const b: string[] = [];
    await sse.subscribe((payload) => a.push(payload));
    await sse.subscribe((payload) => b.push(payload));

    expect(sse.getState().connections).toBe(1);
    expect(sse.getState().subscribers).toBe(2);

    eventBus.publish({ type: 'bug.created', projectId: 'prj_x', bugId: 'bug_x' });
    await waitFor(() => a.length > 0 && b.length > 0);

    expect(JSON.parse(a[0]).type).toBe('bug.created');
    expect(JSON.parse(b[0]).type).toBe('bug.created');
    expect(sse.getState().connections).toBe(1);
  });

  it('订阅者退订后连接保持（还有订阅者时不断开）', async () => {
    const un1 = await sse.subscribe(() => undefined);
    await sse.subscribe(() => undefined);
    un1();
    expect(sse.getState().subscribers).toBe(1);
    expect(sse.getState().connections).toBe(1);
  });

  it('连接断开后自愈：新订阅者仍能收到通知', async () => {
    const got: string[] = [];
    await sse.subscribe((p) => got.push(p));
    await sse.stopSharedListener();
    expect(sse.getState().connected).toBe(false);
    expect(sse.getState().subscribers).toBe(0);

    await sse.subscribe((p) => got.push(p));
    expect(sse.getState().connected).toBe(true);
    const connectionsAfterRecover = sse.getState().connections;

    eventBus.publish({ type: 'note.created', projectId: 'prj_x', noteId: 'nte_x' });
    await waitFor(() => got.some((p) => JSON.parse(p).type === 'note.created'));
    // 自愈只保持一条连接，收到通知后累计建连数不再增长
    expect(sse.getState().connections).toBe(connectionsAfterRecover);
  });

  it('LISTEN 通道名与 notify 约定一致', () => {
    expect(NOTIFY_CHANNEL).toBe('vibehub_events');
    expect(sse.getState().channel).toBe(NOTIFY_CHANNEL);
  });

  it('订阅者回调抛错不影响其他订阅者', async () => {
    const got: string[] = [];
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await sse.subscribe(() => {
      throw new Error('boom');
    });
    await sse.subscribe((p) => got.push(p));

    eventBus.publish({ type: 'bug.updated', projectId: 'prj_y', bugId: 'bug_y', status: 'resolved' });
    await waitFor(() => got.length > 0);
    expect(JSON.parse(got[0]).type).toBe('bug.updated');
  });
});
