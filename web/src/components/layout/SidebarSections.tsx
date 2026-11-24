'use client';

import type { ReactNode } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Bug,
  FolderKanban,
  FolderOpen,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Puzzle,
  Search,
  StickyNote,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';

interface NavEntry {
  href: string;
  label: string;
  icon: LucideIcon;
  match: string[];
  testId: string;
  badge?: number;
}

export interface WorkspaceSidebarBodyProps {
  pathname: string;
  compact: boolean;
  canEdit: boolean;
  activeBugsCount: number;
  notesCount: number;
  filesCount: number;
  createMenuOpen: boolean;
  onSetCreateMenu: (v: boolean) => void;
  onCreateBug: () => void;
  onCreateTask: () => void;
  onOpenPalette: () => void;
  onToggleCollapsed: () => void;
  onGo: (href: string) => void;
  switcher: ReactNode;
}

export function WorkspaceSidebarBody(p: WorkspaceSidebarBodyProps) {
  const workItems: NavEntry[] = [
    { href: '/today', label: '概览', icon: LayoutDashboard, match: ['/today'], testId: 'nav-today' },
    {
      href: '/work/bugs',
      label: '缺陷',
      icon: Bug,
      match: ['/work', '/board'],
      testId: 'nav-bugs',
      badge: p.activeBugsCount || undefined,
    },
    { href: '/work/tasks', label: '任务', icon: ListChecks, match: ['/work/tasks', '/tasks'], testId: 'nav-tasks' },
  ];
  const contextItems: NavEntry[] = [
    {
      href: '/context/notes',
      label: '随手记',
      icon: StickyNote,
      match: ['/context', '/notes'],
      testId: 'nav-context',
      badge: p.notesCount || undefined,
    },
    {
      href: '/context/files',
      label: '文件',
      icon: FolderOpen,
      match: ['/context/files', '/files'],
      testId: 'context-files',
      badge: p.filesCount || undefined,
    },
    { href: '/context/skills', label: '技能', icon: Puzzle, match: ['/context/skills', '/skills'], testId: 'context-skills' },
  ];
  const insightItems: NavEntry[] = [
    { href: '/stats', label: '统计', icon: BarChart3, match: ['/stats'], testId: 'nav-stats' },
  ];

  const isItemActive = (item: NavEntry) => {
    if (item.href === '/work/bugs' && p.pathname.startsWith('/work/tasks')) return false;
    if (item.href === '/context/notes' && (p.pathname.startsWith('/context/files') || p.pathname.startsWith('/context/skills'))) {
      return false;
    }
    return item.match.some((m) => p.pathname === m || p.pathname.startsWith(`${m}/`));
  };

  const renderEntry = (item: NavEntry) => {
    const active = isItemActive(item);
    const Icon = item.icon;
    return (
      <button
        key={item.href}
        type="button"
        className={cn('vh-nav-item h-8', active && 'active', p.compact && 'justify-center px-0')}
        onClick={() => p.onGo(item.href)}
        aria-current={active ? 'page' : undefined}
        title={p.compact ? item.label : undefined}
        data-testid={item.testId}
      >
        <span className="vh-nav-indicator" />
        <Icon size={15} strokeWidth={1.8} className="shrink-0" />
        <span className="vh-nav-label text-[13px]">{item.label}</span>
        {item.badge !== undefined && <span className="vh-nav-badge">{item.badge}</span>}
      </button>
    );
  };

  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] px-2">
        {p.switcher}
        <button
          type="button"
          className="vh-sidebar-collapse-btn hidden min-[900px]:inline-flex"
          onClick={p.onToggleCollapsed}
          title={p.compact ? '展开边栏' : '折叠边栏'}
          data-testid="sidebar-collapse"
        >
          {p.compact ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        </button>
      </div>

      {!p.compact && (
        <div className="relative flex items-center gap-1.5 px-2.5 pt-2.5">
          {p.canEdit && (
            <div className="relative flex-1">
              <button
                type="button"
                className="vh-btn tonal w-full justify-center"
                onClick={() => p.onSetCreateMenu(!p.createMenuOpen)}
                data-testid="quick-capture"
              >
                <Plus size={14} />
                新建
              </button>
              {p.createMenuOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => p.onSetCreateMenu(false)} />
                  <div className="absolute left-0 top-9 z-40 w-44 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-card)] p-1 shadow-[var(--shadow-2)]">
                    <button
                      type="button"
                      className="flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                      onClick={p.onCreateBug}
                    >
                      <span className="flex items-center gap-1.5"><Bug size={13} /> 录缺陷</span>
                      <span className="vh-kbd">C</span>
                    </button>
                    <button
                      type="button"
                      className="flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                      onClick={p.onCreateTask}
                    >
                      <span className="flex items-center gap-1.5"><ListChecks size={13} /> 新建任务</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          <button
            type="button"
            className={cn('vh-btn ghost h-8 gap-1.5 px-2.5 text-xs', !p.canEdit && 'w-full')}
            onClick={p.onOpenPalette}
            aria-label="搜索当前项目"
            data-testid="open-palette"
          >
            <Search size={13} />
            <span>搜索</span>
            <span className="vh-kbd text-[10px]">⌘K</span>
          </button>
        </div>
      )}

      <nav className="vh-sidebar-nav pt-2">
        <div className="vh-nav-group-label">工作推进</div>
        {workItems.map(renderEntry)}
        <div className="vh-nav-group-label">项目上下文</div>
        {contextItems.map(renderEntry)}
        <div className="vh-nav-group-label">节奏与产出</div>
        {insightItems.map(renderEntry)}
      </nav>
    </>
  );
}

export function GlobalSidebarBody({
  pathname,
  projectName,
  onGo,
}: {
  pathname: string;
  projectName: string | null;
  onGo: (href: string) => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';
  const items = [
    { href: '/settings', label: '个人与通用技能', icon: UserRound, adminOnly: false },
    { href: '/keys', label: 'MCP 密钥', icon: KeyRound, adminOnly: false },
    { href: '/projects', label: '全部项目管理', icon: FolderKanban, adminOnly: false },
    { href: '/members', label: '团队成员与权限', icon: Users, adminOnly: true },
  ];

  return (
    <>
      <div className="flex h-12 shrink-0 items-center border-b border-[var(--border-subtle)] px-2.5">
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          onClick={() => onGo('/today')}
          data-testid="back-to-workspace"
        >
          <ArrowLeft size={14} />
          <span className="truncate">返回 {projectName ?? '工作区'}</span>
        </button>
      </div>
      <nav className="vh-sidebar-nav pt-2">
        <div className="vh-nav-group-label">全局与团队设置</div>
        {items.map((it) => {
          const Icon = it.icon;
          const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
          if (it.adminOnly && !isAdmin) {
            return (
              <button
                key={it.href}
                type="button"
                className="vh-nav-item vh-nav-locked h-8"
                onClick={() => toast.info('团队成员管理需要管理员权限')}
              >
                <Lock size={14} />
                <span className="vh-nav-label text-[13px]">{it.label}</span>
              </button>
            );
          }
          return (
            <button
              key={it.href}
              type="button"
              className={cn('vh-nav-item h-8', active && 'active')}
              onClick={() => onGo(it.href)}
            >
              <span className="vh-nav-indicator" />
              <Icon size={15} strokeWidth={1.8} />
              <span className="vh-nav-label text-[13px]">{it.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
