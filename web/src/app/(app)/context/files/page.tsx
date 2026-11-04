'use client';

import FilesPage from '../../files/page';
import { ContextTabs } from '@/components/layout/SectionTabs';

/** 上下文 · 文件：复用现有文件库 */
export default function ContextFilesPage() {
  return (
    <div className="flex h-full flex-col">
      <ContextTabs active="files" />
      <div className="min-h-0 flex-1">
        <FilesPage />
      </div>
    </div>
  );
}
