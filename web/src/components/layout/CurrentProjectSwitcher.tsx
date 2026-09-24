'use client';

import { useVibeHub } from '@/hooks/use-vibehub';
import { useToast } from '@/lib/toast';
import { ProjectSwitcher } from './ProjectSwitcher';

/** 绑定全站「当前项目」的切换器：看板、任务、随手记、文件、技能页共用，切换后跨页保持 */
export function CurrentProjectSwitcher() {
  const store = useVibeHub();
  const toast = useToast();
  return (
    <ProjectSwitcher
      projects={store.projects}
      current={store.currentProject}
      onSelect={store.selectProject}
      onCreate={(name) => {
        store.createProject(name).catch((e) => toast.error(e instanceof Error ? e.message : '创建项目失败'));
      }}
    />
  );
}
