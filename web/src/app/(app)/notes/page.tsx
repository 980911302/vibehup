'use client';

import { useState } from 'react';
import { FolderPlus, Plus, StickyNote } from 'lucide-react';
import { useVibeHub } from '@/hooks/use-vibehub';
import { useToast } from '@/lib/toast';
import { useCanEdit } from '@/lib/auth';
import { useHotkeys } from '@/lib/shortcuts';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { ProjectMemoryCard } from '@/components/context/ProjectMemoryCard';
import { NoteWall } from '@/components/notes/NoteWall';

/** 随手记工作区：统一顶栏 + 项目记忆条 + 左索引右全文双栏，严格归属当前项目 */
export default function NotesPage() {
  const store = useVibeHub();
  const toast = useToast();
  const canEdit = useCanEdit();
  const [composing, setComposing] = useState(false);

  useHotkeys([{ combo: 'n', description: '新建随手记', handler: () => canEdit && setComposing(true) }]);

  const createNote = async (content: string, tags: string[]) => {
    await store.createNote(content, tags);
    setComposing(false);
    toast.success('已记录到当前项目');
  };

  const togglePin = async (noteId: string, pinned: boolean) => {
    await store.updateNote(noteId, { pinned });
    toast.success(pinned ? '已置顶至项目记忆' : '已取消置顶');
  };

  const deleteNote = async (noteId: string) => {
    await store.deleteNote(noteId);
    toast.success('已删除');
  };

  if (!store.loading && !store.currentProject) {
    return (
      <div className="flex h-full flex-col">
        <WorkspaceHeader title="随手记" />
        <div className="vh-empty flex-1">
          <span className="vh-empty-icon"><StickyNote size={24} strokeWidth={1.6} /></span>
          <p className="vh-empty-title">请先创建项目</p>
          <p className="vh-empty-hint">随手记与置顶项目记忆按项目严格隔离存储</p>
          <button
            type="button"
            className="vh-btn h-8 text-xs"
            onClick={() => window.dispatchEvent(new CustomEvent('vibehub:open-onboarding'))}
          >
            <FolderPlus size={14} /> 创建第一个项目
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader
        title="随手记"
        badge={store.notes.length}
        subtitle="置顶笔记将作为项目记忆自动随 MCP 下发给 AI"
        actions={
          canEdit ? (
            <button type="button" className="vh-btn h-8 px-2.5 text-xs" onClick={() => setComposing(true)} data-testid="note-new">
              <Plus size={14} /> 记一笔
            </button>
          ) : undefined
        }
      />
      <ProjectMemoryCard />
      <div className="min-h-0 flex-1">
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
      </div>
    </div>
  );
}
