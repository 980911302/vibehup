import { config } from '../config.js';

/**
 * 登录防暴力（卡片 F4）：按「邮箱 + 客户端 IP」在滑动窗口内计数失败尝试。
 *
 * - 只统计**失败**登录（密码错/账号不存在/被禁用），成功即清零；
 * - 按 key 分桶，避免攻击者拿一个邮箱锁死全站，或换 IP/换邮箱绕过；
 * - 进程内 Map：本工程为单容器单进程部署，无需 Redis（多副本部署需换共享存储，见 AGENTS.md §3）。
 */

interface Bucket {
  count: number;
  /** 窗口起点（该批失败中最早一次） */
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

function keyOf(email: string, ip: string): string {
  return `${email.trim().toLowerCase()}|${ip}`;
}

export interface BlockedState {
  blocked: boolean;
  /** 剩余窗口毫秒（blocked=true 时 >0） */
  retryAfterMs: number;
  /** 当前窗口内已失败次数 */
  count: number;
}

/**
 * 判断某 key 是否已被限流。
 * @param now 注入时间戳（测试用；缺省 Date.now()）
 */
export function checkBlocked(email: string, ip: string, now = Date.now()): BlockedState {
  const { maxAttempts, windowMs } = config.loginThrottle;
  const bucket = buckets.get(keyOf(email, ip));
  if (!bucket) return { blocked: false, retryAfterMs: 0, count: 0 };

  const elapsed = now - bucket.windowStart;
  if (elapsed >= windowMs) {
    buckets.delete(keyOf(email, ip));
    return { blocked: false, retryAfterMs: 0, count: 0 };
  }
  if (bucket.count < maxAttempts) {
    return { blocked: false, retryAfterMs: 0, count: bucket.count };
  }
  return { blocked: true, retryAfterMs: windowMs - elapsed, count: bucket.count };
}

/** 记一次失败；同一窗口累加，窗口过期则重新开窗。 */
export function registerFailure(email: string, ip: string, now = Date.now()): void {
  const { windowMs } = config.loginThrottle;
  const key = keyOf(email, ip);
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return;
  }
  bucket.count += 1;
}

/** 登录成功后清零该 key 的失败计数。 */
export function clear(email: string, ip: string): void {
  buckets.delete(keyOf(email, ip));
}

/** 测试隔离用：清空全部计数。 */
export function reset(): void {
  buckets.clear();
}
