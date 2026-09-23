'use client';

import { FileText, Image as ImageIcon, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatSize, isImage, isText, type Attachment } from '@/lib/types';

interface AssetPoolProps {
  attachments: Attachment[];
  onUpload: (files: File[]) => void;
  onDeleteAttachment: (attachmentId: string) => void;
  onOpenText: (attachmentId: string, fileName: string) => void;
}

/** 附件资产池：按项目归档的截图、录屏与 .log / .json 数据包，支持直链与在线文本查看 */
export function AssetPool({
  attachments,
  onUpload,
  onDeleteAttachment,
  onOpenText,
}: AssetPoolProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<'all' | 'image' | 'text'>('all');

  const filtered = attachments.filter((a) => {
    if (filter === 'image') return isImage(a);
    if (filter === 'text') return isText(a);
    return true;
  });

  return (
    <div className="flex h-full flex-col" data-testid="asset-pool">
      <div className="flex items-center justify-between px-1 pb-2">
        <div className="flex gap-1">
          {(['all', 'image', 'text'] as const).map((f) => (
            <button
              key={f}
              className={`rounded-md px-2 py-1 text-xs transition-colors cursor-pointer ${
                filter === f ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent'
              }`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? '全部' : f === 'image' ? '图片' : '文本'}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-3.5 w-3.5" />
          上传
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) onUpload(files);
            e.target.value = '';
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        <div className="grid grid-cols-2 gap-2">
          {filtered.map((a) => (
            <div
              key={a.id}
              className="group relative overflow-hidden rounded-lg border border-border bg-card"
            >
              {isImage(a) ? (
                <a href={a.public_url ?? '#'} target="_blank" rel="noreferrer" title="点击查看原图">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.public_url ?? ''}
                    alt={a.file_name}
                    loading="lazy"
                    className="aspect-video w-full object-cover transition-transform group-hover:scale-105"
                  />
                </a>
              ) : (
                <button
                  className="flex aspect-video w-full flex-col items-center justify-center gap-1 bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                  onClick={() => onOpenText(a.id, a.file_name)}
                >
                  <FileText className="h-6 w-6" />
                  <span className="px-1 text-[10px] line-clamp-2">{a.file_name}</span>
                </button>
              )}
              <div className="flex items-center justify-between px-2 py-1.5">
                <span className="flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                  {isImage(a) ? <ImageIcon className="h-3 w-3 shrink-0" /> : <FileText className="h-3 w-3 shrink-0" />}
                  <span className="truncate">{a.file_name}</span>
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{formatSize(a.file_size)}</span>
              </div>
              <button
                className="absolute right-1 top-1 rounded bg-background/80 p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 cursor-pointer"
                onClick={() => onDeleteAttachment(a.id)}
                title="删除附件"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
        {filtered.length === 0 && (
          <p className="py-8 text-center text-xs text-muted-foreground">暂无附件，粘贴截图或点击上传</p>
        )}
      </div>
    </div>
  );
}
