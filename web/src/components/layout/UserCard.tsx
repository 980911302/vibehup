'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth';

const ROLE_LABEL: Record<string, string> = {
  owner: '拥有者',
  admin: '管理员',
  member: '成员',
  viewer: '只读',
};

/** 底部用户卡：首字头像 + 角色徽章 + 退出（UI 规范 §6.8 头像规范） */
export function UserCard({ collapsed = false }: { collapsed?: boolean }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  if (!user) return null;

  return (
    <div className="vh-user-card" data-testid="user-card">
      <span className="vh-avatar" title={user.name}>
        {user.name.slice(0, 1)}
      </span>
      {!collapsed && (
        <div className="vh-user-meta">
          <p className="vh-user-name">{user.name}</p>
          <p className="vh-user-role">
            <span className={`vh-role-dot role-${user.role}`} />
            {ROLE_LABEL[user.role] ?? user.role}
          </p>
        </div>
      )}
      <button
        className="vh-user-logout"
        title="退出登录"
        onClick={async () => {
          await logout();
          router.replace('/login');
        }}
      >
        <LogOut size={15} />
      </button>
    </div>
  );
}
