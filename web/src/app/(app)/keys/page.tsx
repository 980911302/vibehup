'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plug, Plus, ShieldCheck, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { CreateKeyWizard } from '@/components/keys/KeyWizard';
import { KeyRow } from '@/components/keys/KeyRow';
import { McpConfigPanel } from '@/components/keys/McpConfigPanel';
import type { ApiKeyView } from '@/lib/api-types';

/**
 * 我的密钥（R89）：每个成员自助创建，密钥即个人 AI 身份。
 * 管理员可切「团队」审计全部；普通成员只看到自己的。
 */
export default function KeysPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { error: toastError } = toast;
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';

  const [keys, setKeys] = useState<ApiKeyView[]>([]);
  const [loading, setLoading] = useState(true);
  const [teamView, setTeamView] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  /** 明文只放内存：刷新即消失，不进 localStorage（R87） */
  const [revealed, setRevealed] = useState<{ id: string; key: string } | null>(null);

  const load = useCallback(async (all: boolean) => {
    setLoading(true);
    try {
      setKeys(await api.listApiKeys(all));
    } catch (e) {
      toastError(e instanceof Error ? e.message : '加载密钥失败');
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    void load(teamView);
  }, [load, teamView]);

  const activeKeys = keys.filter((k) => k.status === 'active');
  const canManage = (k: ApiKeyView) => isAdmin || k.created_by === user?.id;

  const rotate = async (id: string) => {
    try {
      const r = await api.rotateApiKey(id);
      await load(teamView);
      toast.success('已轮换，旧密钥 24 小时宽限期', {
        action: { label: '复制新密钥', onClick: () => void navigator.clipboard.writeText(r.key) },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '轮换失败');
    }
  };

  const revoke = async (id: string) => {
    try {
      await api.revokeApiKey(id);
      await load(teamView);
      toast.success('已撤销，调用方立即失效');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '撤销失败');
    }
  };

  const reveal = async (id: string) => {
    if (revealed?.id === id) {
      setRevealed(null);
      return;
    }
    try {
      const r = await api.revealApiKey(id);
      setRevealed({ id, key: r.key });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '无法查看该密钥明文');
    }
  };

  const remove = async (k: ApiKeyView) => {
    const ok = window.confirm(
      `确认彻底删除密钥「${k.name}」？\n\n删除后不可恢复，调用方立即失效；历史用量保留但不再归属该密钥。\n只想让它失效但保留记录，请用「撤销」。`,
    );
    if (!ok) return;
    try {
      await api.deleteApiKey(k.id);
      if (revealed?.id === k.id) setRevealed(null);
      await load(teamView);
      toast.success('已彻底删除');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  const copyKey = (text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => toast.success('已复制密钥'),
      () => toast.error('复制失败，请手动选中复制'),
    );
  };

  const openUsage = async (id: string) => {
    setDetailId(detailId === id ? null : id);
  };

  return (
    <div className="vh-page">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="t-caption-4 flex items-center gap-2 text-[var(--text-tertiary)]">
            <KeyRound size={14} /> 设置 · 我的密钥
          </p>
          <h1 className="t-heading-4 mt-2">密钥代表你</h1>
          <p className="t-body-3 mt-2 max-w-[680px] text-[var(--text-secondary)]">
            AI 通过密钥替你干活。每个客户端一把，密钥自动继承你的角色能力；看板上会显示「你 · 密钥名」。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="vh-btn ghost" onClick={() => setConfigOpen(true)} data-testid="mcp-config">
            <Plug size={15} /> 连接客户端
          </button>
          <button className="vh-btn" onClick={() => setWizardOpen(true)} data-testid="create-key">
            <Plus size={15} /> 创建密钥
          </button>
        </div>
      </header>

      {/* 概览 */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Bento label="活跃密钥" value={`${activeKeys.length}`} suffix={teamView ? `全团队 ${keys.length}` : `共 ${keys.length}`} />
        <Bento label="角色" value={user?.name ?? ''} suffix={isAdmin ? '管理员可审计团队' : '个人身份'} />
        <Bento
          label="安全状态"
          value={activeKeys.length > 0 ? '正常' : '无可用密钥'}
          suffix={activeKeys.length > 0 ? '可随时轮换' : '创建一把开始'}
          accent={activeKeys.length > 0 ? 'var(--ok)' : 'var(--warn)'}
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {isAdmin && (
          <div className="vh-segmented">
            <button className={cn(!teamView && 'active')} onClick={() => setTeamView(false)}>
              我的
            </button>
            <button className={cn(teamView && 'active')} onClick={() => setTeamView(true)} data-testid="keys-team-view">
              <Users size={13} className="mr-1 inline" /> 团队
            </button>
          </div>
        )}
        <p className="t-caption-5 text-[var(--text-tertiary)]">
          {teamView ? '全团队密钥元数据；可撤销与审计，明文默认不展示' : '只显示你自己的密钥；创建后请先复制到 IDE'}
        </p>
      </div>

      <section className="vh-card mt-3 overflow-hidden" data-testid="keys-table">
        {loading ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="vh-skeleton h-14 w-full" />
            ))}
          </div>
        ) : keys.length === 0 ? (
          <div className="vh-empty">
            <span className="vh-empty-icon">
              <KeyRound size={22} />
            </span>
            <p className="vh-empty-title">还没有密钥</p>
            <p className="vh-empty-hint">创建后即可在 Cursor、ChatGPT Work 或 CI 里连接 VibeHub，AI 的动作会记在你名下。</p>
            <button className="vh-btn" onClick={() => setWizardOpen(true)}>
              <Plus size={15} /> 创建第一把密钥
            </button>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)]">
            {keys.map((k) => (
              <KeyRow
                key={k.id}
                k={k}
                teamView={teamView}
                currentUserId={user?.id ?? null}
                canManage={canManage(k)}
                revealedKey={revealed?.id === k.id ? revealed.key : null}
                detailOpen={detailId === k.id}
                actions={{
                  onReveal: (id) => void reveal(id),
                  onCopy: copyKey,
                  onRotate: (id) => void rotate(id),
                  onRevoke: (id) => void revoke(id),
                  onDelete: (key) => void remove(key),
                  onUsage: (id) => void openUsage(id),
                }}
              />
            ))}
          </div>
        )}
      </section>

      <p className="t-caption-5 mt-4 flex items-center gap-1.5 text-[var(--text-tertiary)]">
        <ShieldCheck size={13} /> 撤销立即生效；轮换保留 24 小时宽限期；删除会移除记录。
      </p>

      <CreateKeyWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCreated={() => void load(teamView)}
      />
      <McpConfigPanel open={configOpen} keys={keys.filter((k) => canManage(k))} onClose={() => setConfigOpen(false)} />
    </div>
  );
}

function Bento({
  label,
  value,
  suffix,
  accent,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  accent?: string;
}) {
  return (
    <div className="vh-card p-4">
      <p className="t-caption-4 text-[var(--text-tertiary)]">{label}</p>
      <p className="t-title-2 mt-1 truncate" style={{ color: accent ?? 'var(--text-primary)' }}>
        {value}
      </p>
      {suffix && <p className="t-caption-5 mt-1 text-[var(--text-tertiary)]">{suffix}</p>}
    </div>
  );
}
