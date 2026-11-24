'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderOpen, FolderPlus, Search, Upload } from 'lucide-react';
import { useVibeHub } from '@/hooks/use-vibehub';
import { useAuth, useCanEdit } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { FileGrid } from '@/components/files/FileGrid';
import { UploadProgressStrip } from '@/components/files/UploadProgressStrip';
import { useFileUpload } from '@/hooks/use-file-upload';
import { TextViewer } from '@/components/assets/TextViewer';
import { api } from '@/lib/api';
import { formatSize, isImage, isText, type Attachment } from '@/lib/api-types';
import { cn } from '@/lib/utils';

type Tab = 'all' | 'mine';
type TypeFilter = 'all' | 'image' | 'text' | 'other';

/** 文件工作区：严格隔离当前项目附件，支持拖拽/粘贴/选择上传与灯箱预览 */
export default function FilesPage() {
  const store = useVibeHub();
  const { user } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [lightbox, setLightbox] = useState<{ list: Attachment[]; index: number } | null>(null);
  const [textViewer, setTextViewer] = useState<{ id: string; name: string } | null>(null);

  const isAdmin = user?.role === 'owner' || user?.role === 'admin';
  const canEdit = useCanEdit();
  const projectId = store.currentProject?.id;

  const [mineAttachments, setMineAttachments] = useState<Attachment[]>([]);
  const loadMine = useCallback(async () => {
    if (!user || !projectId) {
      setMineAttachments([]);
      return;
    }
    try {
      setMineAttachments(await api.listAttachments({ mine: true, projectId }));
    } catch {
      // 忽略
    }
  }, [user, projectId]);

  useEffect(() => {
    setMineAttachments([]);
    void loadMine();
  }, [loadMine, store.attachments]);

  const source = tab === 'mine' ? mineAttachments : store.attachments;

  const filtered = useMemo(() => {
    let list = source;
    if (typeFilter === 'image') list = list.filter((a) => isImage(a));
    else if (typeFilter === 'text') list = list.filter((a) => isText(a));
    else if (typeFilter === 'other') list = list.filter((a) => !isImage(a) && !isText(a));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((a) => a.file_name.toLowerCase().includes(q));
    }
    return list;
  }, [source, typeFilter, search]);

  const usage = useMemo(() => source.reduce((sum, a) => sum + a.file_size, 0), [source]);

  const uploadQ = useFileUpload(store.currentProject?.id ?? '');
  const handleFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const uploaded = await uploadQ.upload(files);
      if (uploaded.length > 0) {
        await store.refreshAttachments();
        toast.success(`已上传 ${uploaded.length} 个文件`);
      }
      if (uploaded.length < files.length) toast.error(`${files.length - uploaded.length} 个文件上传失败，可重试`);
      void loadMine();
    },
    [uploadQ, store, toast, loadMine],
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length || !canEdit) return;
      if ((e.target as HTMLElement | null)?.closest('[role="dialog"]')) return;
      e.preventDefault();
      void handleFiles(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleFiles, canEdit]);

  const canDeleteFile = (a: Attachment) => canEdit && (a.uploaded_by === user?.id || isAdmin);

  const deleteFile = async (a: Attachment) => {
    await store.deleteAttachment(a.id);
    toast.success(`已删除 ${a.file_name}`);
    void loadMine();
  };

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
      if (e.key === 'ArrowLeft') setLightbox((lb) => lb && { ...lb, index: Math.max(0, lb.index - 1) });
      if (e.key === 'ArrowRight') setLightbox((lb) => lb && { ...lb, index: Math.min(lb.list.length - 1, lb.index + 1) });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  if (!store.loading && !store.currentProject) {
    return (
      <div className="flex h-full flex-col">
        <WorkspaceHeader title="文件" />
        <div className="vh-empty flex-1">
          <span className="vh-empty-icon"><FolderOpen size={24} strokeWidth={1.6} /></span>
          <p className="vh-empty-title">还没有项目</p>
          <p className="vh-empty-hint">文件按项目物理隔离存储；录缺陷粘贴的截图也会自动归入当前项目</p>
          <button
            type="button"
            className="vh-btn h-8 text-xs"
            onClick={() => window.dispatchEvent(new CustomEvent('vibehub:open-onboarding'))}
            data-testid="files-empty-create"
          >
            <FolderPlus size={14} /> 创建第一个项目
          </button>
        </div>
      </div>
    );
  }

  const current = lightbox?.list[lightbox.index] ?? null;

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (canEdit) void handleFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <WorkspaceHeader
        title="文件"
        badge={filtered.length}
        subtitle={`共 ${formatSize(usage)}`}
        actions={
          canEdit ? (
            <label className="vh-btn h-8 cursor-pointer px-2.5 text-xs" data-testid="files-upload">
              <Upload size={13} />
              上传文件
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  void handleFiles(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
            </label>
          ) : undefined
        }
      />

      <div className="vh-ws-toolbar">
        <div className="vh-segmented">
          {(['all', 'mine'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={cn('!h-7 !px-2.5 !text-xs', tab === t && 'active')}
              onClick={() => setTab(t)}
              data-testid={`files-tab-${t}`}
            >
              {t === 'all' ? '项目全部' : '我上传的'}
            </button>
          ))}
        </div>

        <select
          className="vh-input-compact px-2"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
        >
          <option value="all">全部类型</option>
          <option value="image">图片与截图</option>
          <option value="text">文本与日志</option>
          <option value="other">其他附件</option>
        </select>

        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input
            className="vh-input-compact w-48 pl-7"
            placeholder="搜索文件名"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <span className="ml-auto hidden text-xs text-[var(--text-tertiary)] md:inline">
          支持拖拽文件到页面或直接 Ctrl+V 粘贴上传
        </span>
      </div>

      {uploadQ.items.length > 0 && (
        <div className="border-b border-[var(--border-subtle)] px-5 py-2">
          <UploadProgressStrip items={uploadQ.items} onRetry={(id) => void uploadQ.retry(id)} onDismiss={uploadQ.dismiss} />
        </div>
      )}

      <div className={cn('vh-ws-scroll', dragOver && 'bg-[var(--gold-bg)]/35')}>
        <div className="vh-ws-container">
          <FileGrid
            attachments={filtered}
            canDeleteFile={canDeleteFile}
            onOpenImage={(a) => {
              const images = filtered.filter(isImage);
              setLightbox({ list: images, index: Math.max(0, images.findIndex((i) => i.id === a.id)) });
            }}
            onOpenText={(a) => setTextViewer({ id: a.id, name: a.file_name })}
            onDelete={(a) => void deleteFile(a)}
          />
        </div>
      </div>

      {lightbox && current && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90" onClick={() => setLightbox(null)}>
          <div className="flex items-center justify-between px-5 py-3 text-white">
            <span className="text-sm">{current.file_name}</span>
            <span className="text-xs text-white/60">
              {lightbox.index + 1} / {lightbox.list.length} · ←→ 切换 · Esc 关闭
            </span>
          </div>
          <div className="flex flex-1 items-center justify-center p-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={current.public_url ?? ''} alt={current.file_name} className="max-h-full max-w-full object-contain" />
          </div>
          <div className="px-5 py-3 text-center text-xs text-white/60">
            {current.width && current.height ? `${current.width}×${current.height} · ` : ''}
            {formatSize(current.file_size)} · {current.file_type}
          </div>
        </div>
      )}

      {textViewer && (
        <TextViewer
          attachmentId={textViewer.id}
          fileName={textViewer.name}
          onClose={() => setTextViewer(null)}
        />
      )}
    </div>
  );
}
