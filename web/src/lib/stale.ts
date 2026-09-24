import type { StatusActor } from './api-types';

/**
 * 「谁在处理、停了多久、是不是卡住了」（R83）。
 * 阈值是 server/src/services/stale.ts 的镜像：验证中超过 2 小时、进行中超过 24 小时算卡住。
 */
export const STALE_AFTER_MS: Record<string, number> = {
  verifying: 2 * 3600_000,
  in_progress: 24 * 3600_000,
  doing: 24 * 3600_000,
};

/** 处理中的状态：卡片上显示「谁 · 多久」 */
export function isHandlingStatus(status: string): boolean {
  return status in STALE_AFTER_MS;
}

/** 「12 分钟」「3 小时」「2 天」 */
export function formatSpan(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} 小时`;
  return `${Math.floor(h / 24)} 天`;
}

export interface Handling {
  actor: StatusActor | null;
  /** 在当前状态停留了多久 */
  span: string;
  stale: boolean;
}

/**
 * 处理中的缺陷/任务：谁在处理、停了多久。
 * 历史数据没有流转时间，用 updated_at 近似；不是处理中的状态返回 null。
 */
export function handlingOf(
  item: { status: string; status_changed_at: string | null; status_actor: StatusActor | null; updated_at: string },
  now = Date.now(),
): Handling | null {
  if (!isHandlingStatus(item.status)) return null;
  const since = new Date(item.status_changed_at ?? item.updated_at).getTime();
  const elapsed = now - since;
  return { actor: item.status_actor, span: formatSpan(elapsed), stale: elapsed > STALE_AFTER_MS[item.status] };
}
