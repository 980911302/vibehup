'use client';

import { useRouter } from 'next/navigation';
import { FileText, FolderOpen, Image as ImageIcon, Trash2 } from 'lucide-react';
import { formatSize, isImage, isText, type Attachment } from '@/lib/api-types';

/** 文件网格（步骤 07 §7.2） */
export function FileGrid({
  attachments, canDeleteFile, onOpenImage, onOpenText, onDelete,
}: {
  attachments: Attachment[];
  canDeleteFile: (a: Attachment) => boolean;
  onOpenImage: (a: Attachment) => void;
  onOpenText: (a: Attachment) => void;
  onDelete: (a: Attachment) => void;
}) {
  const router = useRouter();

  if (attachments.length === 0) {
    return (
      <div className="vh-empty">
        <span className="vh-empty-icon"><FolderOpen size={28} strokeWidth={1.6} /></span>
        <p className="vh-empty-title">还没有文件</p>
        <p className="vh-empty-hint">拖文件到页面任意处，或 Ctrl+V 粘贴截图</p>
        <button className="vh-btn" onClick={() => router.push('/board')} data-testid="files-empty-goto-board">
          去录一笔缺陷（带截图）
        </button>
        <p className="vh-empty-hint">
          或按 <span className="vh-kbd">C</span> 在看板页快速录入
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" data-testid="file-grid">
      {attachments.map((a) => {
        const isAi = a.uploaded_by?.startsWith('key_') ?? false;
        return (
          <div key={a.id} className="group relative overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-card)]" data-testid="file-card">
            {isImage(a) ? (
              <button className="block w-full cursor-pointer" onClick={() => onOpenImage(a)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.public_url ?? ''} alt={a.file_name} loading="lazy"
                  className="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-105" />
              </button>
            ) : (
              <button
                className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1.5 bg-[var(--bg-elevated)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer"
                onClick={() => isText(a) && onOpenText(a)}
              >
                <FileText className="h-7 w-7" />
                <span className="px-2 text-[11px] line-clamp-2">{a.file_name}</span>
                {isText(a) && <span className="text-[10px] text-[var(--brand)]">在线查看</span>}
              </button>
            )}
            <div className="flex items-center justify-between px-2.5 py-2">
              <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
                {isImage(a) ? <ImageIcon size={12} className="shrink-0" /> : <FileText size={12} className="shrink-0" />}
                <span className="truncate">{a.file_name}</span>
              </span>
              <span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">{formatSize(a.file_size)}</span>
            </div>
            {isAi && <span className="vh-ai-badge absolute left-2 top-2" title="MCP 密钥上传">AI</span>}
            {canDeleteFile(a) && (
              <button
                className="absolute right-2 top-2 rounded-md bg-black/50 p-1.5 text-white opacity-0 transition-opacity hover:bg-[var(--danger)] group-hover:opacity-100 cursor-pointer"
                onClick={() => onDelete(a)}
                title="删除文件"
              >
                <Trash2 size={13} />
              </button>
            )}
            {a.entity_type === 'bug' && a.entity_id && (
              <span className="absolute bottom-12 left-2 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
                关联缺陷
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
