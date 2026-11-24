'use client';

import type { ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { useVibeHub } from '@/hooks/use-vibehub';

interface WorkspaceHeaderProps {
  title: string;
  /** 'project' 显示当前项目面包屑；'global' 显示全局管理面包屑 */
  scope?: 'project' | 'global';
  badge?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

/**
 * 全站统一 48px 单行工作区顶栏：
 * 固定高度、固定左右边距，彻底消除不同页面标题大小、边距和层级跳变。
 */
export function WorkspaceHeader({
  title,
  scope = 'project',
  badge,
  subtitle,
  actions,
}: WorkspaceHeaderProps) {
  const store = useVibeHub();
  const prefix = scope === 'global' ? '全局管理' : (store.currentProject?.name ?? '未选择项目');

  return (
    <header className="vh-ws-header">
      <button
        type="button"
        className="vh-icon-btn vh-mobile-only"
        onClick={() => window.dispatchEvent(new CustomEvent('vibehub:toggle-sidebar'))}
        aria-label="打开导航"
        data-testid="mobile-menu"
      >
        <Menu size={17} />
      </button>

      <div className="flex min-w-0 items-center gap-2">
        <span className="hidden max-w-[180px] truncate text-xs font-medium text-[var(--text-tertiary)] sm:inline">
          {prefix}
        </span>
        <span className="hidden text-xs text-[var(--border-strong)] sm:inline">/</span>
        <h1 className="truncate text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">{title}</h1>
        {badge !== undefined && badge !== null && (
          <span className="shrink-0 rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-tertiary)]">
            {badge}
          </span>
        )}
        {subtitle && (
          <span className="hidden truncate text-xs text-[var(--text-tertiary)] lg:inline">{subtitle}</span>
        )}
      </div>

      {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
