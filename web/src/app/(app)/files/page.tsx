'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderOpen, FolderPlus, Upload } from 'lucide-react';
import { useVibeHub } from '@/hooks/use-vibehub';
import { CurrentProjectSwitcher } from '@/components/layout/CurrentProjectSwitcher';
import { useCanEdit } from '@/lib/auth';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { FileGrid } from '@/components/files/FileGrid';
import { UploadProgressStrip } from '@/components/files/UploadProgressStrip';
import { useFileUpload } from '@/hooks/use-file-upload';
import { TextViewer } from '@/components/assets/TextViewer';
import { api } from '@/lib/api';
import { formatSize, isImage, type Attachment } from '@/lib/api-types';

type Tab = 'mine' | 'all';
type TypeFilter = 'all' | 'image' | 'text' | 'other';

/** 文件页（步骤 07 §7.2）：我的/全部、三上传入口、灯箱、在线查看 */
export default function FilesPage() {
  const store = useVibeHub();
  const { user } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>('mine');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [lightbox, setLightbox] = useState<{ list: Attachment[]; index: number } | null>(null);
  const [textViewer, setTextViewer] = useState<{ id: string; name: string } | null>(null);

  const isAdmin = user?.role === 'owner' || user?.role === 'admin';
  const canEdit = useCanEdit();

  // 我的文件（服务端 mine 过滤，限当前项目——与顶栏的项目切换一致）
  const [mineAttachments, setMineAttachments] = useState<Attachment[]>([]);
  const projectId = store.currentProject?.id;
  const loadMine = useCallback(async () => {
    if (!user || !projectId) return;
    try {
      setMineAttachments(await api.listAttachments({ mine: true, projectId }));
    } catch {
      // 忽略：列表加载失败保留旧数据
    }
  }, [user, projectId]);

  useEffect(() => {
    void loadMine();
  }, [loadMine, store.attachments]);

  const source = tab === 'mine' ? mineAttachments : store.attachments;

  const filtered = useMemo(() => {
    let list = source;
    if (typeFilter === 'image') list = list.filter((a) => isImage(a));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((a) => a.file_name.toLowerCase().includes(q));
    }
    return list;
  }, [source, typeFilter, search]);

  const usage = useMemo(() => source.reduce((sum, a) => sum + a.file_size, 0), [source]);

  // 上传队列（卡片 37：逐文件进度 + 失败重试）
  const uploadQ = useFileUpload(store.currentProject?.id ?? '');
  const handleFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const uploaded = await uploadQ.upload(files);
    if (uploaded.length > 0) toast.success(`已上传 ${uploaded.length} 个文件`);
    if (uploaded.length < files.length) toast.error(`${files.length - uploaded.length} 个文件上传失败，可重试`);
    void loadMine();
  }, [uploadQ, toast, loadMine]);

  // 全局 Ctrl+V 粘贴上传
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length || !canEdit) return;
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

  // 灯箱键盘：←→ 切换 / Esc 关闭
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

  if (!store.currentProject) {
    return (
      <div className="vh-empty" style={{ height: '100%' }}>
        <span className="vh-empty-icon"><FolderOpen size={28} strokeWidth={1.6} /></span>
        <p className="vh-empty-title">还没有项目</p>
        <p className="vh-empty-hint">文件按项目归档；建好项目后录缺陷时粘贴截图即自动入库</p>
        <button
          className="vh-btn"
          onClick={() => window.dispatchEvent(new CustomEvent('vibehub:open-onboarding'))}
          data-testid="files-empty-create"
        >
          <FolderPlus size={14} />
          创建第一个项目
        </button>
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
      {/* 顶栏 */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-2.5">
        <CurrentProjectSwitcher />
        <div className="flex gap-1 rounded-lg bg-[var(--bg-elevated)] p-0.5">
          {(['mine', 'all'] as const).map((t) => (
            <button
              key={t}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                tab === t ? 'bg-[var(--bg-page)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-tertiary)]'
              }`}
              onClick={() => setTab(t)}
              data-testid={`files-tab-${t}`}
            >
              {t === 'mine' ? '我的文件' : '全部文件'}
            </button>
          ))}
        </div>

        <select
          className="h-8 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-2 text-xs outline-none"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
        >
          <option value="all">全部类型</option>
          <option value="image">图片</option>
          <option value="text">文本/日志</option>
        </select>

        <input
          className="h-8 w-48 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-2.5 text-xs outline-none focus:border-[var(--brand)]"
          placeholder="搜索文件名"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="flex-1" />

        {/* 用量条 */}
        <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
          <span>{filtered.length} 个文件</span>
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
            <div className="h-full rounded-full bg-[var(--gold)] transition-[width]" style={{ width: `${Math.min(100, (usage / (50 * 1024 * 1024)) * 100)}%` }} />
          </div>
          <span>{formatSize(usage)}</span>
        </div>

        {canEdit && <label className="vh-btn h-8 cursor-pointer text-xs" data-testid="files-upload">
          <Upload size={13} />
          上传
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleFiles(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
        </label>}
      </div>

      {/* 上传进度条（卡片 37） */}
      {uploadQ.items.length > 0 && (
        <div className="border-b border-[var(--border-subtle)] px-4 py-2">
          <UploadProgressStrip items={uploadQ.items} onRetry={(id) => void uploadQ.retry(id)} onDismiss={uploadQ.dismiss} />
        </div>
      )}

      {/* 网格 */}
      <div className={`flex-1 overflow-y-auto p-4 ${dragOver ? 'bg-[var(--gold-bg)]/40' : ''}`}>
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

      {/* 图片灯箱 */}
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
