'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * Toast Provider（UI 规范 §2.9）。
 * - 撤销操作插槽：5s 倒计时进度条，到点 action 消失
 * - 堆叠让位：新 Toast 从下方滑入，旧 Toast 上移
 * - 同 key 更新合并，最多 3 条
 */

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  key?: string;
  duration?: number; // ms，默认 5000；undo 到点消失后再停留 1s
  action?: ToastAction;
}

interface ToastItem extends ToastOptions {
  id: number;
  variant: 'success' | 'error' | 'info';
  message: string;
  exiting?: boolean;
}

interface ToastState {
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
  dismiss: (key: string) => void;
}

const ToastContext = createContext<ToastState | null>(null);
const MAX_VISIBLE = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = useCallback((variant: ToastItem['variant'], message: string, options: ToastOptions = {}) => {
    const id = nextId.current++;
    const duration = options.duration ?? 5000;
    setToasts((prev) => {
      // 同 key 合并（替换旧的）
      const base = options.key ? prev.filter((t) => t.key !== options.key) : prev;
      const next = [...base, { ...options, id, variant, message }];
      return next.slice(-MAX_VISIBLE);
    });
    // 到点移除
    window.setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 140);
    }, duration);
  }, []);

  const dismiss = useCallback((key: string) => {
    setToasts((prev) => prev.filter((t) => t.key !== key));
  }, []);

  const state: ToastState = {
    success: useCallback((m, o) => push('success', m, o), [push]),
    error: useCallback((m, o) => push('error', m, o), [push]),
    info: useCallback((m, o) => push('info', m, o), [push]),
    dismiss,
  };

  return (
    <ToastContext.Provider value={state}>
      {children}
      <div className="vh-toast-stack" role="region" aria-label="通知">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`vh-toast vh-toast-${t.variant}${t.exiting ? ' exiting' : ''}`}
            data-testid="toast"
          >
            <span className="vh-toast-dot" />
            <span className="vh-toast-msg">{t.message}</span>
            {t.action && (
              <button
                className="vh-toast-action"
                onClick={() => {
                  t.action!.onClick();
                  setToasts((prev) => prev.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="vh-toast-close" onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}>
              <X size={12} />
            </button>
            {/* 倒计时进度条 */}
            <i className="vh-toast-progress" style={{ animationDuration: `${t.duration ?? 5000}ms` }} />
          </div>
        ))}
      </div>
      <style jsx global>{`
        .vh-toast-stack {
          position: fixed; bottom: 40px; left: 50%; transform: translateX(-50%);
          display: flex; flex-direction: column; gap: 8px; z-index: 90; align-items: center;
        }
        .vh-toast {
          position: relative; display: flex; align-items: center; gap: 10px;
          min-width: 280px; max-width: 480px; padding: 10px 14px;
          background: var(--bg-elevated); border: 1px solid var(--border-strong);
          border-radius: var(--r-card); box-shadow: var(--shadow-2);
          font-size: 13px; color: var(--text-primary);
          animation: vh-toast-in 220ms var(--ease-spring) 1;
          overflow: hidden;
        }
        .vh-toast.exiting { opacity: 0; transform: translateY(6px); transition: all 140ms var(--ease); }
        .vh-toast-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .vh-toast-success .vh-toast-dot { background: var(--ok); }
        .vh-toast-error .vh-toast-dot { background: var(--danger); }
        .vh-toast-info .vh-toast-dot { background: var(--brand); }
        .vh-toast-msg { flex: 1; }
        .vh-toast-action {
          background: none; border: none; color: var(--gold); font-size: 13px; font-weight: 600;
          cursor: pointer; padding: 2px 6px; border-radius: 6px;
        }
        .vh-toast-action:hover { background: var(--gold-bg); }
        .vh-toast-close {
          background: none; border: none; color: var(--text-tertiary); cursor: pointer;
          display: inline-flex; padding: 2px; border-radius: 4px;
        }
        .vh-toast-close:hover { color: var(--text-primary); }
        .vh-toast-progress {
          position: absolute; left: 0; bottom: 0; height: 2px; width: 100%;
          background: var(--gold); transform-origin: left;
          animation-name: vh-toast-countdown; animation-timing-function: linear; animation-fill-mode: forwards;
        }
        @keyframes vh-toast-countdown { from { transform: scaleX(1); } to { transform: scaleX(0); } }
      `}</style>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastState {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用');
  return ctx;
}
