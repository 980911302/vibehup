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
import { VibeHubProvider } from '@/hooks/use-vibehub';

const ONBOARDED_KEY = 'vibehub_onboarded';

/**
 * 应用壳（R89 四区重做）：浮动顶栏 + 今日/工作/上下文/设置四区，
 * 当前项目与 SSE 仍只在 VibeHubProvider 实例化一次（AGENTS.md 前端契约）。
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // 首启向导：登录后未完成过引导则自动弹出；空态按钮也可唤起
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
  // 竞态防护：登录成功后的 router.replace 可能在本上下文提交前触发导航，
  // 读到旧上下文（user=null）会把用户踢回；有 token = 恢复中，等待而非踢回。
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

  // 全局快捷键：四区导航 + 兼容旧入口；C 由页面自己注册（今日/工作需要打开录入框）
  useHotkeys([
    { combo: 'mod+k', description: '命令面板', handler: () => setPaletteOpen(true), allowInInput: true },
    { combo: '?', description: '帮助', handler: () => setHelpOpen((v) => !v) },
    { combo: 'g d', description: '今日', handler: () => router.push('/today') },
    { combo: 'g w', description: '工作', handler: () => router.push('/work') },
    { combo: 'g c', description: '上下文', handler: () => router.push('/context') },
    { combo: 'g s', description: '设置', handler: () => router.push('/settings') },
    { combo: 'g b', description: '工作 · 缺陷', handler: () => router.push('/work/bugs') },
    { combo: 'g t', description: '工作 · 任务', handler: () => router.push('/work/tasks') },
    { combo: 'g n', description: '上下文 · 随手记', handler: () => router.push('/context/notes') },
    { combo: 'g f', description: '上下文 · 文件', handler: () => router.push('/context/files') },
    { combo: 'g k', description: '设置 · 我的密钥', handler: () => router.push('/keys') },
    { combo: 'g m', description: '设置 · 成员', handler: () => router.push('/members') },
    { combo: 'g p', description: '设置 · 项目', handler: () => router.push('/projects') },
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
      <div className="vh-shell">
        <AppNav
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenHelp={() => setHelpOpen(true)}
          onOpenActivity={() => setActivityOpen(true)}
        />
        <main className="vh-main">{children}</main>

        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onNewBug={() => {
            setPaletteOpen(false);
            router.push('/work/bugs?new=1');
          }}
        />
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
    </VibeHubProvider>
  );
}
