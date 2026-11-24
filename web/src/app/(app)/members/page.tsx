'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, ShieldAlert, UserPlus, UserX } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { cn } from '@/lib/utils';
import type { UserWithStats } from '@/lib/api-types';

const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
const ROLE_LABEL: Record<string, string> = { owner: '拥有者', admin: '管理员', member: '成员', viewer: '只读' };

/** 全局管理 · 成员与权限：角色调整、注册开关、建号与 Owner 转让 */
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
      router.replace('/today');
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
    if (!window.confirm(`确认移除 ${u.name}（${u.email}）？其创建的缺陷与文件将保留，密钥立即失效。`)) return;
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
      <WorkspaceHeader
        scope="global"
        title="团队成员与权限"
        badge={`${users.length} 人`}
        actions={
          <button
            type="button"
            className="vh-btn ghost h-8 px-2.5 text-xs"
            onClick={() => {
              void navigator.clipboard.writeText(`${window.location.origin}/login`);
              toast.success('注册链接已复制');
            }}
          >
            <Copy size={13} /> 复制注册链接
          </button>
        }
      />

      <div className="vh-ws-toolbar">
        <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <button
            type="button"
            className={cn(
              'relative h-5 w-9 cursor-pointer rounded-full transition-colors',
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

        {!regOpen && (
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              className="vh-input-compact w-44"
              placeholder="成员邮箱"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
            <input
              className="vh-input-compact w-28"
              placeholder="姓名"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button
              type="button"
              className="vh-btn h-8 px-2.5 text-xs"
              disabled={!newEmail.trim() || !newName.trim()}
              onClick={() => void createUser()}
            >
              <UserPlus size={13} /> 建号
            </button>
          </div>
        )}
      </div>

      {oneTimePwd && (
        <div className="mx-5 mt-3 rounded-xl border border-[var(--gold)] bg-[var(--gold-bg)] px-4 py-2.5 text-xs">
          一次性登录密码（仅显示一次）：
          <code className="ml-1 font-mono font-semibold text-[var(--gold-bright)]">{oneTimePwd}</code>
          <button
            type="button"
            className="ml-3 cursor-pointer font-medium text-[var(--gold)] underline"
            onClick={() => {
              void navigator.clipboard.writeText(oneTimePwd);
              setOneTimePwd(null);
            }}
          >
            复制并关闭
          </button>
        </div>
      )}

      <div className="vh-ws-scroll">
        <div className="vh-ws-container space-y-4">
          <div className="vh-list-surface overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm" data-testid="members-table">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-panel)]/50 text-left text-xs text-[var(--text-tertiary)]">
                  <th className="px-4 py-2.5 font-medium">成员</th>
                  <th className="px-3 py-2.5 font-medium">角色</th>
                  <th className="px-3 py-2.5 font-medium">状态</th>
                  <th className="px-3 py-2.5 font-medium">最近登录</th>
                  <th className="px-3 py-2.5 font-medium">全站统计</th>
                  <th className="px-4 py-2.5 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-[var(--bg-elevated)]/50" data-testid="member-row">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--brand-soft)] text-xs font-semibold text-[var(--brand)]">
                          {u.name.slice(0, 1)}
                        </span>
                        <div>
                          <p className="text-xs font-medium text-[var(--text-primary)]">
                            {u.name}
                            {u.id === me?.id && <span className="ml-1 text-[var(--text-tertiary)]">（我）</span>}
                          </p>
                          <p className="text-[11px] text-[var(--text-tertiary)]">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <select
                        className="vh-input-compact !h-7 px-1.5 disabled:opacity-45"
                        value={u.role}
                        disabled={u.id === me?.id || isLastOwner(u)}
                        onChange={(e) => void changeRole(u, e.target.value)}
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cn('rounded px-1.5 py-0.5 text-xs', u.status === 'active' ? 'bg-[var(--ok)]/15 text-[var(--ok)]' : 'bg-[var(--danger)]/15 text-[var(--danger)]')}>
                        {u.status === 'active' ? '正常' : '已禁用'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-[var(--text-tertiary)]">
                      {u.last_login_at ? u.last_login_at.slice(5, 16).replace('T', ' ') : '从未登录'}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-[var(--text-tertiary)]">
                      建单 {u.stats.bugs_created} · 文件 {u.stats.files_uploaded} · 密钥 {u.stats.active_keys}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button type="button" className="vh-btn ghost h-7 px-2 text-xs" disabled={u.id === me?.id || isLastOwner(u)} onClick={() => void toggleStatus(u)}>
                          <UserX size={12} />{u.status === 'active' ? '禁用' : '启用'}
                        </button>
                        <button type="button" className="vh-btn ghost danger h-7 px-2 text-xs" disabled={u.id === me?.id || isLastOwner(u)} onClick={() => void remove(u)}>
                          移除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {isOwner && (
            <div className="vh-card flex flex-wrap items-center justify-between gap-3 p-4">
              {!transferOpen ? (
                <>
                  <span className="text-xs text-[var(--text-tertiary)]">如需移交系统最高管理权，可将 Owner 转让给其他活跃成员。</span>
                  <button type="button" className="vh-btn ghost danger h-8 px-2.5 text-xs" onClick={() => setTransferOpen(true)}>
                    <ShieldAlert size={13} /> 转让 Owner
                  </button>
                </>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-[var(--danger)]">输入目标成员邮箱确认转让：</span>
                  <input
                    autoFocus
                    className="vh-input-compact w-56 border-[var(--danger)]"
                    value={transferEmail}
                    onChange={(e) => setTransferEmail(e.target.value)}
                  />
                  <button
                    type="button"
                    className="vh-btn danger h-8 px-2.5 text-xs"
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
                  <button type="button" className="vh-btn ghost h-8 px-2.5 text-xs" onClick={() => setTransferOpen(false)}>
                    取消
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
