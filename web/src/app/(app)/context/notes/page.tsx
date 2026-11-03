'use client';

import NotesPage from '../../notes/page';
import { ContextTabs } from '@/components/layout/SectionTabs';

/** 上下文 · 随手记：复用现有便签墙 */
export default function ContextNotesPage() {
  return (
    <div className="flex h-full flex-col">
      <ContextTabs active="notes" />
      <div className="min-h-0 flex-1">
        <NotesPage />
      </div>
    </div>
  );
}
