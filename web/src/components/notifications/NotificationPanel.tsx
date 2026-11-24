'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Bell, CheckCheck, Handshake, Loader2, RotateCcw, ShieldCheck, UserPlus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { formatTime, type NotificationItem } from '@/lib/api-types';
import { useWorkOverlay } from '@/components/work/WorkItemOverlay';

function IconFor({ type }: { type: string }) {
  const cls = 'h-4 w-4';
  if (type === 'handoff') return <Handshake className={cls} />;
  if (type === 'reopen') return <RotateCcw className={cls} />;
  if (type === 'assigned') return <UserPlus className={cls} />;
  return <ShieldCheck className={cls} />;
}

/** 通知抽屉（严格按当前工作区项目过滤；点击原地弹出详情，不乱跳页） */
export function NotificationPanel({
  open,
  projectId,
  projectName,
  onClose,
  onUnreadChange,
}: {
  open: boolean;
  projectId: string | null;
  projectName: string | null;
  onClose: () => void;
  onUnreadChange: (n: number) => void;
}) {
  const overlay = useWorkOverlay();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (!projectId) {
      setItems([]);
      setUnread(0);
      onUnreadChange(0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .listNotifications(false, 30, projectId)
      .then((r) => {
        if (cancelled) return;
        setItems(r.items);
        setUnread(r.unread);
        onUnreadChange(r.unread);
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, projectId, onUnreadChange]);

  if (!open) return null;

  const markAll = async () => {
    if (!projectId) return;
    await api.markAllNotificationsRead(projectId).catch(() => undefined);
    setItems((list) => list.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    setUnread(0);
    onUnreadChange(0);
  };

  const openItem = async (n: NotificationItem) => {
    if (!n.read_at) {
      await api.markNotificationRead(n.id).catch(() => undefined);
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      setUnread((v) => {
        const next = Math.max(0, v - 1);
        onUnreadChange(next);
        return next;
      });
    }
    onClose();
    if ((n.entity_type === 'bug' || n.entity_type === 'task') && n.entity_id) {
      overlay.openItem(n.entity_type, n.entity_id);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-xs" onClick={onClose}>
      <aside
        className="absolute right-0 top-0 flex h-full w-full max-w-[380px] flex-col border-l border-[var(--border-strong)] bg-[var(--bg-panel)] shadow-[var(--shadow-3)]"
        onClick={(e) => e.stopPropagation()}
        data-testid="notification-panel"
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <Bell size={15} /> 项目通知
            </p>
            <p className="mt-0.5 truncate text-xs text-[var(--text-tertiary)]">
              {projectName ? `${projectName} · ` : ''}
              {unread > 0 ? `${unread} 条未读` : '全部已读'}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {unread > 0 && (
              <button
                type="button"
                className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--brand)] hover:bg-[var(--bg-elevated)]"
                onClick={() => void markAll()}
              >
                <CheckCheck size={13} /> 全部已读
              </button>
            )}
            <button type="button" className="vh-icon-btn" onClick={onClose} aria-label="关闭通知">
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--text-tertiary)]" />
            </div>
          )}
          {!loading && items.length === 0 && (
            <div className="px-6 py-16 text-center">
              <Bell size={22} className="mx-auto text-[var(--text-tertiary)]" />
              <p className="mt-3 text-xs text-[var(--text-tertiary)]">
                当前项目暂无通知；交接、待验收、打回会实时出现在这里。
              </p>
            </div>
          )}
          {!loading &&
            items.map((n) => (
              <button
                key={n.id}
                type="button"
                className="flex w-full cursor-pointer items-start gap-3 border-b border-[var(--border-subtle)] px-4 py-3 text-left transition-colors hover:bg-[var(--bg-elevated)]"
                onClick={() => void openItem(n)}
                data-testid="notification-item"
              >
                <span
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                    n.read_at
                      ? 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]'
                      : 'bg-[var(--brand-soft)] text-[var(--brand)]'
                  }`}
                >
                  <IconFor type={n.type} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span
                      className={`block truncate text-xs ${
                        n.read_at ? 'text-[var(--text-secondary)]' : 'font-semibold text-[var(--text-primary)]'
                      }`}
                    >
                      {n.title}
                    </span>
                    {!n.read_at && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />}
                  </span>
                  {n.body && <span className="mt-0.5 block truncate text-xs text-[var(--text-tertiary)]">{n.body}</span>}
                  <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">{formatTime(n.created_at)}</span>
                </span>
                <ArrowRight size={13} className="mt-1.5 shrink-0 text-[var(--text-tertiary)]" />
              </button>
            ))}
        </div>
      </aside>
    </div>
  );
}
