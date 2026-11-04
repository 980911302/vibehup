'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BarChart3,
  FolderKanban,
  KeyRound,
  LogOut,
  Moon,
  ShieldCheck,
  Sun,
  UserRound,
  Users,
} from 'lucide-react';
import { api } from '@/lib/api';
import { PasswordCard } from '@/components/settings/PasswordCard';
import { TeamCard } from '@/components/settings/TeamCard';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';

const ROLE_LABEL: Record<string, string> = {
  owner: '拥有者',
  admin: '管理员',
  member: '成员',
  viewer: '只读成员',
};

const inputClass =
  'h-10 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-page)] px-3 text-sm outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent-color)]';

/** 设置（R89）：我的 / 团队；密钥自助，Admin+ 管成员、项目与系统。 */
export default function SettingsPage() {
  const { user, refreshUser, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const toast = useToast();
  const router = useRouter();

  const isAdmin = user?.role === 'owner' || user?.role === 'admin';
  const isOwner = user?.role === 'owner';

  const [tab, setTab] = useState<'me' | 'team'>('me');
  const [name, setName] = useState('');
  const [trashDays, setTrashDays] = useState('30');
  const [activeKeys, setActiveKeys] = useState<number | null>(null);
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    if (user) setName(user.name);
    void api
      .getSettings()
      .then((s) => {
        if (s.attachment_trash_days) setTrashDays(s.attachment_trash_days);
      })
      .catch(() => undefined);
    void api.me().then((me) => setActiveKeys(me.stats.active_keys)).catch(() => undefined);
  }, [user]);

  const saveName = async () => {
    if (!name.trim()) return;
    setSavingName(true);
    try {
      await api.updateMe({ name: name.trim() });
      await refreshUser();
      toast.success('资料已更新');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '更新失败');
    } finally {
      setSavingName(false);
    }
  };

  return (
    <div className="vh-page">
      <header>
        <p className="t-caption-4 flex items-center gap-2 text-[var(--text-tertiary)]">
          <ShieldCheck size={14} /> 设置
        </p>
        <h1 className="t-heading-4 mt-2">我的与团队</h1>
        <p className="t-body-3 mt-2 max-w-[680px] text-[var(--text-secondary)]">
          个人资料、密钥与偏好在这里；成员、项目与系统由管理员统一管。
        </p>
      </header>

      {isAdmin && (
        <div className="vh-segmented mt-8">
          <button className={cn(tab === 'me' && 'active')} onClick={() => setTab('me')} data-testid="settings-me">
            <UserRound size={13} className="mr-1 inline" /> 我的
          </button>
          <button className={cn(tab === 'team' && 'active')} onClick={() => setTab('team')} data-testid="settings-team">
            <Users size={13} className="mr-1 inline" /> 团队
          </button>
        </div>
      )}

      {tab === 'me' ? (
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          {/* 个人资料 */}
          <section className="vh-card p-6">
            <h2 className="t-title-3">个人资料</h2>
            <p className="t-caption-5 mt-1 text-[var(--text-tertiary)]">AI 的动作会记在你名下，用真名方便团队辨认。</p>
            <div className="mt-4 flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-lg font-semibold text-[var(--accent-color)]">
                {(user?.name ?? '?').slice(0, 1)}
              </span>
              <div className="min-w-0">
                <p className="t-title-4 truncate">{user?.name}</p>
                <p className="t-caption-5 truncate text-[var(--text-tertiary)]">{user?.email}</p>
                <p className="t-caption-4 mt-0.5 text-[var(--accent-color)]">{ROLE_LABEL[user?.role ?? ''] ?? user?.role}</p>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="名字"
                aria-label="名字"
              />
              <button className="vh-btn shrink-0" disabled={savingName || !name.trim()} onClick={() => void saveName()}>
                保存
              </button>
            </div>
          </section>

          {/* 密钥 */}
          <section className="vh-card p-6">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="t-title-3">密钥与连接</h2>
                <p className="t-caption-5 mt-1 text-[var(--text-tertiary)]">每个客户端一把；密钥即你的个人 AI 身份。</p>
              </div>
              <KeyRound size={18} className="text-[var(--text-tertiary)]" />
            </div>
            <p className="t-heading-5 mt-4">{activeKeys === null ? '…' : activeKeys} 把活跃密钥</p>
            <p className="t-caption-5 mt-1 text-[var(--text-tertiary)]">密钥自动继承你的角色；撤销立即生效，轮换保留 24 小时宽限。</p>
            <button className="vh-btn mt-4" onClick={() => router.push('/keys')} data-testid="settings-keys">
              管理我的密钥 <ArrowRight size={14} />
            </button>
          </section>

          <PasswordCard />

          {/* 偏好 */}
          <section className="vh-card p-6">
            <h2 className="t-title-3">偏好</h2>
            <p className="t-caption-5 mt-1 text-[var(--text-tertiary)]">默认暗色；纸白适合白天与打印。</p>
            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="t-caption-1 text-[var(--text-secondary)]">主题</span>
              <div className="vh-segmented">
                <button className={cn(theme === 'midnight' && 'active')} onClick={() => setTheme('midnight')}>
                  <Moon size={13} className="mr-1 inline" /> 暗色
                </button>
                <button className={cn(theme === 'daylight' && 'active')} onClick={() => setTheme('daylight')}>
                  <Sun size={13} className="mr-1 inline" /> 纸白
                </button>
              </div>
            </div>
            <p className="t-caption-5 mt-4 text-[var(--text-tertiary)]">
              快捷键：<span className="vh-kbd">G</span> 后按 <span className="vh-kbd">D</span> 去今日，
              <span className="vh-kbd">W</span> 去工作，<span className="vh-kbd">C</span> 去上下文。
            </p>
          </section>

          <section className="vh-card flex flex-wrap items-center justify-between gap-3 p-6 lg:col-span-2">
            <div>
              <h2 className="t-title-3">退出登录</h2>
              <p className="t-caption-5 mt-1 text-[var(--text-tertiary)]">退出后需重新登录才能继续使用。</p>
            </div>
            <button
              className="vh-btn ghost danger"
              onClick={async () => {
                await logout();
                router.replace('/login');
              }}
            >
              <LogOut size={14} /> 退出登录
            </button>
          </section>
        </div>
      ) : !isAdmin ? (
        <div className="vh-card mt-6">
          <div className="vh-empty">
            <span className="vh-empty-icon">
              <ShieldCheck size={22} />
            </span>
            <p className="vh-empty-title">团队设置需要管理员</p>
            <p className="vh-empty-hint">让拥有者或管理员把你调整为管理员后，才能管理成员、项目与系统。</p>
          </div>
        </div>
      ) : (
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          <TeamCard
            icon={Users}
            title="成员与角色"
            description="邀请成员、调整角色、移除离职人员；密钥随账号停用。"
            action="管理成员"
            onClick={() => router.push('/members')}
          />
          <TeamCard
            icon={FolderKanban}
            title="项目"
            description="新建、归档与删除项目；项目是 AI 匹配仓库的入口。"
            action="管理项目"
            onClick={() => router.push('/projects')}
          />
          <TeamCard
            icon={BarChart3}
            title="完整统计"
            description="今天产出、还剩多少、谁在做什么、按密钥归集与 14 天趋势。"
            action="看统计"
            onClick={() => router.push('/stats')}
          />
          <section className="vh-card p-6">
            <h2 className="t-title-3 flex items-center gap-2">
              <ShieldCheck size={16} /> 系统
            </h2>
            <p className="t-caption-5 mt-1 text-[var(--text-tertiary)]">附件回收站保留天数；到点自动清理。</p>
            <div className="mt-4 flex items-end gap-2">
              <input
                className={cn(inputClass, 'w-24')}
                value={trashDays}
                onChange={(e) => setTrashDays(e.target.value)}
                aria-label="附件回收站保留天数"
              />
              <button
                className="vh-btn"
                disabled={!isOwner}
                onClick={async () => {
                  try {
                    await api.updateSettings({ attachment_trash_days: trashDays });
                    toast.success('已保存');
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : '保存失败');
                  }
                }}
              >
                保存
              </button>
            </div>
            {!isOwner && <p className="t-caption-5 mt-2 text-[var(--text-tertiary)]">仅拥有者可修改系统设置。</p>}
          </section>
        </div>
      )}
    </div>
  );
}
