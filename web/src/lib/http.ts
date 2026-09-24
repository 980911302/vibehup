/**
 * HTTP 底座（从 lib/api.ts 拆出，控制单文件长度）：令牌注入、401 刷新重放、错误体解析。
 * 页面与组件不直接用本文件，一律经 lib/api.ts 的 api 对象（AGENTS.md 前端契约）。
 */
import { createTokenRefresher, webLock } from './token-refresh';

/**
 * - 自动带 Authorization；401 → 经刷新协调器换新令牌重放一次（单飞 + 跨标签，见 token-refresh.ts）
 * - 与 Fastify 同源部署（生产）；开发环境由 next rewrites 代理到 :3210
 */

export const BASE = '/api';

interface TokenAccessors {
  getAccessToken: () => string | null;
  getRefreshToken: () => string | null;
  onTokens: (access: string, refresh: string) => void;
  onAuthFail: () => void;
}

let tokenAccessors: TokenAccessors | null = null;
let refreshAccess: ((failedAccess: string | null) => Promise<string | null>) | null = null;

/** 由 AuthProvider 注入（避免循环依赖） */
export function setTokenAccessors(accessors: TokenAccessors): void {
  tokenAccessors = accessors;
  refreshAccess = createTokenRefresher({
    readTokens: () => ({ access: accessors.getAccessToken(), refresh: accessors.getRefreshToken() }),
    callRefresh: (refreshToken) =>
      rawRequest<{ access_token: string; refresh_token: string }>(
        '/auth/refresh',
        {
          method: 'POST',
          body: JSON.stringify({ refresh_token: refreshToken }),
          // 持有跨标签锁期间不能无限挂起
          signal: AbortSignal.timeout(15_000),
        },
        null,
      ),
    saveTokens: accessors.onTokens,
    isAuthRejection: (err) => err instanceof ApiError && (err.status === 401 || err.status === 403),
    withLock: webLock,
  });
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function parseError(res: Response): Promise<ApiError> {
  let message = `请求失败 (${res.status})`;
  let code = 'HTTP_ERROR';
  try {
    const body = await res.json();
    if (body?.error?.message) message = body.error.message;
    if (body?.error?.code) code = body.error.code;
  } catch {
    // 非 JSON 响应
  }
  return new ApiError(message, res.status, code);
}

export async function rawRequest<T>(path: string, init: RequestInit, token: string | null): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** 统一请求：401 → 换新令牌重放一次；只有刷新被拒才登出，网络抖动/服务重启不踢人（R76） */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = tokenAccessors?.getAccessToken() ?? null;
  try {
    return await rawRequest<T>(path, init, token);
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 401 && tokenAccessors && refreshAccess)) throw err;
    const fresh = await refreshAccess(token).catch(() => undefined);
    if (fresh === undefined) throw err;
    if (fresh === null) {
      tokenAccessors.onAuthFail();
      throw err;
    }
    return rawRequest<T>(path, init, fresh);
  }
}


/** 当前访问令牌（multipart/XHR 上传等需要自己拼请求时用） */
export function currentAccessToken(): string | null {
  return tokenAccessors?.getAccessToken() ?? null;
}

/** 二进制下载（如技能 zip）：同样走令牌刷新；返回 Blob 与服务端给的文件名 */
export async function requestBlob(path: string): Promise<{ blob: Blob; fileName: string | null }> {
  const fetchOnce = (token: string | null) =>
    fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  let token = tokenAccessors?.getAccessToken() ?? null;
  let res = await fetchOnce(token);
  if (res.status === 401 && refreshAccess) {
    token = (await refreshAccess(token).catch(() => null)) ?? null;
    if (token) res = await fetchOnce(token);
  }
  if (!res.ok) throw await parseError(res);
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? null;
  return { blob: await res.blob(), fileName };
}
