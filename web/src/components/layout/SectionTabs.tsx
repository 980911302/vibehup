'use client';

import { useRouter } from 'next/navigation';
import { Archive, BookOpen, Bug, ListChecks, ListTodo, Puzzle, StickyNote, FolderOpen, type LucideIcon } from 'lucide-react';
import { ProjectMemoryCard } from '@/components/context/ProjectMemoryCard';
import { cn } from '@/lib/utils';

function Tab({
  active,
  label,
  icon: Icon,
  href,
  testId,
}: {
  active: boolean;
  label: string;
  icon: LucideIcon;
  href: string;
  testId?: string;
}) {
  const router = useRouter();
  return (
    <button
      className={cn('flex items-center gap-1.5', active && 'active')}
      onClick={() => router.push(href)}
      aria-current={active ? 'page' : undefined}
      data-testid={testId}
    >
      <Icon size={14} strokeWidth={1.8} />
      {label}
    </button>
  );
}

/** 工作区二级导航：缺陷 / 任务（保留旧 testid 兼容既有 E2E） */
export function WorkTabs({ active }: { active: 'queue' | 'bugs' | 'tasks' | 'archived' }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="t-title-3 text-[var(--text-primary)]">工作</span>
        <span className="t-caption-5 hidden text-[var(--text-tertiary)] sm:inline">当前项目的缺陷与任务</span>
      </div>
      <div className="vh-segmented">
        <Tab active={active === 'queue'} label="队列" icon={ListTodo} href="/work" testId="nav-queue" />
        <Tab active={active === 'bugs'} label="缺陷" icon={Bug} href="/work/bugs" testId="nav-bugs" />
        <Tab active={active === 'tasks'} label="任务" icon={ListChecks} href="/work/tasks" testId="nav-tasks" />
        <Tab active={active === 'archived'} label="已归档" icon={Archive} href="/work/archived" testId="nav-archived" />
      </div>
      <span className="t-caption-5 ml-auto hidden text-[var(--text-tertiary)] md:inline">
        {active === 'archived' ? '已完成默认收在这里' : active === 'queue' ? '我的队列 · 待验收' : '拖拽卡片改状态 · 点开看详情'}
      </span>
    </div>
  );
}

/** 上下文二级导航：随手记 / 文件 / 技能 */
export function ContextTabs({ active }: { active: 'notes' | 'files' | 'skills' }) {
  return (
    <>
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-2.5">
      <div className="flex items-baseline gap-2">
        <BookOpen size={16} className="text-[var(--accent-color)]" />
        <span className="t-title-3 text-[var(--text-primary)]">上下文</span>
        <span className="t-caption-5 hidden text-[var(--text-tertiary)] sm:inline">给 AI 看的项目资料</span>
      </div>
      <div className="vh-segmented">
        <Tab active={active === 'notes'} label="随手记" icon={StickyNote} href="/context/notes" testId="context-notes" />
        <Tab active={active === 'files'} label="文件" icon={FolderOpen} href="/context/files" testId="context-files" />
        <Tab active={active === 'skills'} label="技能" icon={Puzzle} href="/context/skills" testId="context-skills" />
      </div>
      <span className="t-caption-5 ml-auto hidden max-w-[40%] min-w-0 truncate text-right text-[var(--text-tertiary)] md:inline-block">
        笔记、证据与技能，都是 AI 接活时的上下文
      </span>
    </div>
    <ProjectMemoryCard />
    </>
  );
}
