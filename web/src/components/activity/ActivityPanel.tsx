'use client';

import { useCallback, useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { relativeTime } from '@/lib/time';
import type { ActivityItem } from '@/lib/api-types';

const REFRESH_INTERVAL = 10_000;

/**
 * AI 活动面板（卡片 36）：右侧滑出，展示最近 MCP 调用（脱敏）。
 * 全员可见——让人感知「AI 刚才读了什么」，建立把上下文交给 AI 的信任。
 */
export function ActivityPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api.recentActivity());
    } catch {
      toast.error('AI 活动加载失败');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!open) return;
    void load();
    const timer = setInterval(() => void load(), REFRESH_INTERVAL);
    return () => clearInterval(timer);
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40" data-testid="activity-panel-layer">
      {/* 遮罩（点击关闭） */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      {/* 滑出面板：只动 transform */}
      <aside
        className="absolute right-0 top-0 flex h-full w-80 flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-[var(--shadow-3)] transition-transform duration-200"
        style={{ transform: 'translateX(0)', animation: 'vh-activity-in 200ms var(--ease) 1' }}
        data-testid="activity-panel"
      >
        <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
          <Sparkles size={15} className="text-[var(--gold)]" />
          <div>
            <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">AI 活动</h2>
            <p className="text-[10px] text-[var(--text-tertiary)]">IDE 里的 Agent 最近读了什么</p>
          </div>
          <div className="flex-1" />
          <button className="vh-icon-btn" onClick={onClose} title="关闭（Esc）" data-testid="activity-panel-close">
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading && items.length === 0 && <p className="py-8 text-center text-xs text-[var(--text-tertiary)]">加载中…</p>}
          {!loading && items.length === 0 && (
            <div className="vh-empty" style={{ padding: '32px 8px' }}>
              <span className="vh-empty-icon">
                <Sparkles size={26} strokeWidth={1.5} />
              </span>
              <p className="vh-empty-title">还没有 AI 活动</p>
              <p className="vh-empty-hint">在密钥页创建 MCP 密钥并接入 Cursor / Windsurf 后，Agent 的每次调用都会显示在这里</p>
            </div>
          )}
          <ul className="space-y-2">
            {items.map((it) => (
              <li
                key={it.id}
                className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2.5"
                data-testid="activity-item"
              >
                <div className="flex items-center gap-1.5">
                  <code className="text-[12px] font-medium text-[var(--text-primary)]">{it.tool ?? it.event_type}</code>
                  {it.result === 'error' && (
                    <span className="rounded-full bg-[var(--danger)]/15 px-1.5 py-0.5 text-[10px] text-[var(--danger)]">失败</span>
                  )}
                  <div className="flex-1" />
                  <span className="text-[10px] text-[var(--text-tertiary)]" title={new Date(it.created_at).toLocaleString()}>
                    {relativeTime(it.created_at)}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--text-tertiary)]">
                  {it.key_name ? (
                    <span className="flex items-center gap-1">
                      <Sparkles size={9} className="text-[var(--gold)]" />
                      {it.key_name}
                      {it.key_prefix && <code className="opacity-70">{it.key_prefix}…</code>}
                    </span>
                  ) : (
                    <span>本地模式（stdio）</span>
                  )}
                  {typeof it.latency_ms === 'number' && <span className="ml-auto">{it.latency_ms}ms</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
