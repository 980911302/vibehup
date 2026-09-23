'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Moon, Sun } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { useToast } from '@/lib/toast';
import { NAV_SIMPLE_KEY, readNavFlag, writeNavFlag } from '@/lib/nav-prefs';
import { cn } from '@/lib/utils';

const AVATAR_COLORS = [
  '#4C7DD9', '#3ECF8E', '#D4A76A', '#F2617A',
  '#AF52DE', '#5AC8FA', '#F2A95C', '#8A94A6',
];

/** 设置页（步骤 07 §7.7）：个人 / 偏好 / 系统 */
export default function SettingsPage() {
  const { user, refreshUser, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const toast = useToast();
  const router = useRouter();

  const [name, setName] = useState('');
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [trashDays, setTrashDays] = useState('30');
  const [savingName, setSavingName] = useState(false);
  const [simpleMode, setSimpleMode] = useState(false);

  const isOwner = user?.role === 'owner';

  useEffect(() => {
    if (user) setName(user.name);
    setSimpleMode(readNavFlag(NAV_SIMPLE_KEY));
    void api.getSettings().then((s) => {
      if (s.attachment_trash_days) setTrashDays(s.attachment_trash_days);
    });
  }, [user]);

  const saveName = async () => {
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

  const changePassword = async () => {
    try {
      await api.changePassword(oldPwd, newPwd);
      setOldPwd('');
      setNewPwd('');
      toast.success('密码已修改，其他设备需重新登录');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '修改失败');
    }
  };

  const strength = (p: string) => {
    let s = 0;
    if (p.length >= 8) s++;
    if (/[a-zA-Z]/.test(p) && /\d/.test(p)) s++;
    if (p.length >= 12) s++;
    return Math.min(s, 2);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      {/* 个人资料 */}
      <section className="rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
        <h2 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">个人资料</h2>
        <div className="mb-4 flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--brand-soft)] text-xl font-semibold text-[var(--brand)]">
            {user?.name.slice(0, 1)}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {AVATAR_COLORS.map((c) => (
              <button
                key={c}
                className="h-6 w-6 rounded-full border-2 border-transparent transition-transform hover:scale-110 cursor-pointer"
                style={{ background: c }}
                onClick={() => toast.info('头像色板：阶段二开放')}
              />
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <input
            className="h-9 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-3 text-sm outline-none focus:border-[var(--brand)]"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="名字"
          />
          <button className="vh-btn" disabled={savingName || !name.trim()} onClick={saveName}>保存</button>
        </div>
      </section>

      {/* 修改密码 */}
      <section className="rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
        <h2 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">修改密码</h2>
        <div className="space-y-2">
          <input
            type="password"
            className="h-9 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-3 text-sm outline-none focus:border-[var(--brand)]"
            placeholder="当前密码"
            value={oldPwd}
            onChange={(e) => setOldPwd(e.target.value)}
          />
          <input
            type="password"
            className="h-9 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-3 text-sm outline-none focus:border-[var(--brand)]"
            placeholder="新密码（至少 8 位，含字母和数字）"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
          />
          {newPwd && (
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span key={i} className={cn('h-1 w-8 rounded-full', strength(newPwd) > i ? (strength(newPwd) === 2 ? 'bg-[var(--ok)]' : 'bg-[var(--warn)]') : 'bg-[var(--bg-elevated)]')} />
                ))}
              </div>
              <span className="text-[11px] text-[var(--text-tertiary)]">{['弱', '中', '强'][strength(newPwd)]}</span>
            </div>
          )}
          <button className="vh-btn" disabled={!oldPwd || !newPwd} onClick={changePassword}>修改密码</button>
        </div>
      </section>

      {/* 偏好 */}
      <section className="rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
        <h2 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">偏好</h2>
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--text-secondary)]">主题</span>
          <div className="flex gap-1 rounded-lg bg-[var(--bg-elevated)] p-0.5">
            <button
              className={cn('flex items-center gap-1.5 rounded-md px-3 py-1 text-xs cursor-pointer', theme === 'midnight' ? 'bg-[var(--bg-page)] text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]')}
              onClick={() => setTheme('midnight')}
            >
              <Moon size={12} />
              暗色
            </button>
            <button
              className={cn('flex items-center gap-1.5 rounded-md px-3 py-1 text-xs cursor-pointer', theme === 'daylight' ? 'bg-[var(--bg-page)] text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]')}
              onClick={() => setTheme('daylight')}
            >
              <Sun size={12} />
              纸白
            </button>
          </div>
        </div>
        {/* 简洁模式（卡片 35）：侧边栏只保留日常五项，隐藏「更多」入口 */}
        <div className="mt-4 flex items-center justify-between">
          <div>
            <span className="text-sm text-[var(--text-secondary)]">简洁模式</span>
            <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">侧边栏只显示看板、文件、随手记、任务、项目；设置等收进命令面板（⌘K）直达</p>
          </div>
          <button
            role="switch"
            aria-checked={simpleMode}
            className={cn(
              'relative h-5 w-9 shrink-0 rounded-full border transition-colors cursor-pointer',
              simpleMode ? 'border-[var(--gold)] bg-[var(--gold-bg)]' : 'border-[var(--border-strong)] bg-[var(--bg-elevated)]',
            )}
            onClick={() => {
              const next = !simpleMode;
              setSimpleMode(next);
              writeNavFlag(NAV_SIMPLE_KEY, next);
              toast.success(next ? '已开启简洁模式' : '已关闭简洁模式');
            }}
            data-testid="simple-mode-switch"
          >
            <span
              className={cn(
                'absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all',
                simpleMode ? 'left-4.5 bg-[var(--gold)]' : 'left-0.5 bg-[var(--text-tertiary)]',
              )}
            />
          </button>
        </div>
      </section>

      {/* 系统（Owner） */}
      {isOwner && (
        <section className="rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <h2 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">系统</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--text-secondary)]">附件回收站保留天数</p>
              <p className="text-[11px] text-[var(--text-tertiary)]">删除的附件文件在回收站保留指定天数后自动清理</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                className="h-9 w-20 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-2 text-sm outline-none"
                value={trashDays}
                onChange={(e) => setTrashDays(e.target.value)}
              />
              <button
                className="vh-btn"
                onClick={async () => {
                  await api.updateSettings({ attachment_trash_days: trashDays });
                  toast.success('已保存');
                }}
              >
                保存
              </button>
            </div>
          </div>
        </section>
      )}

      {/* 危险区 */}
      <section className="rounded-[14px] border border-[var(--danger)]/40 p-5">
        <h2 className="mb-2 text-sm font-semibold text-[var(--danger)]">退出登录</h2>
        <p className="mb-3 text-xs text-[var(--text-tertiary)]">退出后需重新登录才能继续使用</p>
        <button
          className="vh-btn ghost text-xs text-[var(--danger)]"
          onClick={async () => {
            await logout();
            router.replace('/login');
          }}
        >
          退出登录
        </button>
      </section>
    </div>
  );
}
