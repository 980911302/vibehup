import { describe, it, expect } from 'vitest';
import { createTokenRefresher, type RefreshDeps } from './token-refresh';

/**
 * 刷新令牌协调器（R76）：服务端对「已轮换令牌再次提交」按重放处理并整族吊销，
 * 前端若让多个 401 各自刷新，后到者就会把整个登录态踢掉——表现为周期性掉线。
 */

/** 模拟 localStorage（多个标签共享同一份） */
function sharedStorage(access: string | null, refresh: string | null) {
  return { access, refresh };
}

/** 模拟 Web Locks：同名锁串行执行 */
function fakeLock() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
}

class RejectedByServer extends Error {}

function tab(store: { access: string | null; refresh: string | null }, overrides: Partial<RefreshDeps> = {}) {
  const calls: string[] = [];
  let n = 0;
  const deps: RefreshDeps = {
    readTokens: () => ({ access: store.access, refresh: store.refresh }),
    callRefresh: async (refreshToken) => {
      calls.push(refreshToken);
      await new Promise((r) => setTimeout(r, 5));
      n += 1;
      return { access_token: `T${n}`, refresh_token: `R${n}` };
    },
    saveTokens: (access, refresh) => {
      store.access = access;
      store.refresh = refresh;
    },
    isAuthRejection: (err) => err instanceof RejectedByServer,
    ...overrides,
  };
  return { refreshAccess: createTokenRefresher(deps), calls };
}

describe('createTokenRefresher', () => {
  it('同一标签内并发 401：只提交一次刷新，所有请求拿到同一新令牌', async () => {
    const store = sharedStorage('T0', 'R0');
    const { refreshAccess, calls } = tab(store);

    const results = await Promise.all([refreshAccess('T0'), refreshAccess('T0'), refreshAccess('T0')]);

    expect(calls).toEqual(['R0']);
    expect(results).toEqual(['T1', 'T1', 'T1']);
    expect(store).toEqual({ access: 'T1', refresh: 'R1' });
  });

  it('令牌已被别的请求/标签换过：直接采用新令牌，不再提交旧 refresh token', async () => {
    const store = sharedStorage('T9', 'R9');
    const { refreshAccess, calls } = tab(store);

    await expect(refreshAccess('T0')).resolves.toBe('T9');
    expect(calls).toEqual([]);
  });

  it('两个标签同时刷新：跨标签互斥后只有一个真正提交', async () => {
    const store = sharedStorage('T0', 'R0');
    const withLock = fakeLock();
    const a = tab(store, { withLock });
    const b = tab(store, { withLock });

    const [ra, rb] = await Promise.all([a.refreshAccess('T0'), b.refreshAccess('T0')]);

    expect([...a.calls, ...b.calls]).toEqual(['R0']);
    expect(ra).toBe('T1');
    expect(rb).toBe('T1');
  });

  it('没有 refresh token：返回 null（需要重新登录）', async () => {
    const { refreshAccess } = tab(sharedStorage('T0', null));
    await expect(refreshAccess('T0')).resolves.toBeNull();
  });

  it('刷新被服务端拒绝（令牌失效）：返回 null，交由调用方登出', async () => {
    const { refreshAccess } = tab(sharedStorage('T0', 'R0'), {
      callRefresh: async () => {
        throw new RejectedByServer('TOKEN_REUSED');
      },
    });
    await expect(refreshAccess('T0')).resolves.toBeNull();
  });

  it('网络错误 / 服务重启：错误上抛（不登出），且下一次可重新发起', async () => {
    let fail = true;
    const store = sharedStorage('T0', 'R0');
    const { refreshAccess } = tab(store, {
      callRefresh: async () => {
        if (fail) throw new TypeError('Failed to fetch');
        return { access_token: 'T1', refresh_token: 'R1' };
      },
    });

    await expect(refreshAccess('T0')).rejects.toThrow('Failed to fetch');
    fail = false;
    await expect(refreshAccess('T0')).resolves.toBe('T1');
  });
});
