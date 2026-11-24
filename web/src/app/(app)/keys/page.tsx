'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plug, Plus, ShieldCheck, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { CreateKeyWizard } from '@/components/keys/KeyWizard';
import { KeyRow } from '@/components/keys/KeyRow';
import { McpConfigPanel } from '@/components/keys/McpConfigPanel';
import type { ApiKeyView } from '@/lib/api-types';

/** 全局管理 · MCP 密钥：成员自助创建与轮换，管理员可审计全团队 */
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
  const [revealed, setRevealed] = useState<{ id: string; key: string } | null>(null);

  const load = useCallback(
    async (all: boolean) => {
      setLoading(true);
      try {
        setKeys(await api.listApiKeys(all));
      } catch (e) {
        toastError(e instanceof Error ? e.message : '加载密钥失败');
      } finally {
        setLoading(false);
      }
    },
    [toastError],
  );

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

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader
        scope="global"
        title="MCP 密钥"
        badge={`${activeKeys.length} 活跃`}
        subtitle="密钥即你的个人 AI 身份，自动继承本人角色权限"
        actions={
          <>
            <button type="button" className="vh-btn ghost h-8 px-2.5 text-xs" onClick={() => setConfigOpen(true)} data-testid="mcp-config">
              <Plug size={13} /> 连接配置
            </button>
            <button type="button" className="vh-btn h-8 px-2.5 text-xs" onClick={() => setWizardOpen(true)} data-testid="create-key">
              <Plus size={14} /> 创建密钥
            </button>
          </>
        }
      />

      {isAdmin && (
        <div className="vh-ws-toolbar">
          <div className="vh-segmented">
            <button type="button" className={cn('!h-7 !px-2.5 !text-xs', !teamView && 'active')} onClick={() => setTeamView(false)}>
              我的密钥
            </button>
            <button
              type="button"
              className={cn('!h-7 !px-2.5 !text-xs', teamView && 'active')}
              onClick={() => setTeamView(true)}
              data-testid="keys-team-view"
            >
              <Users size={12} className="mr-1 inline" /> 团队全部
            </button>
          </div>
          <span className="text-xs text-[var(--text-tertiary)]">
            {teamView ? '审计全团队密钥元数据与撤销状态' : '仅展示你本人创建的密钥'}
          </span>
        </div>
      )}

      <div className="vh-ws-scroll">
        <div className="vh-ws-container space-y-3">
          <section className="vh-list-surface" data-testid="keys-table">
            {loading ? (
              <div className="space-y-2 p-5">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="vh-skeleton h-12 w-full" />
                ))}
              </div>
            ) : keys.length === 0 ? (
              <div className="vh-empty">
                <span className="vh-empty-icon"><KeyRound size={22} /></span>
                <p className="vh-empty-title">还没有 MCP 密钥</p>
                <p className="vh-empty-hint">创建后即可在 Cursor、Claude Code 或 ChatGPT Work 中接入 VibeHub。</p>
                <button type="button" className="vh-btn h-8 text-xs" onClick={() => setWizardOpen(true)}>
                  <Plus size={14} /> 创建第一把密钥
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
                      onUsage: (id) => setDetailId(detailId === id ? null : id),
                    }}
                  />
                ))}
              </div>
            )}
          </section>

          <p className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
            <ShieldCheck size={13} /> 撤销立即生效；轮换保留 24 小时宽限期；AI 连接时需按 `project_slug` 指定目标项目。
          </p>
        </div>
      </div>

      <CreateKeyWizard open={wizardOpen} onOpenChange={setWizardOpen} onCreated={() => void load(teamView)} />
      <McpConfigPanel open={configOpen} keys={keys.filter((k) => canManage(k))} onClose={() => setConfigOpen(false)} />
    </div>
  );
}
