'use client';

import { ArrowRight, type LucideIcon } from 'lucide-react';

export function TeamCard({
  icon: Icon,
  title,
  description,
  action,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <section className="vh-card flex flex-col p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="t-title-3">{title}</h2>
          <p className="t-caption-5 mt-1 text-[var(--text-tertiary)]">{description}</p>
        </div>
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
          <Icon size={16} />
        </span>
      </div>
      <button className="vh-btn ghost mt-4 w-fit" onClick={onClick}>
        {action} <ArrowRight size={14} />
      </button>
    </section>
  );
}
