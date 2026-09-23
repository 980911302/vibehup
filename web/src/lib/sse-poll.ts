/**
 * SSE 与轮询的协调（R78）：SSE 是**加速通道**，轮询是**兜底**。
 * 原实现无条件每 5s 轮询（即使 SSE 已连通并持续推送），12s 内白打 12 个请求、
 * 每次重拉 45KB 整板并触发重渲染。改为：
 *
 * - SSE 连通且最近有活动（打开 / 收到事件 / 心跳）→ 跳过本轮轮询；
 * - SSE 未连通，或虽连通但静默超过 staleAfterMs → 照常轮询（双保险不丢）。
 *
 * 关键：判定基于「最近活动时间」而非布尔标记——EventSource 的 onerror 在某些断网场景
 * 不会触发（TCP 半开），只看标记会永久停掉轮询，那才是真的丢实时性。
 */

/** 静默多久视为 SSE 不可信（> 2× 轮询间隔，给心跳留余量） */
export const SSE_STALE_MS = 15_000;

export interface PollDecisionInput {
  sseConnected: boolean;
  /** 最近一次 SSE 活动时间（onopen/onmessage 刷新）；从未活动为 null */
  lastEventAt: number | null;
  now: number;
  staleAfterMs?: number;
}

/** true = 本轮可以跳过轮询（SSE 正在有效工作）；false = 必须轮询兜底 */
export function shouldSkipPoll(input: PollDecisionInput): boolean {
  const { sseConnected, lastEventAt, now, staleAfterMs = SSE_STALE_MS } = input;
  if (!sseConnected || lastEventAt === null) return false;
  return now - lastEventAt < staleAfterMs;
}
