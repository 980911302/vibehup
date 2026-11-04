'use client';

import { useEffect, useState } from 'react';
import { useVibeHub } from '@/hooks/use-vibehub';
import { useCanEdit } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { CreateBugDialog } from './CreateBugDialog';

/**
 * 全局快速录单（R89 迭代 1）：任何页面按 C 或点顶栏＋都能打开，
 * 复用 CreateBugDialog 的粘贴截图/模板/上传能力；没有项目时唤起首启向导。
 */
export function QuickCapture() {
  const store = useVibeHub();
  const canEdit = useCanEdit();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onCapture = () => {
      if (!canEdit) return;
      if (!store.currentProject) {
        window.dispatchEvent(new CustomEvent('vibehub:open-onboarding'));
        return;
      }
      setOpen(true);
    };
    window.addEventListener('vibehub:quick-capture', onCapture);
    return () => window.removeEventListener('vibehub:quick-capture', onCapture);
  }, [canEdit, store.currentProject]);

  if (!store.currentProject) return null;

  return (
    <CreateBugDialog
      open={open}
      onOpenChange={setOpen}
      projectName={store.currentProject.name}
      templates={store.templates}
      pendingFiles={[]}
      onConsumePendingFiles={() => undefined}
      onSubmit={async (input) => {
        const bug = await store.createBug(input);
        window.dispatchEvent(new CustomEvent('vibehub:record-created'));
        toast.success('已记录，去工作里看进度');
        return bug;
      }}
      projectId={store.currentProject.id}
    />
  );
}
