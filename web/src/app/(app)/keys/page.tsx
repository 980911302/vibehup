'use client';

import { useEffect, useState } from 'react';
import { KeyRound, Plus, RotateCw, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { CreateKeyWizard, KeyUsageChart, SCOPE_TOOLS } from '@/components/keys/KeyWizard';
import type { ApiKeyView, KeyUsage } from '@/lib/api-types';

const STATUS_LABEL: Record<ApiKeyView['status'], string> = {
  active: '活跃',
  expired: '已过期',
  revoked: '已撤销',
};

const STATUS_COLOR: Record<ApiKeyView['status'], string> = {
  active: 'bg-[var(--ok)]/15 text-[var(--ok)]',
  expired: 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]',
  revoked: 'bg-[var(--danger)]/15 text-[var(--danger)]',
};

/** MCP 密钥页（步骤 07 §7.5） */
export default function KeysPage() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';

  const [keys, setKeys] = useState<ApiKeyView[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [usage, setUsage] = useState<KeyUsage | null>(null);

  const load = async () => {
    try {
      setKeys(await api.listApiKeys());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载失败');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeKeys = keys.filter((k) => k.status === 'active');
  const peakQpm = keys.length > 0 ? Math.max(...keys.map((k) => k.rate_limit)) : 0;

  const rotate = async (id: string) => {
    try {
      const r = await api.rotateApiKey(id);
      await load();
      toast.success('已轮换，旧密钥 24 小时宽限期', {
        action: { label: '复制新密钥', onClick: () => void navigator.clipboard.writeText(r.key) },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '轮换失败');
    }
  };

  const revoke = async (id: string) => {
    await api.revokeApiKey(id);
    await load();
    toast.success('已撤销，调用方将立即失效');
  };

  const openUsage = async (id: string) => {
    setDetailId(detailId === id ? null : id);
    setUsage(null);
    if (detailId !== id) {
      try {
        setUsage(await api.keyUsage(id, 30));
      } catch {
        // 忽略
      }
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Bento 概览 */}
      <div className="grid grid-cols-2 gap-3 border-b border-[var(--border-subtle)] px-4 py-3 lg:grid-cols-4">
        <Bento label="活跃密钥" value={activeKeys.length} suffix={`/ ${keys.length}`} />
        <Bento label="峰值 QPM" value={peakQpm} />
        <Bento label=" scope 种类" value={new Set(keys.flatMap((k) => k.scopes)).size} />
        <Bento
          label="状态"
          value={activeKeys.length > 0 ? '正常' : '无可用'}
          accent={activeKeys.length > 0 ? 'var(--ok)' : 'var(--warn)'}
        />
      </div>

      <div className="flex items-center gap-2 px-4 py-2">
        <span className="text-xs text-[var(--text-tertiary)]">MCP 密钥即 API Key——IDE Agent 消费上下文的唯一凭据</span>
        <div className="flex-1" />
        {isAdmin && (
          <button className="vh-btn h-8 text-xs" onClick={() => setWizardOpen(true)} data-testid="create-key">
            <Plus size={13} />
            创建密钥
          </button>
        )}
      </div>

      {/* 表格 */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <table className="w-full text-sm" data-testid="keys-table">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] text-left text-xs text-[var(--text-tertiary)]">
              <th className="pb-2 pl-2 font-medium">名称</th>
              <th className="pb-2 font-medium">密钥</th>
              <th className="pb-2 font-medium">权限</th>
              <th className="pb-2 font-medium">配额</th>
              <th className="pb-2 font-medium">最后使用</th>
              <th className="pb-2 font-medium">状态</th>
              {isAdmin && <th className="pb-2 pr-2 text-right font-medium">操作</th>}
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <>
                <tr key={k.id} className="border-b border-[var(--border-subtle)]/50 hover:bg-[var(--bg-panel)]" data-testid="key-row">
                  <td className="py-2.5 pl-2 font-medium text-[var(--text-primary)]">{k.name}</td>
                  <td className="py-2.5">
                    <code className="rounded bg-[var(--bg-elevated)] px-2 py-1 font-mono text-[11px] text-[var(--text-tertiary)]">{k.masked}</code>
                  </td>
                  <td className="py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <span key={s} className="rounded bg-[var(--brand-soft)] px-1.5 py-0.5 text-[10px] text-[var(--brand)]" title={SCOPE_TOOLS[s]?.join(' · ')}>{s}</span>
                      ))}
                    </div>
                  </td>
                  <td className="py-2.5">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                      <div className="h-full rounded-full bg-[var(--gold)]" style={{ width: '30%' }} />
                    </div>
                    <span className="text-[10px] text-[var(--text-tertiary)]">{k.rate_limit} QPM</span>
                  </td>
                  <td className="py-2.5 text-[11px] text-[var(--text-tertiary)]">
                    {k.last_used_at ? k.last_used_at.slice(5, 16).replace('T', ' ') : '从未使用'}
                    {k.last_used_at && new Date(k.last_used_at).getTime() < Date.now() - 7 * 86400000 && (
                      <span className="ml-1 text-[var(--warn)]">闲置</span>
                    )}
                  </td>
                  <td className="py-2.5">
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px]', STATUS_COLOR[k.status])}>{STATUS_LABEL[k.status]}</span>
                  </td>
                  {isAdmin && (
                    <td className="py-2.5 pr-2">
                      <div className="flex items-center justify-end gap-1.5">
                        <button className="vh-btn ghost h-7 text-xs" onClick={() => void openUsage(k.id)}>用量</button>
                        {k.status === 'active' && (
                          <>
                            <button className="vh-btn ghost h-7 text-xs" onClick={() => void rotate(k.id)} title="轮换（旧密钥 24h 宽限）">
                              <RotateCw size={12} />
                            </button>
                            <button className="vh-btn ghost h-7 text-xs text-[var(--danger)]" onClick={() => void revoke(k.id)} title="立即撤销">
                              <Trash2 size={12} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
                {detailId === k.id && (
                  <tr key={`${k.id}-usage`}>
                    <td colSpan={7} className="bg-[var(--bg-panel)] px-4 py-3">
                      <KeyUsageChart keyId={k.id} />
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
        {keys.length === 0 && (
          <div className="vh-empty">
            <span className="vh-empty-icon"><KeyRound size={32} /></span>
            <p className="vh-empty-title">还没有 MCP 密钥</p>
            <p className="vh-empty-hint">创建密钥后即可在 Cursor / Windsurf 中连接 VibeHub</p>
          </div>
        )}
      </div>

      <CreateKeyWizard open={wizardOpen} onOpenChange={setWizardOpen} onCreated={load} />
    </div>
  );
}

function Bento({ label, value, suffix, accent }: { label: string; value: string | number; suffix?: string; accent?: string }) {
  return (
    <div className="rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3.5 py-2.5">
      <p className="text-[11px] text-[var(--text-tertiary)]">{label}</p>
      <p className="mt-0.5 text-xl font-semibold" style={{ color: accent ?? 'var(--text-primary)' }}>
        {value}
        {suffix && <span className="ml-1 text-xs font-normal text-[var(--text-tertiary)]">{suffix}</span>}
      </p>
    </div>
  );
}
