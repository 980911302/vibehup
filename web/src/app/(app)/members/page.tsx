'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, ShieldAlert, UserPlus, UserX } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { PublicUser, UserWithStats } from '@/lib/api-types';

const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
const ROLE_LABEL: Record<string, string> = { owner: '拥有者', admin: '管理员', member: '成员', viewer: '只读' };

/** 成员页（步骤 07 §7.6）：角色管理 + 注册开关 + Owner 转让 */
export default function MembersPage() {
  const { user: me } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const [users, setUsers] = useState<UserWithStats[]>([]);
  const [regOpen, setRegOpen] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [oneTimePwd, setOneTimePwd] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferEmail, setTransferEmail] = useState('');

  const isAdmin = me?.role === 'owner' || me?.role === 'admin';
  const isOwner = me?.role === 'owner';

  const load = async () => {
    const [list, settings] = await Promise.all([api.listUsers(), api.getSettings()]);
    setUsers(list);
    setRegOpen(settings.registration_open !== 'false');
  };

  useEffect(() => {
    if (!isAdmin) {
      router.replace('/board');
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  if (!isAdmin) return null;

  const ownerCount = users.filter((u) => u.role === 'owner' && u.status === 'active').length;
  const isLastOwner = (u: UserWithStats) => u.role === 'owner' && ownerCount <= 1;

  const changeRole = async (u: UserWithStats, role: string) => {
    await api.updateUser(u.id, { role });
    await load();
    toast.success(`${u.name} 已变更为 ${ROLE_LABEL[role]}`);
  };

  const toggleStatus = async (u: UserWithStats) => {
    const next = u.status === 'disabled' ? 'active' : 'disabled';
    await api.updateUser(u.id, { status: next });
    await load();
    toast.success(next === 'disabled' ? `已禁用 ${u.name}` : `已启用 ${u.name}`);
  };

  const remove = async (u: UserWithStats) => {
    if (!window.confirm(`确认移除 ${u.name}（${u.email}）？其创建的缺陷与文件将保留。`)) return;
    await api.removeUser(u.id);
    await load();
    toast.success(`已移除 ${u.name}`);
  };

  const createUser = async () => {
    try {
      const r = await api.createUser({ email: newEmail.trim(), name: newName.trim() });
      setOneTimePwd(r.one_time_password);
      setNewEmail('');
      setNewName('');
      await load();
      toast.success('账号已创建');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '创建失败');
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* 顶部：注册开关 + 建号 */}
      <div className="flex flex-wrap items-center gap-4 border-b border-[var(--border-subtle)] px-4 py-2.5">
        <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <button
            className={cn(
              'relative h-5 w-9 rounded-full transition-colors cursor-pointer',
              regOpen ? 'bg-[var(--ok)]' : 'bg-[var(--bg-elevated)]',
            )}
            onClick={async () => {
              const next = !regOpen;
              await api.updateSettings({ registration_open: String(next) });
              setRegOpen(next);
              toast.success(next ? '已开放自助注册' : '已关闭自助注册');
            }}
            data-testid="registration-switch"
          >
            <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all', regOpen ? 'left-4.5' : 'left-0.5')} />
          </button>
          开放自助注册
        </label>

        <button
          className="vh-btn ghost h-8 text-xs"
          onClick={() => {
            void navigator.clipboard.writeText(`${window.location.origin}/login`);
            toast.success('注册链接已复制');
          }}
        >
          <Copy size={13} />
          复制注册链接
        </button>

        {!regOpen && (
          <div className="flex items-center gap-1.5">
            <input className="h-8 w-40 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-2 text-xs outline-none" placeholder="邮箱" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            <input className="h-8 w-28 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-2 text-xs outline-none" placeholder="名字" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button className="vh-btn h-8 text-xs" disabled={!newEmail.trim() || !newName.trim()} onClick={createUser}>
              <UserPlus size={13} />
              建号
            </button>
          </div>
        )}

        <div className="flex-1" />
        <span className="text-xs text-[var(--text-tertiary)]">{users.length} 名成员</span>
      </div>

      {oneTimePwd && (
        <div className="mx-4 mt-3 rounded-[10px] border-2 border-[var(--gold)] bg-[var(--gold-bg)] p-3 text-xs">
          一次性密码（仅此一次显示）：<code className="font-mono text-[var(--gold-bright)]">{oneTimePwd}</code>
          <button className="ml-2 text-[var(--gold)] cursor-pointer" onClick={() => { void navigator.clipboard.writeText(oneTimePwd); setOneTimePwd(null); }}>复制并关闭</button>
        </div>
      )}

      {/* 成员表格 */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <table className="w-full text-sm" data-testid="members-table">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] text-left text-xs text-[var(--text-tertiary)]">
              <th className="pb-2 pl-2 font-medium">成员</th>
              <th className="pb-2 font-medium">角色</th>
              <th className="pb-2 font-medium">状态</th>
              <th className="pb-2 font-medium">最近登录</th>
              <th className="pb-2 font-medium">统计</th>
              <th className="pb-2 pr-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-[var(--border-subtle)]/50 hover:bg-[var(--bg-panel)]" data-testid="member-row">
                <td className="py-2.5 pl-2">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--brand-soft)] text-xs font-semibold text-[var(--brand)]">{u.name.slice(0, 1)}</span>
                    <div>
                      <p className="text-[13px] font-medium text-[var(--text-primary)]">
                        {u.name}
                        {u.id === me?.id && <span className="ml-1.5 text-[10px] text-[var(--text-tertiary)]">（我）</span>}
                      </p>
                      <p className="text-[11px] text-[var(--text-tertiary)]">{u.email}</p>
                    </div>
                  </div>
                </td>
                <td className="py-2.5">
                  <select
                    className="h-7 rounded border border-[var(--border-strong)] bg-[var(--bg-page)] px-1.5 text-xs outline-none disabled:opacity-40"
                    value={u.role}
                    disabled={u.id === me?.id || isLastOwner(u)}
                    title={u.id === me?.id ? '不能修改自己的角色' : isLastOwner(u) ? '系统需要至少一名 Owner' : undefined}
                    onChange={(e) => void changeRole(u, e.target.value)}
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                </td>
                <td className="py-2.5">
                  <span className={cn('rounded px-1.5 py-0.5 text-[10px]', u.status === 'active' ? 'bg-[var(--ok)]/15 text-[var(--ok)]' : 'bg-[var(--danger)]/15 text-[var(--danger)]')}>
                    {u.status === 'active' ? '正常' : '已禁用'}
                  </span>
                </td>
                <td className="py-2.5 text-[11px] text-[var(--text-tertiary)]">
                  {u.last_login_at ? u.last_login_at.slice(5, 16).replace('T', ' ') : '从未登录'}
                </td>
                <td className="py-2.5 text-[11px] text-[var(--text-tertiary)]">
                  建单 {u.stats.bugs_created} · 文件 {u.stats.files_uploaded} · 密钥 {u.stats.active_keys}
                </td>
                <td className="py-2.5 pr-2">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      className="vh-btn ghost h-7 text-xs"
                      disabled={u.id === me?.id || isLastOwner(u)}
                      title={u.id === me?.id ? '不能操作自己' : isLastOwner(u) ? '系统需要至少一名 Owner' : undefined}
                      onClick={() => void toggleStatus(u)}
                    >
                      <UserX size={12} />
                      {u.status === 'active' ? '禁用' : '启用'}
                    </button>
                    <button
                      className="vh-btn ghost danger h-7 text-xs"
                      disabled={u.id === me?.id || isLastOwner(u)}
                      title={u.id === me?.id ? '不能移除自己' : isLastOwner(u) ? '系统需要至少一名 Owner' : undefined}
                      onClick={() => void remove(u)}
                    >
                      移除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Owner 危险区：转让 */}
      {isOwner && (
        <div className="border-t border-[var(--border-subtle)] px-4 py-3">
          {!transferOpen ? (
            <button className="vh-btn ghost danger text-xs" onClick={() => setTransferOpen(true)}>
              <ShieldAlert size={13} />
              转让 Owner
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--danger)]">输入目标成员邮箱以确认转让：</span>
              <input
                autoFocus
                className="h-8 w-56 rounded-md border border-[var(--danger)] bg-[var(--bg-page)] px-2 text-xs outline-none"
                value={transferEmail}
                onChange={(e) => setTransferEmail(e.target.value)}
              />
              <button
                className="vh-btn danger h-8 text-xs"
                onClick={async () => {
                  const target = users.find((u) => u.email === transferEmail.trim());
                  if (!target) {
                    toast.error('邮箱不存在');
                    return;
                  }
                  await api.transferOwnership(target.id);
                  setTransferOpen(false);
                  setTransferEmail('');
                  await load();
                  toast.success(`Owner 已转让给 ${target.name}`);
                }}
              >
                确认转让
              </button>
              <button className="vh-btn ghost h-8 text-xs" onClick={() => setTransferOpen(false)}>取消</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
