'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Bell, CheckCheck, Handshake, Loader2, RotateCcw, ShieldCheck, UserPlus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { formatTime, type NotificationItem } from '@/lib/api-types';
import { useVibeHub } from '@/hooks/use-vibehub';

function IconFor({ type }: { type: string }) {
  const cls = 'h-4 w-4';
  if (type === 'handoff') return <Handshake className={cls} />;
  if (type === 'reopen') return <RotateCcw className={cls} />;
  if (type === 'assigned') return <UserPlus className={cls} />;
  return <ShieldCheck className={cls} />;
}

/** 顶栏通知抽屉（R90）：交接/待验收/打回，点一条直达工作项。 */
export function NotificationPanel({
  open,
  onClose,
  onUnreadChange,
}: {
  open: boolean;
  onClose: () => void;
  onUnreadChange: (n: number) => void;
}) {
  const router = useRouter();
  const store = useVibeHub();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    api
      .listNotifications(false, 30)
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
  }, [open, onUnreadChange]);

  if (!open) return null;

  const markAll = async () => {
    await api.markAllNotificationsRead().catch(() => undefined);
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
    if (n.project_id && n.project_id !== store.currentProject?.id) store.selectProject(n.project_id);
    if (n.entity_type === 'bug' && n.entity_id) router.push(`/work/bugs?bug=${n.entity_id}`);
    if (n.entity_type === 'task' && n.entity_id) router.push(`/work/tasks?task=${n.entity_id}`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="absolute right-0 top-0 flex h-full w-full max-w-[380px] flex-col border-l border-[var(--border-strong)] bg-[var(--bg-panel)] shadow-[var(--shadow-3)]"
        onClick={(e) => e.stopPropagation()}
        data-testid="notification-panel"
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <div>
            <p className="t-title-3 flex items-center gap-2"><Bell size={16} /> 通知</p>
            <p className="t-caption-5 mt-0.5 text-[var(--text-tertiary)]">{unread > 0 ? `${unread} 条未读` : '都看过了'}</p>
          </div>
          <div className="flex items-center gap-1">
            {unread > 0 && (
              <button className="t-caption-4 flex items-center gap-1 rounded-md px-2 py-1 text-[var(--accent-color)] hover:bg-[var(--bg-elevated)]" onClick={() => void markAll()}>
                <CheckCheck size={13} /> 全部已读
              </button>
            )}
            <button className="vh-icon-btn" onClick={onClose} aria-label="关闭通知"><X size={16} /></button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-[var(--text-tertiary)]" /></div>}
          {!loading && items.length === 0 && (
            <div className="px-6 py-16 text-center">
              <Bell size={24} className="mx-auto text-[var(--text-tertiary)]" />
              <p className="t-caption-2 mt-3 text-[var(--text-tertiary)]">还没有通知；交接、待验收、打回会出现在这里。</p>
            </div>
          )}
          {!loading && items.map((n) => (
            <button
              key={n.id}
              className="flex w-full items-start gap-3 border-b border-[var(--border-subtle)] px-4 py-3 text-left transition-colors hover:bg-[var(--bg-elevated)]"
              onClick={() => void openItem(n)}
              data-testid="notification-item"
            >
              <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${n.read_at ? 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]' : 'bg-[var(--brand-soft)] text-[var(--accent-color)]'}`}>
                <IconFor type={n.type} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={`t-caption-1 block truncate ${n.read_at ? 'text-[var(--text-secondary)]' : 'font-semibold text-[var(--text-primary)]'}`}>{n.title}</span>
                  {!n.read_at && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-color)]" />}
                </span>
                {n.body && <span className="t-caption-5 mt-0.5 block truncate text-[var(--text-tertiary)]">{n.body}</span>}
                <span className="t-caption-5 mt-1 block text-[var(--text-tertiary)]">{formatTime(n.created_at)}</span>
              </span>
              <ArrowRight size={13} className="mt-2 shrink-0 text-[var(--text-tertiary)]" />
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
