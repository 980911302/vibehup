'use client';

import { type LucideIcon } from 'lucide-react';

export function Feature({
  icon: Icon,
  title,
  body,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <div className="border-t border-[var(--border-strong)] pt-3">
      <p className="t-caption-4 flex items-center gap-1.5 text-[var(--text-primary)]">
        <Icon size={14} className="text-[var(--accent)]" />
        {title}
      </p>
      <p className="t-caption-5 mt-1 text-[var(--text-tertiary)]">{body}</p>
    </div>
  );
}
