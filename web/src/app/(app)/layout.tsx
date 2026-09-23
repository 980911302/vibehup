'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FolderKanban, Keyboard, Moon, Search, Sparkles, Sun } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { useToast } from '@/lib/toast';
import { useHotkeys } from '@/lib/shortcuts';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { ShortcutsHelp } from '@/components/layout/ShortcutsHelp';
import { Sidebar } from '@/components/layout/Sidebar';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { ActivityPanel } from '@/components/activity/ActivityPanel';

const ONBOARDED_KEY = 'vibehub_onboarded';

/**
 * 应用壳（卡片 15 守卫 + 卡片 16 顶栏/快捷键/面板；侧边栏在卡片 17）。
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const { theme, toggle } = useTheme();
  const toast = useToast();
  const router = useRouter();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // 首启向导（卡片 33）：登录后未完成过引导则自动弹出；空态「创建项目」也可唤起
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  useEffect(() => {
    if (!ready || !user) return;
    try {
      if (localStorage.getItem(ONBOARDED_KEY) !== '1') setOnboardOpen(true);
    } catch {
      // 隐私模式：不弹向导也不报错
    }
  }, [ready, user]);

  // 空态按钮 / 其他入口通过事件唤起向导（避免跨组件 prop 钻孔）
  useEffect(() => {
    const onOpen = () => setOnboardOpen(true);
    window.addEventListener('vibehub:open-onboarding', onOpen);
    return () => window.removeEventListener('vibehub:open-onboarding', onOpen);
  }, []);

  // 守卫：未登录 → /login（带 redirect 回跳）
  // 竞态防护（卡片 31）：登录成功后的 router.replace 可能在 React 提交新上下文前触发导航，
  // 导致本守卫读到旧上下文（user=null）把用户踢回登录页，与 setUser 效果赛跑。
  // 因此踢回前先确认 localStorage 无 token：有 token = 刚登录/恢复中，等待而不是踢回。
  useEffect(() => {
    if (ready && !user) {
      let hasToken = false;
      try {
        hasToken = !!localStorage.getItem('vibehub_token');
      } catch {
        // 隐私模式：无存储视为未登录
      }
      if (hasToken) return;
      const redirect = encodeURIComponent(window.location.pathname + window.location.search);
      router.replace(`/login?redirect=${redirect}`);
    }
  }, [ready, user, router]);

  // 全局快捷键（输入态自动放行）
  useHotkeys([
    { combo: 'mod+k', description: '命令面板', handler: () => setPaletteOpen(true), allowInInput: true },
    { combo: '?', description: '帮助', handler: () => setHelpOpen((v) => !v) },
    { combo: 'g b', description: '看板', handler: () => router.push('/board') },
    { combo: 'g f', description: '文件', handler: () => router.push('/files') },
    { combo: 'g n', description: '随手记', handler: () => router.push('/notes') },
    { combo: 'g t', description: '任务', handler: () => router.push('/tasks') },
    { combo: 'g p', description: '项目', handler: () => router.push('/projects') },
    { combo: 'g k', description: '密钥', handler: () => router.push('/keys') },
    { combo: 'g m', description: '成员', handler: () => router.push('/members') },
    {
      combo: 'c',
      description: '新建缺陷',
      handler: () => toast.info('快速录入面板随看板页（卡片 18）一同落地'),
    },
  ]);

  if (!ready || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg-page)] text-[var(--text-tertiary)]">
        <span className="vh-spinner" />
      </div>
    );
  }

  return (
    <div className="vh-shell">
      <header className="vh-topbar">
        {/* 品牌（桌面端隐藏由侧边栏承担；仅移动端显示，见 globals.css .vh-topbar-brand） */}
        <div className="vh-topbar-brand flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--brand)] text-white">
            <FolderKanban size={15} />
          </div>
          <span className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">VibeHub</span>
          <i className="vh-gold-dot" />
        </div>

        <div className="flex-1" />

        {/* 命令面板 */}
        <button className="vh-btn ghost" onClick={() => setPaletteOpen(true)} data-testid="open-palette">
          <Search size={14} />
          <span className="hidden sm:inline">搜索</span>
          <span className="vh-kbd">⌘K</span>
        </button>

        {/* AI 活动（卡片 36：全员可见的 AI 调用流） */}
        <button
          className="vh-icon-btn"
          onClick={() => setActivityOpen(true)}
          title="AI 活动——Agent 最近读取了哪些上下文"
          data-testid="open-activity"
        >
          <Sparkles size={16} />
        </button>

        {/* 帮助 */}
        <button className="vh-icon-btn" onClick={() => setHelpOpen(true)} title="快捷键帮助（?）">
          <Keyboard size={16} />
        </button>

        {/* 主题切换 */}
        <button
          className="vh-icon-btn"
          onClick={toggle}
          title={theme === 'midnight' ? '切换到纸白主题' : '切换到暗色主题'}
          data-testid="theme-toggle"
        >
          {theme === 'midnight' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </header>

      <div className="vh-body">
        <Sidebar />
        <main className="vh-main">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNewBug={() => setPaletteOpen(false)} />
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <OnboardingWizard open={onboardOpen} onOpenChange={setOnboardOpen} />
      <ActivityPanel open={activityOpen} onClose={() => setActivityOpen(false)} />

      <style jsx global>{`
        .vh-spinner {
          width: 18px; height: 18px; border-radius: 50%;
          border: 2px solid var(--border-strong); border-top-color: var(--brand);
          display: inline-block; animation: vh-spin .8s linear infinite;
        }
      `}</style>
    </div>
  );
}
