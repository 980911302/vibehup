'use client';

import BoardPage from '../../board/page';
import { WorkTabs } from '@/components/layout/SectionTabs';

/** 工作 · 缺陷：复用现有看板（R89：只换壳，不重写业务） */
export default function WorkBugsPage() {
  return (
    <div className="flex h-full flex-col">
      <WorkTabs active="bugs" />
      <div className="min-h-0 flex-1">
        <BoardPage />
      </div>
    </div>
  );
}
