'use client';

import { Copy, Eye, KeyRound, Lock, RotateCw, ShieldOff, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ApiKeyView } from '@/lib/api-types';
import { KeyUsageChart } from './KeyWizard';

const STATUS_LABEL: Record<ApiKeyView['status'], string> = {
  active: '活跃',
  expired: '已过期',
  revoked: '已撤销',
};

const STATUS_TONE: Record<ApiKeyView['status'], string> = {
  active: 'bg-[var(--ok)]/12 text-[var(--ok)]',
  expired: 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]',
  revoked: 'bg-[var(--danger)]/12 text-[var(--danger)]',
};

function relative(iso: string | null): string {
  if (!iso) return '从未使用';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

export interface KeyRowActions {
  onReveal: (id: string) => void;
  onCopy: (text: string) => void;
  onRotate: (id: string) => void;
  onRevoke: (id: string) => void;
  onDelete: (key: ApiKeyView) => void;
  onUsage: (id: string) => void;
}

/** 密钥列表一行：元数据 + 本人/管理员操作 + 明文展开 + 用量展开。 */
export function KeyRow({
  k,
  teamView,
  currentUserId,
  canManage,
  revealedKey,
  detailOpen,
  actions,
}: {
  k: ApiKeyView;
  teamView: boolean;
  currentUserId: string | null;
  canManage: boolean;
  revealedKey: string | null;
  detailOpen: boolean;
  actions: KeyRowActions;
}) {
  return (
    <div data-testid="key-row">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
            <KeyRound size={15} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="t-title-4 truncate">{k.name}</p>
              <span className={cn('rounded px-1.5 py-0.5 text-xs', STATUS_TONE[k.status])}>
                {STATUS_LABEL[k.status]}
              </span>
              {teamView && (
                <span className="t-caption-5 text-[var(--text-tertiary)]">
                  {k.created_by === currentUserId ? '我' : k.created_by_name ?? '已移除成员'}
                </span>
              )}
            </div>
            <code className="t-mono mt-1 block truncate text-xs text-[var(--text-tertiary)]">{k.masked}</code>
          </div>
        </div>

        <div className="hidden w-32 shrink-0 md:block">
          <p className="t-caption-5 text-[var(--text-tertiary)]">配额</p>
          <p className="t-caption-1">{k.rate_limit} QPM</p>
        </div>
        <div className="hidden w-32 shrink-0 lg:block">
          <p className="t-caption-5 text-[var(--text-tertiary)]">最后使用</p>
          <p className="t-caption-1">{relative(k.last_used_at)}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button className="vh-btn ghost h-8 px-2" onClick={() => actions.onUsage(k.id)} title="查看用量">
            用量
          </button>
          <button
            className="vh-icon-btn h-8 w-8"
            onClick={() => actions.onReveal(k.id)}
            disabled={!k.can_reveal || k.status !== 'active' || !canManage}
            title={k.can_reveal ? '查看并复制明文' : '明文不可恢复，请轮换'}
            data-testid="key-reveal"
          >
            <Eye size={14} />
          </button>
          {canManage && k.status === 'active' && (
            <>
              <button
                className="vh-icon-btn h-8 w-8"
                onClick={() => actions.onRotate(k.id)}
                title="轮换（旧密钥 24 小时宽限）"
              >
                <RotateCw size={14} />
              </button>
              <button
                className="vh-icon-btn h-8 w-8"
                onClick={() => actions.onRevoke(k.id)}
                title="撤销（立即失效，保留记录）"
              >
                <ShieldOff size={14} />
              </button>
            </>
          )}
          {canManage && (
            <button
              className="vh-icon-btn h-8 w-8 text-[var(--danger)]"
              onClick={() => actions.onDelete(k)}
              title="彻底删除（不可恢复）"
              data-testid="key-delete"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {revealedKey !== null && (
        <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-inset)] px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <code className="t-mono min-w-0 flex-1 overflow-x-auto rounded-lg bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-secondary)]">
              {revealedKey}
            </code>
            <button className="vh-btn h-9" onClick={() => actions.onCopy(revealedKey)}>
              <Copy size={13} /> 复制
            </button>
          </div>
          <p className="t-caption-5 mt-2 flex items-center gap-1 text-[var(--text-tertiary)]">
            <Lock size={11} /> 明文只存在本页面内存中，刷新即消失；请勿粘贴到公开渠道或提交进仓库。
          </p>
        </div>
      )}

      {detailOpen && (
        <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-inset)] px-5 py-4">
          <KeyUsageChart keyId={k.id} />
        </div>
      )}
    </div>
  );
}
