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

  // 供 api.ts 读取当前 token（避免循环依赖）；只注册一次
  useEffect(() => {
    setTokenAccessors({
      getAccessToken: () => accessTokenRef.current,
      getRefreshToken: () => refreshTokenRef.current,
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

  // 启动：本地恢复 + 校验
  useEffect(() => {
    (async () => {
      const token = readStorage(TOKEN_KEY);
      const refresh = readStorage(REFRESH_KEY);
      refreshTokenRef.current = refresh;
      if (token) {
        accessTokenRef.current = token; // 同步 ref，确保 api.me() 带得上令牌
        setAccessToken(token);
        try {
          const me = await api.me();
          setUser(me.user);
        } catch (e) {
          // token 失效：尝试刷新
          if (refresh) {
            try {
              const r = await api.refresh(refresh);
              // 必须同步 ref：api 层 getter 读 ref，否则下一步 me() 仍带旧 null 令牌
              accessTokenRef.current = r.access_token;
              refreshTokenRef.current = r.refresh_token;
              setAccessToken(r.access_token);
              writeStorage(TOKEN_KEY, r.access_token);
              writeStorage(REFRESH_KEY, r.refresh_token);
              const me = await api.me();
              setUser(me.user);
            } catch (e2) {
              writeStorage(TOKEN_KEY, null);
              writeStorage(REFRESH_KEY, null);
            }
          } else {
            writeStorage(TOKEN_KEY, null);
          }
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
    const refresh = refreshTokenRef.current;
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
