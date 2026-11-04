'use client';

import { WorkTabs } from '@/components/layout/SectionTabs';
import { ArchivedView } from '@/components/work/ArchivedView';

/** 工作 · 已归档：已完成/已关闭的缺陷与任务，不占看板列 */
export default function WorkArchivedPage() {
  return (
    <div className="flex h-full flex-col">
      <WorkTabs active="archived" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ArchivedView />
      </div>
    </div>
  );
}
