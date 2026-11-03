'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  BookOpen,
  Check,
  Keyboard,
  Menu,
  Moon,
  Search,
  Settings2,
  Sparkles,
  Sun,
  Sunrise,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { useTheme } from '@/lib/theme';
import { useVibeHub } from '@/hooks/use-vibehub';
import { cn } from '@/lib/utils';
import { ProjectSwitcher } from './ProjectSwitcher';
import { UserMenu } from './UserMenu';

export const NAV_ITEMS: { href: string; label: string; icon: LucideIcon; match: string[] }[] = [
  { href: '/today', label: '今日', icon: Sunrise, match: ['/today', '/stats'] },
  { href: '/work', label: '工作', icon: Activity, match: ['/work', '/board', '/tasks'] },
  { href: '/context', label: '上下文', icon: BookOpen, match: ['/context', '/notes', '/files', '/skills'] },
  { href: '/settings', label: '设置', icon: Settings2, match: ['/settings', '/keys', '/members', '/projects'] },
];

function isActive(pathname: string, item: (typeof NAV_ITEMS)[number]): boolean {
  return item.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
}

interface AppNavProps {
  onOpenPalette: () => void;
  onOpenHelp: () => void;
  onOpenActivity: () => void;
}

/** 浮动顶栏（R89）：四区导航 + 项目切换 + 搜索/主题/活动/账号；移动端全屏菜单。 */
export function AppNav({ onOpenPalette, onOpenHelp, onOpenActivity }: AppNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const { theme, toggle } = useTheme();
  const store = useVibeHub();
  const toast = useToast();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const go = (href: string) => {
    setMobileOpen(false);
    router.push(href);
  };

  return (
    <>
      <header className="vh-topbar">
        <div className="vh-nav-float">
          <button
            className="vh-brand cursor-pointer border-0 bg-transparent p-0 text-left"
            onClick={() => go('/today')}
            aria-label="回到今日"
          >
            <span className="vh-brand-mark" aria-hidden>
              V
            </span>
            <span className="hidden flex-col sm:flex">
              <span className="vh-brand-name">VibeHub</span>
              <span className="vh-brand-sub">AI 同事的工作台</span>
            </span>
          </button>

          <nav className="vh-top-nav ml-2 hidden md:flex" aria-label="主导航">
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item);
              const Icon = item.icon;
              return (
                <button
                  key={item.href}
                  className={cn('vh-top-link', active && 'active')}
                  onClick={() => go(item.href)}
                  aria-current={active ? 'page' : undefined}
                  data-testid={`nav-${item.href.slice(1)}`}
                >
                  <Icon size={15} strokeWidth={1.8} />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="vh-top-actions">
            <div className="hidden md:block">
              <ProjectSwitcher
                projects={store.projects}
                current={store.currentProject}
                onSelect={store.selectProject}
                onCreate={(name) => {
                  void store.createProject(name).catch((e) =>
                    toast.error(e instanceof Error ? e.message : '创建项目失败'),
                  );
                }}
                align="right"
                compact
              />
            </div>

            <div className="hidden sm:block">
              <button
                className="vh-btn ghost h-9 gap-2 px-3"
                onClick={onOpenPalette}
                data-testid="open-palette"
                aria-label="打开命令面板"
              >
                <Search size={15} />
                <span className="hidden lg:inline">搜索</span>
                <span className="vh-kbd hidden lg:inline-flex">⌘K</span>
              </button>
            </div>
            <div className="sm:hidden">
              <button
                className="vh-icon-btn"
                onClick={onOpenPalette}
                aria-label="打开命令面板"
                data-testid="open-palette-mobile"
              >
                <Search size={17} />
              </button>
            </div>

            <div className="hidden sm:block">
              <button
                className="vh-icon-btn"
                onClick={onOpenActivity}
                title="AI 活动"
                aria-label="查看 AI 活动"
                data-testid="open-activity"
              >
                <Sparkles size={17} />
              </button>
            </div>
            <div className="hidden sm:block">
              <button
                className="vh-icon-btn"
                onClick={toggle}
                title={theme === 'midnight' ? '切换到纸白主题' : '切换到暗色主题'}
                aria-label="切换主题"
                data-testid="theme-toggle"
              >
                {theme === 'midnight' ? <Sun size={17} /> : <Moon size={17} />}
              </button>
            </div>
            <div className="hidden lg:block">
              <button
                className="vh-icon-btn"
                onClick={onOpenHelp}
                title="快捷键帮助（?）"
                aria-label="快捷键帮助"
              >
                <Keyboard size={17} />
              </button>
            </div>

            {user && <UserMenu />}

            <div className="md:hidden">
              <button
                className="vh-icon-btn"
                onClick={() => setMobileOpen(true)}
                aria-label="打开导航"
                aria-expanded={mobileOpen}
                data-testid="mobile-menu"
              >
                <Menu size={18} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-[var(--bg-page)] px-4 pb-8 pt-4"
          data-testid="mobile-nav"
        >
          <div className="flex h-14 items-center justify-between">
            <div className="vh-brand">
              <span className="vh-brand-mark" aria-hidden>
                V
              </span>
              <span className="vh-brand-name">VibeHub</span>
            </div>
            <button className="vh-icon-btn" onClick={() => setMobileOpen(false)} aria-label="关闭导航">
              <X size={20} />
            </button>
          </div>

          <nav className="mt-8 flex flex-col" aria-label="移动端主导航">
            {NAV_ITEMS.map((item, i) => {
              const active = isActive(pathname, item);
              const Icon = item.icon;
              return (
                <button
                  key={item.href}
                  className={cn('vh-mobile-link', active && 'text-[var(--accent)]')}
                  style={{ '--i': i } as CSSProperties}
                  onClick={() => go(item.href)}
                  aria-current={active ? 'page' : undefined}
                  data-testid={`mobile-nav-${item.href.slice(1)}`}
                >
                  <Icon size={22} strokeWidth={1.6} />
                  {item.label}
                  {active && <Check size={18} className="ml-auto text-[var(--accent)]" />}
                </button>
              );
            })}
          </nav>

          <div className="mt-auto space-y-3 border-t border-[var(--border-subtle)] pt-4">
            {store.currentProject && (
              <div className="flex items-center justify-between gap-2">
                <span className="t-caption-2 text-[var(--text-tertiary)]">当前项目</span>
                <ProjectSwitcher
                  projects={store.projects}
                  current={store.currentProject}
                  onSelect={store.selectProject}
                  onCreate={(name) => {
                    void store.createProject(name).catch((e) =>
                      toast.error(e instanceof Error ? e.message : '创建项目失败'),
                    );
                  }}
                  align="right"
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <button className="vh-btn ghost flex-1" onClick={onOpenPalette}>
                <Search size={15} /> 搜索
              </button>
              <button className="vh-btn ghost" onClick={onOpenActivity} aria-label="AI 活动">
                <Sparkles size={15} />
              </button>
              <button className="vh-btn ghost" onClick={toggle} aria-label="切换主题">
                {theme === 'midnight' ? <Sun size={15} /> : <Moon size={15} />}
              </button>
              <button className="vh-btn ghost" onClick={onOpenHelp} aria-label="快捷键帮助">
                ?
              </button>
            </div>
            <button className="vh-btn ghost w-full" onClick={() => go('/settings')}>
              <Settings2 size={15} /> 我的设置
            </button>
          </div>
        </div>
      )}
    </>
  );
}
