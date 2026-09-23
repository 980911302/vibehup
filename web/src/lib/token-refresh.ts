/**
 * 刷新令牌协调器（R76）。
 * 服务端把「已轮换的旧 refresh token 再次提交」视为重放并吊销整个令牌族；
 * 若多个并发 401 各自刷新，后到者会把整个登录态踢掉（周期性掉线的根因）。
 *
 * - 单飞：同一标签内并发 401 只提交一次刷新，其余请求等待同一结果
 * - 采用：localStorage 为跨标签唯一真相源，令牌已被别处换过就直接用，不再提交旧令牌
 * - 互斥：支持 Web Locks 时串行化各标签的刷新（不支持时由服务端 10s 宽限期兜底）
 */

export interface RefreshDeps {
  /** 当前令牌（优先读 localStorage，保证能看到其他标签写入的新令牌） */
  readTokens: () => { access: string | null; refresh: string | null };
  /** POST /auth/refresh */
  callRefresh: (refreshToken: string) => Promise<{ access_token: string; refresh_token: string }>;
  /** 写回新令牌（内存 + localStorage） */
  saveTokens: (access: string, refresh: string) => void;
  /** 刷新被服务端拒绝（令牌失效/被禁用）→ 需要重新登录；其余错误视为暂时故障 */
  isAuthRejection: (err: unknown) => boolean;
  /** 跨标签互斥 */
  withLock?: <T>(fn: () => Promise<T>) => Promise<T>;
}

/**
 * 返回 refreshAccess(failedAccess)：
 * - string：可用的新 access token
 * - null：没有可用的 refresh token / 刷新被拒 → 调用方应登出
 * - reject：网络或服务暂时故障 → 调用方不应登出，下次请求会重试
 */
export function createTokenRefresher(deps: RefreshDeps) {
  let inflight: Promise<string | null> | null = null;

  const run = async (failedAccess: string | null): Promise<string | null> => {
    const { access, refresh } = deps.readTokens();
    if (access && access !== failedAccess) return access;
    if (!refresh) return null;
    try {
      const r = await deps.callRefresh(refresh);
      deps.saveTokens(r.access_token, r.refresh_token);
      return r.access_token;
    } catch (err) {
      if (deps.isAuthRejection(err)) return null;
      throw err;
    }
  };

  return (failedAccess: string | null): Promise<string | null> => {
    if (!inflight) {
      const task = () => run(failedAccess);
      inflight = (deps.withLock ? deps.withLock(task) : task()).finally(() => {
        inflight = null;
      });
    }
    return inflight;
  };
}

/** Web Locks 跨标签互斥；浏览器不支持时直接执行 */
export async function webLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) return fn();
  return await locks.request('vibehub-token-refresh', fn);
}
