'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/** 主题 Provider（UI 规范 §1.3）：Midnight 默认 / Daylight 纸白；登录页恒定纸白（自身作用域覆盖） */

export type ThemeName = 'midnight' | 'daylight';

const STORAGE_KEY = 'vibehub_theme';

interface ThemeState {
  theme: ThemeName;
  toggle: () => void;
  setTheme: (t: ThemeName) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

function readStored(): ThemeName {
  if (typeof window === 'undefined') return 'midnight';
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'daylight' ? 'daylight' : 'midnight';
  } catch {
    return 'midnight';
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>('midnight');

  // 挂载后读本地偏好（避免 SSR 不匹配）
  useEffect(() => {
    const stored = readStored();
    setThemeState(stored);
    document.documentElement.dataset.theme = stored;
  }, []);

  const setTheme = useCallback((t: ThemeName) => {
    setThemeState(t);
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // 隐私模式静默
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === 'midnight' ? 'daylight' : 'midnight');
  }, [theme, setTheme]);

  return <ThemeContext.Provider value={{ theme, toggle, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme 必须在 ThemeProvider 内使用');
  return ctx;
}
