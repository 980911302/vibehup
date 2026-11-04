'use client';

import SkillsPage from '../../skills/page';
import { ContextTabs } from '@/components/layout/SectionTabs';

/** 上下文 · 技能：复用现有技能库 */
export default function ContextSkillsPage() {
  return (
    <div className="flex h-full flex-col">
      <ContextTabs active="skills" />
      <div className="min-h-0 flex-1">
        <SkillsPage />
      </div>
    </div>
  );
}
