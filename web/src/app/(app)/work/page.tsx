'use client';

import { WorkTabs } from '@/components/layout/SectionTabs';
import { WorkQueue } from '@/components/work/WorkQueue';

/** 工作默认落到「我的队列」；缺陷/任务看板降为二级 Tab */
export default function WorkPage() {
  return (
    <div className="flex h-full flex-col">
      <WorkTabs active="queue" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <WorkQueue />
      </div>
    </div>
  );
}
