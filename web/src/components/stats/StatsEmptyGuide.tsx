'use client';

import { ArrowRight, BarChart3, CheckCircle2, ListChecks, PlusCircle, Sparkles } from 'lucide-react';

function Step({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof PlusCircle;
  title: string;
  hint: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
        <Icon size={15} strokeWidth={1.8} />
      </span>
      <span className="min-w-0">
        <span className="t-caption-1 block text-[var(--text-primary)]">{title}</span>
        <span className="t-caption-5 block text-[var(--text-tertiary)]">{hint}</span>
      </span>
    </li>
  );
}

/** 完全空数据时的引导卡：不伪造数据，只说明统计从哪里来 */
export function StatsEmptyGuide({ onOpenWork, onOpenToday }: { onOpenWork: () => void; onOpenToday: () => void }) {
  return (
    <section className="vh-card mt-5 p-6" data-testid="stats-empty-guide">
      <div className="grid gap-7 lg:grid-cols-[1.15fr_1fr] lg:gap-10">
        <div>
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--accent-color)]">
            <BarChart3 size={20} strokeWidth={1.8} />
          </span>
          <h2 className="t-title-2 mt-4">统计从第一次状态流转开始</h2>
          <p className="t-caption-2 mt-2 max-w-[520px] text-[var(--text-secondary)]">
            这里不额外采集数据。缺陷或任务被 AI / 人推进到「已验证」「已完成」后，今天的产出、还剩多少、经手人与 14 天趋势会一起出现在这里。
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button className="vh-btn" onClick={onOpenWork} data-testid="stats-empty-work">
              <ListChecks size={15} /> 去工作台
            </button>
            <button className="vh-btn ghost" onClick={onOpenToday} data-testid="stats-empty-today">
              回到今日 <ArrowRight size={15} />
            </button>
          </div>
        </div>
        <ol className="space-y-3.5 border-t border-[var(--border-subtle)] pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <Step icon={PlusCircle} title="录一条缺陷或任务" hint="在今日或工作页快速录入" />
          <Step icon={Sparkles} title="AI 接手并推进状态" hint="经手人会记成 MCP 密钥名" />
          <Step icon={CheckCircle2} title="人验收，数字开始累积" hint="今天与最近 14 天自动更新" />
        </ol>
      </div>
    </section>
  );
}
