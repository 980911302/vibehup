import { describe, it, expect } from 'vitest';
import { shouldSkipPoll, SSE_STALE_MS } from './sse-poll';

/** R78：SSE 有效时停轮询，SSE 失效/静默时恢复兜底——此判定必须可测（纯函数） */
describe('shouldSkipPoll', () => {
  const now = 1_000_000;

  it('SSE 未连通 → 不跳过（轮询兜底）', () => {
    expect(shouldSkipPoll({ sseConnected: false, lastEventAt: now, now })).toBe(false);
  });

  it('从未收到过 SSE 活动 → 不跳过', () => {
    expect(shouldSkipPoll({ sseConnected: true, lastEventAt: null, now })).toBe(false);
  });

  it('SSE 连通且刚有活动 → 跳过本轮轮询', () => {
    expect(shouldSkipPoll({ sseConnected: true, lastEventAt: now - 100, now })).toBe(true);
    expect(shouldSkipPoll({ sseConnected: true, lastEventAt: now, now })).toBe(true);
  });

  it('SSE 连通但静默超过 staleAfterMs → 恢复轮询（半开连接也能兜底）', () => {
    expect(shouldSkipPoll({ sseConnected: true, lastEventAt: now - SSE_STALE_MS - 1, now })).toBe(false);
    expect(shouldSkipPoll({ sseConnected: true, lastEventAt: now - SSE_STALE_MS + 1, now })).toBe(true);
  });

  it('默认静默阈值大于两倍轮询间隔（心跳 25s 场景仍应保留轮询余量）', () => {
    expect(SSE_STALE_MS).toBeGreaterThan(2 * 5000);
  });

  it('可覆盖阈值（测试与将来调参）', () => {
    expect(shouldSkipPoll({ sseConnected: true, lastEventAt: now - 300, now, staleAfterMs: 200 })).toBe(false);
    expect(shouldSkipPoll({ sseConnected: true, lastEventAt: now - 100, now, staleAfterMs: 200 })).toBe(true);
  });
});
