'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, KeyRound, LogOut, Settings2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';

const ROLE_LABEL: Record<string, string> = {
  owner: '拥有者',
  admin: '管理员',
  member: '成员',
  viewer: '只读',
};

export function UserMenu() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!user) return null;

  return (
    <div className="relative">
      <button
        className="flex h-9 items-center gap-2 rounded-lg border border-transparent px-1.5 hover:border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="账号菜单"
        data-testid="user-menu"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--brand-soft)] text-xs font-semibold text-[var(--accent)]">
          {user.name.slice(0, 1)}
        </span>
        <ChevronDown size={13} className="hidden text-[var(--text-tertiary)] lg:block" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-11 z-50 w-64 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2 shadow-[var(--shadow-2)]">
            <div className="px-2 py-2">
              <p className="t-title-4 truncate">{user.name}</p>
              <p className="t-caption-5 truncate text-[var(--text-tertiary)]">{user.email}</p>
              <p className="t-caption-4 mt-1 text-[var(--accent)]">{ROLE_LABEL[user.role] ?? user.role}</p>
            </div>
            <div className="my-1 h-px bg-[var(--border-subtle)]" />
            <button className="vh-menu-item" onClick={() => { setOpen(false); router.push('/settings'); }}>
              <Settings2 size={14} className="mr-2 inline" /> 设置
            </button>
            <button className="vh-menu-item" onClick={() => { setOpen(false); router.push('/keys'); }}>
              <KeyRound size={14} className="mr-2 inline" /> 我的密钥
            </button>
            <div className="my-1 h-px bg-[var(--border-subtle)]" />
            <button
              className="vh-menu-item text-[var(--danger)]"
              onClick={async () => {
                setOpen(false);
                await logout();
                router.replace('/login');
              }}
            >
              <LogOut size={14} className="mr-2 inline" /> 退出登录
            </button>
          </div>
        </>
      )}
    </div>
  );
}
