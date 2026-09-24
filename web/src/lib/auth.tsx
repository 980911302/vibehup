'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, setTokenAccessors } from './api';
import type { PublicUser } from './api-types';

/**
 * 认证上下文（卡片 15）。
 * token 持久化 localStorage；401 → 静默 refresh 一次重放 → 仍失败清态回登录页。
 */

const TOKEN_KEY = 'vibehub_token';
const REFRESH_KEY = 'vibehub_refresh';

interface AuthState {
  user: PublicUser | null;
  accessToken: string | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

function readStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // 隐私模式等场景静默失败
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // ref 持有最新令牌：accessor 的 getter 必须读 ref 而非闭包，
  // 否则启动恢复流程中（setAccessToken 尚未触发重渲染）请求会带上旧闭包的 null
  const accessTokenRef = useRef<string | null>(null);
  const refreshTokenRef = useRef<string | null>(null);

  // 供 api.ts 读取当前 token（避免循环依赖）；只注册一次。
  // localStorage 优先（R76）：别的标签刷新后本标签立刻用上新令牌，不会再提交已轮换的旧令牌
  useEffect(() => {
    setTokenAccessors({
      getAccessToken: () => readStorage(TOKEN_KEY) ?? accessTokenRef.current,
      getRefreshToken: () => readStorage(REFRESH_KEY) ?? refreshTokenRef.current,
      onTokens: (access, refresh) => {
        accessTokenRef.current = access;
        refreshTokenRef.current = refresh;
        setAccessToken(access);
        writeStorage(TOKEN_KEY, access);
        writeStorage(REFRESH_KEY, refresh);
      },
      onAuthFail: () => {
        accessTokenRef.current = null;
        refreshTokenRef.current = null;
        setUser(null);
        setAccessToken(null);
        writeStorage(TOKEN_KEY, null);
        writeStorage(REFRESH_KEY, null);
      },
    });
  }, []);

  // 跨标签同步（R76）：别的标签刷新/登出后，本标签的内存令牌与 SSE 连接随之更新
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== TOKEN_KEY && e.key !== REFRESH_KEY) return;
      const access = readStorage(TOKEN_KEY);
      accessTokenRef.current = access;
      refreshTokenRef.current = readStorage(REFRESH_KEY);
      setAccessToken(access);
      if (!access) setUser(null);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // 启动：本地恢复 + 校验
  useEffect(() => {
    (async () => {
      const token = readStorage(TOKEN_KEY);
      refreshTokenRef.current = readStorage(REFRESH_KEY);
      if (token) {
        accessTokenRef.current = token; // 同步 ref，确保 api.me() 带得上令牌
        setAccessToken(token);
        try {
          // 令牌过期时 api 层会经刷新协调器换新并重放；此处不再另行刷新——
          // 同一旧令牌提交两次会被服务端判为重放、整族吊销（R76）
          const me = await api.me();
          setUser(me.user);
        } catch {
          writeStorage(TOKEN_KEY, null);
          writeStorage(REFRESH_KEY, null);
        }
      }
      setReady(true);
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.login(email, password);
    accessTokenRef.current = r.access_token;
    refreshTokenRef.current = r.refresh_token;
    setUser(r.user);
    setAccessToken(r.access_token);
    writeStorage(TOKEN_KEY, r.access_token);
    writeStorage(REFRESH_KEY, r.refresh_token);
  }, []);

  const register = useCallback(async (email: string, password: string, name: string) => {
    const r = await api.register(email, password, name);
    accessTokenRef.current = r.access_token;
    refreshTokenRef.current = r.refresh_token;
    setUser(r.user);
    setAccessToken(r.access_token);
    writeStorage(TOKEN_KEY, r.access_token);
    writeStorage(REFRESH_KEY, r.refresh_token);
  }, []);

  const logout = useCallback(async () => {
    const refresh = readStorage(REFRESH_KEY) ?? refreshTokenRef.current;
    if (refresh) await api.logout(refresh).catch(() => undefined);
    accessTokenRef.current = null;
    refreshTokenRef.current = null;
    setUser(null);
    setAccessToken(null);
    writeStorage(TOKEN_KEY, null);
    writeStorage(REFRESH_KEY, null);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const me = await api.me();
      setUser(me.user);
    } catch {
      // 忽略：401 由 api 层处理
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, accessToken, ready, login, register, logout, refreshUser }),
    [user, accessToken, ready, login, register, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}

/** 当前用户能否写内容：viewer（只读）不能，服务端写接口同样拦截（功能巡检 B2） */
export function useCanEdit(): boolean {
  const { user } = useAuth();
  return !!user && user.role !== 'viewer';
}
