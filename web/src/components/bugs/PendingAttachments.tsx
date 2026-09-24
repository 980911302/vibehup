'use client';

import { Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { Attachment } from '@/lib/api-types';

/**
 * 丢弃尚未挂到缺陷上的已上传附件（功能巡检 B10）：
 * 粘贴即上传，此前移除缩略图或离开页面只清前端状态，文件留在「文件」页成了无主附件。
 * 尽力而为：删除失败不打断用户。
 */
export function discardAttachments(list: Attachment[]): void {
  for (const a of list) void api.deleteAttachment(a.id).catch(() => undefined);
}

/** 录入对话框里的待提交缩略图；移除即删掉服务端文件 */
export function PendingAttachmentThumbs({ attachments, onRemove }: { attachments: Attachment[]; onRemove: (a: Attachment) => void }) {
  return (
    <>
      {attachments.map((a) => (
        <div key={a.id} className="group relative h-20 w-20 overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
          {a.file_type.startsWith('image/') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.public_url ?? ''} alt={a.file_name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center p-1 text-center text-[10px] text-[var(--text-tertiary)]">{a.file_name}</div>
          )}
          <button
            className="absolute right-1 top-1 cursor-pointer rounded bg-black/60 p-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            onClick={() => onRemove(a)}
            aria-label={`移除 ${a.file_name}`}
            data-testid="pending-attachment-remove"
          >
            <Trash2 className="h-3 w-3 text-white" />
          </button>
        </div>
      ))}
    </>
  );
}
