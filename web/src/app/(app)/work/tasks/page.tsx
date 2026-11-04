'use client';

import TasksPage from '../../tasks/page';
import { WorkTabs } from '@/components/layout/SectionTabs';

/** 工作 · 任务：复用现有任务看板 */
export default function WorkTasksPage() {
  return (
    <div className="flex h-full flex-col">
      <WorkTabs active="tasks" />
      <div className="min-h-0 flex-1">
        <TasksPage />
      </div>
    </div>
  );
}
