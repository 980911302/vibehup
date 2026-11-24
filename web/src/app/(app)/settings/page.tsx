'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, KeyRound, LogOut, Moon, ShieldCheck, Sun } from 'lucide-react';
import { api } from '@/lib/api';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { PasswordCard } from '@/components/settings/PasswordCard';
import { GlobalSkillsCard } from '@/components/settings/GlobalSkillsCard';
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
  'h-9 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-page)] px-3 text-sm outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--brand)]';

/** 全局个人与系统设置：与单项目工作区彻底物理分离 */
export default function SettingsPage() {
  const { user, refreshUser, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const toast = useToast();
  const router = useRouter();

  const isAdmin = user?.role === 'owner' || user?.role === 'admin';
  const isOwner = user?.role === 'owner';

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
    void api
      .me()
      .then((me) => setActiveKeys(me.stats.active_keys))
      .catch(() => undefined);
  }, [user]);

  const saveName = async () => {
    if (!name.trim()) return;
    setSavingName(true);
    try {
      await api.updateMe({ name: name.trim() });
      await refreshUser();
      toast.success('个人资料已保存');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '更新失败');
    } finally {
      setSavingName(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader
        scope="global"
        title="个人与通用技能"
        actions={
          <button
            type="button"
            className="vh-btn ghost danger h-8 px-2.5 text-xs"
            onClick={async () => {
              await logout();
              router.replace('/login');
            }}
          >
            <LogOut size={13} /> 退出登录
          </button>
        }
      />

      <div className="vh-ws-scroll">
        <div className="vh-ws-container grid gap-4 lg:grid-cols-2">
          {/* 个人资料 */}
          <section className="vh-card p-5">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">个人资料</h2>
            <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">AI 经由你的密钥执行动作时会记在你名下。</p>
            <div className="mt-4 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-sm font-semibold text-[var(--brand)]">
                {(user?.name ?? '?').slice(0, 1)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--text-primary)]">{user?.name}</p>
                <p className="truncate text-xs text-[var(--text-tertiary)]">
                  {user?.email} · {ROLE_LABEL[user?.role ?? ''] ?? user?.role}
                </p>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="显示姓名"
                aria-label="名字"
              />
              <button
                type="button"
                className="vh-btn h-9 shrink-0 px-3 text-xs"
                disabled={savingName || !name.trim()}
                onClick={() => void saveName()}
              >
                保存
              </button>
            </div>
          </section>

          {/* 界面偏好与快捷密钥入口 */}
          <section className="vh-card flex flex-col justify-between p-5">
            <div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">界面主题</h2>
                  <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">默认深邃暗色，纸白适合明亮环境。</p>
                </div>
                <div className="vh-segmented">
                  <button
                    type="button"
                    className={cn('!h-7 !px-2.5 !text-xs', theme === 'midnight' && 'active')}
                    onClick={() => setTheme('midnight')}
                  >
                    <Moon size={12} className="mr-1 inline" /> 暗色
                  </button>
                  <button
                    type="button"
                    className={cn('!h-7 !px-2.5 !text-xs', theme === 'daylight' && 'active')}
                    onClick={() => setTheme('daylight')}
                  >
                    <Sun size={12} className="mr-1 inline" /> 纸白
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
              <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <KeyRound size={14} className="text-[var(--gold)]" />
                <span>当前活跃 MCP 密钥：{activeKeys === null ? '…' : `${activeKeys} 把`}</span>
              </div>
              <button
                type="button"
                className="vh-btn ghost h-8 px-2.5 text-xs"
                onClick={() => router.push('/keys')}
                data-testid="settings-keys"
              >
                管理密钥 <ArrowRight size={12} />
              </button>
            </div>
          </section>

          <PasswordCard />

          {/* 系统回收站设置 */}
          <section className="vh-card p-5">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
              <ShieldCheck size={15} /> 系统附件回收站
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">删除的附件在回收站保留天数，超期后可彻底清理。</p>
            <div className="mt-4 flex items-center gap-2">
              <input
                className={cn(inputClass, 'w-24')}
                value={trashDays}
                disabled={!isOwner}
                onChange={(e) => setTrashDays(e.target.value)}
                aria-label="附件回收站保留天数"
              />
              <span className="text-xs text-[var(--text-tertiary)]">天</span>
              {isOwner && (
                <button
                  type="button"
                  className="vh-btn h-9 px-3 text-xs"
                  onClick={async () => {
                    try {
                      await api.updateSettings({ attachment_trash_days: trashDays });
                      toast.success('已保存系统设置');
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : '保存失败');
                    }
                  }}
                >
                  保存
                </button>
              )}
            </div>
            {!isOwner && (
              <p className="mt-2 text-xs text-[var(--text-tertiary)]">
                {isAdmin ? '仅团队拥有者（Owner）可修改回收站保留天数。' : '系统参数由团队拥有者统一维护。'}
              </p>
            )}
          </section>

          {/* 团队通用技能库 */}
          <GlobalSkillsCard />
        </div>
      </div>
    </div>
  );
}
