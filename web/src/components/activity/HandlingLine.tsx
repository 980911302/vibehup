'use client';

import { AlertTriangle, Sparkles, User } from 'lucide-react';
import { handlingOf } from '@/lib/stale';
import { useMinuteClock } from '@/hooks/use-minute-clock';
import type { StatusActor } from '@/lib/api-types';

interface HandlingItem {
  status: string;
  status_changed_at: string | null;
  status_actor: StatusActor | null;
  updated_at: string;
}

/**
 * 卡片上的「谁在处理 · 多久」（R83）：验证中 / 进行中才显示；
 * 停留过久（验证中 >2 小时、进行中 >24 小时）标黄，提示处理方可能已中断。
 */
export function HandlingLine({ item, className = 'mb-1.5' }: { item: HandlingItem; className?: string }) {
  const now = useMinuteClock();
  const h = handlingOf(item, now);
  if (!h) return null;
  const Icon = h.stale ? AlertTriangle : h.actor?.type === 'ai' ? Sparkles : User;
  const who = h.actor ? `${h.actor.name} · ` : '';
  const text = h.stale ? `已停留 ${h.span}` : h.actor ? h.span : `已 ${h.span}`;
  return (
    // 行内排版：窄列里名字与时长自然折行，不把名字截成一个字
    <div
      className={`${className} break-all text-[11px] leading-snug ${h.stale ? 'text-[var(--warn)]' : 'text-[var(--text-tertiary)]'}`}
      title={`${who}${h.stale ? `已停留 ${h.span}，处理方可能已中断` : `已处理 ${h.span}`}`}
      data-testid="handling-line"
      data-stale={h.stale ? 'true' : 'false'}
    >
      {(h.actor || h.stale) && <Icon size={11} className="mr-1 inline-block align-[-2px]" />}
      {who}
      <span className="whitespace-nowrap">{text}</span>
    </div>
  );
}
