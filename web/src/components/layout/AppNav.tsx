'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, Keyboard, Moon, Settings2, Sparkles, Sun } from 'lucide-react';
import { useAuth, useCanEdit } from '@/lib/auth';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { useTheme } from '@/lib/theme';
import { useVibeHub } from '@/hooks/use-vibehub';
import { useWorkOverlay } from '@/components/work/WorkItemOverlay';
import { cn } from '@/lib/utils';
import { ProjectSwitcher } from './ProjectSwitcher';
import { GlobalSidebarBody, WorkspaceSidebarBody } from './SidebarSections';
import { NotificationPanel } from '@/components/notifications/NotificationPanel';

const COLLAPSED_KEY = 'vibehub_sidebar_collapsed';
const ROLE_LABEL: Record<string, string> = { owner: '拥有者', admin: '管理员', member: '成员', viewer: '只读' };

export function isGlobalRoute(pathname: string): boolean {
  return ['/settings', '/keys', '/members', '/projects'].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

interface AppNavProps {
  onOpenPalette: () => void;
  onOpenHelp: () => void;
  onOpenActivity: () => void;
}

/** 紧凑左侧边栏工作台：项目空间与全局管理彻底分离，通知未读严格跟随当前项目 */
export function AppNav({ onOpenPalette, onOpenHelp, onOpenActivity }: AppNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const canEdit = useCanEdit();
  const { theme, toggle } = useTheme();
  const store = useVibeHub();
  const overlay = useWorkOverlay();
  const toast = useToast();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  const projectId = store.currentProject?.id ?? null;

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === '1');
    } catch {
      // 隐私模式
    }
  }, []);

  useEffect(() => {
    const onToggle = () => setMobileOpen((v) => !v);
    window.addEventListener('vibehub:toggle-sidebar', onToggle);
    return () => window.removeEventListener('vibehub:toggle-sidebar', onToggle);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setCreateMenuOpen(false);
  }, [pathname, projectId]);

  useEffect(() => {
    if (!projectId) {
      setUnread(0);
      return;
    }
    let alive = true;
    const load = () =>
      api
        .listNotifications(false, 1, projectId)
        .then((r) => alive && setUnread(r.unread))
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [projectId, store.statsRevision]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // 忽略
    }
  };

  const activeBugsCount = useMemo(
    () =>
      store.board.open.length +
      store.board.in_progress.length +
      store.board.resolved.length +
      store.board.verifying.length,
    [store.board],
  );

  const globalMode = isGlobalRoute(pathname);
  const isCompact = collapsed && !mobileOpen;

  const sidebarContent = (
    <aside
      className={cn('vh-sidebar', isCompact && 'collapsed')}
      data-testid="sidebar"
      aria-label={globalMode ? '全局管理导航' : '项目工作区导航'}
    >
      {globalMode ? (
        <GlobalSidebarBody pathname={pathname} projectName={store.currentProject?.name ?? null} onGo={(h) => router.push(h)} />
      ) : (
        <WorkspaceSidebarBody
          pathname={pathname}
          compact={isCompact}
          canEdit={canEdit}
          activeBugsCount={activeBugsCount}
          notesCount={store.notes.length}
          filesCount={store.attachments.length}
          createMenuOpen={createMenuOpen}
          onSetCreateMenu={setCreateMenuOpen}
          onCreateBug={() => {
            setCreateMenuOpen(false);
            overlay.openCreateBug();
          }}
          onCreateTask={() => {
            setCreateMenuOpen(false);
            overlay.openCreateTask();
          }}
          onOpenPalette={onOpenPalette}
          onToggleCollapsed={toggleCollapsed}
          onGo={(h) => router.push(h)}
          switcher={
            <ProjectSwitcher
              projects={store.projects}
              current={store.currentProject}
              onSelect={store.selectProject}
              onCreate={(name) => {
                void store.createProject(name).catch((e) => toast.error(e instanceof Error ? e.message : '创建项目失败'));
              }}
              collapsed={isCompact}
            />
          }
        />
      )}

      <div className="mt-auto border-t border-[var(--border-subtle)] p-2">
        {!isCompact && (
          <div className="mb-1.5 flex items-center justify-between px-1">
            <button
              type="button"
              className="vh-icon-btn relative"
              onClick={() => setNotifOpen(true)}
              title="当前项目通知"
              aria-label={`通知${unread ? `（${unread} 条未读）` : ''}`}
              data-testid="open-notifications"
            >
              <Bell size={15} />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-semibold leading-none text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>
            <button type="button" className="vh-icon-btn" onClick={onOpenActivity} title="AI 活动流" aria-label="AI 活动流" data-testid="open-activity">
              <Sparkles size={15} />
            </button>
            <button
              type="button"
              className="vh-icon-btn"
              onClick={toggle}
              title={theme === 'midnight' ? '切换到纸白主题' : '切换到暗色主题'}
              aria-label="切换主题"
              data-testid="theme-toggle"
            >
              {theme === 'midnight' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button type="button" className="vh-icon-btn" onClick={onOpenHelp} title="快捷键（?）" aria-label="快捷键帮助">
              <Keyboard size={15} />
            </button>
          </div>
        )}

        {user && (
          <button
            type="button"
            className={cn(
              'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-elevated)]',
              globalMode && 'bg-[var(--bg-elevated)]',
              isCompact && 'justify-center px-0',
            )}
            onClick={() => router.push('/settings')}
            title={isCompact ? `${user.name} · 全局设置` : '个人资料、密钥与团队全局管理'}
            data-testid="nav-settings"
          >
            <span className="vh-avatar h-7 w-7 text-xs">{user.name.slice(0, 1)}</span>
            {!isCompact && (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-[var(--text-primary)]">{user.name}</span>
                  <span className="block truncate text-[10px] text-[var(--text-tertiary)]">
                    {ROLE_LABEL[user.role] ?? user.role} · 全局设置
                  </span>
                </span>
                <Settings2 size={14} className="shrink-0 text-[var(--text-tertiary)]" />
              </>
            )}
          </button>
        )}
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden h-full min-[900px]:block">{sidebarContent}</div>
      {mobileOpen && (
        <div className="min-[900px]:hidden" data-testid="mobile-nav">
          <div className="vh-drawer-mask" onClick={() => setMobileOpen(false)} />
          <div className="vh-drawer open">{sidebarContent}</div>
        </div>
      )}
      <NotificationPanel
        open={notifOpen}
        projectId={projectId}
        projectName={store.currentProject?.name ?? null}
        onClose={() => setNotifOpen(false)}
        onUnreadChange={setUnread}
      />
    </>
  );
}
