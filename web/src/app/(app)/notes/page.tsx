'use client';

import { useState } from 'react';
import { StickyNote } from 'lucide-react';
import { useVibeHub } from '@/hooks/use-vibehub';
import { useToast } from '@/lib/toast';
import { useCanEdit } from '@/lib/auth';
import { useHotkeys } from '@/lib/shortcuts';
import { NoteWall } from '@/components/notes/NoteWall';

/** 随手记页（卡片 27，补 R17 登记的 IA 缺口）：数据来自 use-vibehub 中枢 */
export default function NotesPage() {
  const store = useVibeHub();
  const toast = useToast();
  const canEdit = useCanEdit();
  const [composing, setComposing] = useState(false);

  // N 新建（随手记页内生效；与全局 C=新建缺陷不冲突）
  useHotkeys([{ combo: 'n', description: '新建随手记', handler: () => canEdit && setComposing(true) }]);

  const createNote = async (content: string, tags: string[]) => {
    await store.createNote(content, tags);
    setComposing(false);
    toast.success('已记录');
  };

  const togglePin = async (noteId: string, pinned: boolean) => {
    await store.updateNote(noteId, { pinned });
    toast.success(pinned ? '已置顶' : '已取消置顶');
  };

  const deleteNote = async (noteId: string) => {
    await store.deleteNote(noteId);
    toast.success('已删除');
  };

  if (!store.currentProject) {
    return (
      <div className="vh-empty" style={{ height: '100%' }}>
        <span className="vh-empty-icon"><StickyNote size={28} strokeWidth={1.6} /></span>
        <p className="vh-empty-title">请先创建项目</p>
        <p className="vh-empty-hint">随手记按项目归档，先去看板页建一个项目</p>
      </div>
    );
  }

  return (
    <NoteWall
      notes={store.notes}
      noteTags={store.noteTags}
      composerOpen={composing}
      onOpenComposer={() => setComposing(true)}
      onCloseComposer={() => setComposing(false)}
      onCreateNote={createNote}
      onTogglePin={togglePin}
      onUpdateNote={(id, patch) => store.updateNote(id, patch)}
      onDeleteNote={deleteNote}
    />
  );
}
