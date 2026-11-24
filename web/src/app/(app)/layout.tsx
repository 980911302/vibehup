'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useHotkeys } from '@/lib/shortcuts';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { ShortcutsHelp } from '@/components/layout/ShortcutsHelp';
import { AppNav } from '@/components/layout/AppNav';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { ActivityPanel } from '@/components/activity/ActivityPanel';
import { WorkItemOverlayProvider } from '@/components/work/WorkItemOverlay';
import { VibeHubProvider } from '@/hooks/use-vibehub';

const ONBOARDED_KEY = 'vibehub_onboarded';

/**
 * 应用壳：紧凑左侧边栏 + 右侧全屏对齐工作区 + 全站原地工作项弹窗宿主。
 * 当前项目与唯一 SSE 连接只在 VibeHubProvider 实例化一次（AGENTS.md 前端契约）。
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  useEffect(() => {
    if (!ready || !user) return;
    try {
      if (localStorage.getItem(ONBOARDED_KEY) !== '1') setOnboardOpen(true);
    } catch {
      // 隐私模式
    }
  }, [ready, user]);

  useEffect(() => {
    const onOpen = () => setOnboardOpen(true);
    window.addEventListener('vibehub:open-onboarding', onOpen);
    return () => window.removeEventListener('vibehub:open-onboarding', onOpen);
  }, []);

  useEffect(() => {
    if (ready && !user) {
      let hasToken = false;
      try {
        hasToken = !!localStorage.getItem('vibehub_token');
      } catch {
        // 隐私模式
      }
      if (hasToken) return;
      const redirect = encodeURIComponent(window.location.pathname + window.location.search);
      router.replace(`/login?redirect=${redirect}`);
    }
  }, [ready, user, router]);

  useHotkeys([
    { combo: 'mod+k', description: '命令面板', handler: () => setPaletteOpen(true), allowInInput: true },
    { combo: '?', description: '帮助', handler: () => setHelpOpen((v) => !v) },
    { combo: 'c', description: '快速录缺陷', handler: () => window.dispatchEvent(new CustomEvent('vibehub:quick-capture')) },
    { combo: 'g d', description: '项目概览', handler: () => router.push('/today') },
    { combo: 'g w', description: '缺陷看板', handler: () => router.push('/work/bugs') },
    { combo: 'g c', description: '随手记', handler: () => router.push('/context/notes') },
    { combo: 'g s', description: '全局设置', handler: () => router.push('/settings') },
    { combo: 'g b', description: '缺陷', handler: () => router.push('/work/bugs') },
    { combo: 'g t', description: '任务', handler: () => router.push('/work/tasks') },
    { combo: 'g n', description: '随手记', handler: () => router.push('/context/notes') },
    { combo: 'g f', description: '文件', handler: () => router.push('/context/files') },
    { combo: 'g k', description: 'MCP 密钥', handler: () => router.push('/keys') },
    { combo: 'g m', description: '成员管理', handler: () => router.push('/members') },
    { combo: 'g p', description: '项目管理', handler: () => router.push('/projects') },
  ]);

  if (!ready || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg-page)] text-[var(--text-tertiary)]">
        <span className="vh-spinner" />
      </div>
    );
  }

  return (
    <VibeHubProvider>
      <WorkItemOverlayProvider>
        <div className="vh-shell">
          <AppNav
            onOpenPalette={() => setPaletteOpen(true)}
            onOpenHelp={() => setHelpOpen(true)}
            onOpenActivity={() => setActivityOpen(true)}
          />
          <main className="vh-main">{children}</main>

          <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
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
      </WorkItemOverlayProvider>
    </VibeHubProvider>
  );
}
