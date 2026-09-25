'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3,
  ChevronDown,
  Lock,
  FolderKanban,
  Image as ImageIcon,
  KeyRound,
  ListChecks,
  Puzzle,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  StickyNote,
  Users,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { UserCard } from './UserCard';
import { cn } from '@/lib/utils';
import { NAV_MORE_KEY, NAV_SIMPLE_KEY, NAV_PREFS_EVENT, readNavFlag, writeNavFlag } from '@/lib/nav-prefs';

/**
 * 导航项（与 lib/shortcuts.ts 的 G 序列、步骤 06 §6.2 信息架构一致）。
 * group：primary=全员日常入口平铺；more=管理/设置等次要项折叠进「更多」（卡片 35）。
 */
const NAV_ITEMS = [
  { href: '/board', label: '看板', icon: FolderKanban, combo: 'G B', group: 'primary' },
  { href: '/files', label: '文件', icon: ImageIcon, combo: 'G F', group: 'primary' },
  { href: '/notes', label: '随手记', icon: StickyNote, combo: 'G N', group: 'primary' },
  { href: '/tasks', label: '任务', icon: ListChecks, combo: 'G T', group: 'primary' },
  { href: '/skills', label: '技能', icon: Puzzle, combo: 'G S', group: 'primary' },
  { href: '/stats', label: '统计', icon: BarChart3, combo: 'G D', group: 'primary' },
  { href: '/projects', label: '项目', icon: FolderKanban, combo: 'G P', group: 'primary' },
  { href: '/keys', label: 'MCP 密钥', icon: KeyRound, combo: 'G K', adminOnly: true, group: 'more' },
  { href: '/members', label: '成员', icon: Users, combo: 'G M', adminOnly: true, group: 'more' },
  { href: '/settings', label: '设置', icon: Settings, combo: 'G ,', group: 'more' },
] as const;

const COLLAPSED_KEY = 'vibehub_sidebar_collapsed';
const MOBILE_QUERY = '(max-width: 899px)';

function isMoreRoute(pathname: string): boolean {
  return NAV_ITEMS.some((i) => i.group === 'more' && (pathname === i.href || pathname.startsWith(i.href + '/')));
}

/**
 * 侧边栏（UI 规范 §2.1）：
 * 展开 232px / 折叠 64px（只动 width，文字 140ms 淡出，金色指示条平移）；
 * <900px 自动 overlay 抽屉（遮罩 + 从左滑入）。
 */
export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  // 导航偏好（卡片 35）：次要项折叠态 + 简洁模式（隐藏「更多」入口）
  const [moreExpanded, setMoreExpanded] = useState(false);
  const [simpleMode, setSimpleMode] = useState(false);

  // 折叠态持久化 + 导航偏好初始化/同步
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === '1');
    } catch {
      // 隐私模式
    }
    setMoreExpanded(readNavFlag(NAV_MORE_KEY) || isMoreRoute(window.location.pathname));
    setSimpleMode(readNavFlag(NAV_SIMPLE_KEY));
    const onPrefs = () => {
      setMoreExpanded(readNavFlag(NAV_MORE_KEY));
      setSimpleMode(readNavFlag(NAV_SIMPLE_KEY));
    };
    window.addEventListener(NAV_PREFS_EVENT, onPrefs);
    return () => window.removeEventListener(NAV_PREFS_EVENT, onPrefs);
  }, []);

  // 移动端探测
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // 落在次要路由时自动展开（如 ⌘K/直达 /settings）
  useEffect(() => {
    if (isMoreRoute(pathname)) setMoreExpanded(true);
  }, [pathname]);

  // 路由切换后关闭移动端抽屉
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Esc 关抽屉
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // 隐私模式
    }
  };

  const isAdmin = user?.role === 'owner' || user?.role === 'admin';
  const primaryItems = NAV_ITEMS.filter((item) => item.group === 'primary');
  // more 组不过滤角色：非管理员看到锁定态（保留可发现性，卡片 35）
  const moreItems = NAV_ITEMS.filter((item) => item.group === 'more');
  const hasVisibleMore = moreItems.some((i) => !('adminOnly' in i && i.adminOnly) || isAdmin);
  const showMoreSection = !simpleMode && (hasVisibleMore || moreItems.length > 0);

  const renderNavItem = (item: (typeof NAV_ITEMS)[number]) => {
    const active = pathname === item.href || pathname.startsWith(item.href + '/');
    const Icon = item.icon;
    const locked = 'adminOnly' in item && item.adminOnly && !isAdmin;
    if (locked) {
      return (
        <button
          key={item.href}
          className="vh-nav-item vh-nav-locked"
          onClick={() => toast.info(`${item.label}：需要管理员权限`)}
          title="需要管理员权限"
          data-testid={`nav-${item.href.slice(1)}-locked`}
        >
          <span className="vh-nav-indicator" />
          <Lock size={15} strokeWidth={1.8} />
          <span className="vh-nav-label">{item.label}</span>
          <span className="vh-nav-combo">需管理</span>
        </button>
      );
    }
    return (
      <button
        key={item.href}
        className={cn('vh-nav-item', active && 'active')}
        onClick={() => router.push(item.href)}
        title={collapsed ? `${item.label}（${item.combo}）` : undefined}
        data-testid={`nav-${item.href.slice(1)}`}
      >
        <span className="vh-nav-indicator" />
        <Icon size={17} strokeWidth={1.8} />
        <span className="vh-nav-label">{item.label}</span>
        <span className="vh-nav-combo">{item.combo}</span>
      </button>
    );
  };

  const sidebar = (
    <aside
      className={cn('vh-sidebar', collapsed && !isMobile && 'collapsed', isMobile && 'mobile')}
      data-testid="sidebar"
      data-collapsed={collapsed && !isMobile ? '1' : '0'}
    >
      {/* 品牌区 */}
      <div className="vh-sidebar-brand">
        <div className="vh-sidebar-logo">
          <FolderKanban size={16} />
        </div>
        <span className="vh-sidebar-brand-name">VibeHub</span>
        <i className="vh-gold-dot" />
        <button
          className="vh-sidebar-collapse-btn"
          onClick={toggleCollapsed}
          title={collapsed ? '展开侧栏' : '折叠侧栏'}
          data-testid="sidebar-collapse"
        >
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </div>

      {/* 导航：日常项平铺 + 次要项折叠进「更多」（卡片 35） */}
      <nav className="vh-sidebar-nav">
        {primaryItems.map(renderNavItem)}
        {showMoreSection && (
          <>
            <button
              className="vh-nav-item vh-nav-more-toggle"
              onClick={() => {
                const next = !moreExpanded;
                setMoreExpanded(next);
                writeNavFlag(NAV_MORE_KEY, next);
              }}
              title={collapsed ? (moreExpanded ? '收起次要导航' : '展开次要导航') : undefined}
              data-testid="nav-more-toggle"
              aria-expanded={moreExpanded}
            >
              <span className="vh-nav-indicator" />
              <ChevronDown
                size={16}
                strokeWidth={1.8}
                className={cn('transition-transform duration-150', moreExpanded && 'rotate-180')}
              />
              <span className="vh-nav-label">更多</span>
            </button>
            {moreExpanded &&
              moreItems.map((item) => (
                <div key={item.href} className="vh-nav-more-group">
                  {renderNavItem(item)}
                </div>
              ))}
          </>
        )}
      </nav>

      {/* 底部用户卡 */}
      <div className="vh-sidebar-footer">
        <UserCard collapsed={collapsed && !isMobile} />
      </div>
    </aside>
  );

  if (isMobile) {
    return (
      <>
        {/* 移动端抽屉触发按钮由顶栏提供；此处渲染遮罩+抽屉 */}
        {mobileOpen && <div className="vh-drawer-mask" onClick={() => setMobileOpen(false)} />}
        <div className={cn('vh-drawer', mobileOpen && 'open')}>{sidebar}</div>
        <MobileToggle onClick={() => setMobileOpen((v) => !v)} />
      </>
    );
  }

  return sidebar;
}

/** 移动端顶栏抽屉触发按钮（桌面端隐藏） */
function MobileToggle({ onClick }: { onClick: () => void }) {
  return (
    <button className="vh-drawer-trigger" onClick={onClick} aria-label="打开导航">
      <PanelLeftOpen size={18} />
    </button>
  );
}
