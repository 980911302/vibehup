'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import type { TextSlice } from '@/lib/api-types';

interface TextViewerProps {
  attachmentId: string;
  fileName: string;
  onClose: () => void;
}

/** 文本/日志在线查看：分片 + grep 高亮（步骤 07 §7.2） */
export function TextViewer({ attachmentId, fileName, onClose }: TextViewerProps) {
  const [slice, setSlice] = useState<TextSlice | null>(null);
  const [offset, setOffset] = useState(1);
  const [grep, setGrep] = useState('');
  const [appliedGrep, setAppliedGrep] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async (nextOffset: number, keyword: string) => {
    setLoading(true);
    try {
      const data = await api.readText(attachmentId, {
        offset: nextOffset,
        limit: 200,
        grep: keyword || undefined,
      });
      setSlice(data);
      setOffset(nextOffset);
      setAppliedGrep(keyword);
    } catch (e) {
      setSlice({
        attachment_id: attachmentId,
        file_name: fileName,
        file_type: 'text/plain',
        content: `读取失败: ${e instanceof Error ? e.message : String(e)}`,
        total_lines: 0,
        returned_lines: 0,
        has_more: false,
        next_offset_line: null,
        grep_keyword: null,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(1, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachmentId]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl min-w-0">
        <DialogHeader>
          <DialogTitle className="flex min-w-0 flex-wrap items-center gap-2 pr-6 text-sm">
            <span className="min-w-0 break-all">{fileName}</span>
            {slice && (
              <span className="text-xs font-normal text-[var(--text-tertiary)]">
                {appliedGrep ? `「${appliedGrep}」匹配 ${slice.total_lines} 行` : `共 ${slice.total_lines} 行`}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-w-0 gap-2">
          <input
            className="flex h-9 min-w-0 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-3 text-sm outline-none focus:border-[var(--brand)]"
            placeholder="grep 关键词过滤"
            value={grep}
            onChange={(e) => setGrep(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void load(1, grep.trim())}
          />
          <button className="vh-btn ghost shrink-0" onClick={() => void load(1, grep.trim())}>
            <Search size={14} />
            过滤
          </button>
        </div>

        <div className="relative min-h-48 min-w-0">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-page)]/50">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--text-tertiary)]" />
            </div>
          )}
          <pre className="max-h-[50vh] max-w-full overflow-auto whitespace-pre rounded-md border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 text-xs leading-relaxed">
            <code>
              {(slice?.content ?? '加载中…').split('\n').map((line, i) => (
                <div key={i} className="flex hover:bg-[var(--gold-bg)]/40">
                  {highlightLine(line, appliedGrep)}
                </div>
              ))}
            </code>
          </pre>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-[var(--text-tertiary)]" data-testid="text-page-status">{pageStatus(slice, offset)}</span>
          <div className="flex shrink-0 gap-2">
            <button className="vh-btn ghost h-8 text-xs" disabled={offset <= 1 || loading} onClick={() => void load(Math.max(1, offset - 200), appliedGrep)}>
              <ChevronLeft size={13} />
              上一页
            </button>
            <button className="vh-btn ghost h-8 text-xs" disabled={!slice?.has_more || loading} onClick={() => void load(slice?.next_offset_line ?? offset + 200, appliedGrep)} data-testid="text-next-page">
              下一页
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 分页状态的人话描述（此前直接露出 has_more: false） */
function pageStatus(slice: TextSlice | null, offset: number): string {
  if (!slice) return '加载中…';
  if (slice.returned_lines === 0) return slice.grep_keyword ? '没有匹配的行' : '文件为空';
  const end = offset + slice.returned_lines - 1;
  const range = slice.grep_keyword ? `第 ${offset}–${end} 条匹配` : `第 ${offset}–${end} 行`;
  return `${range} · ${slice.has_more ? '后面还有，点「下一页」继续' : '已到末尾'}`;
}

/** 文本高亮：日志级别着色 + grep 关键词高亮 */
function highlightLine(line: string, keyword: string): React.ReactNode {
  const levelMatch = /\b(ERROR|FATAL|WARN|WARNING|INFO|DEBUG)\b/.exec(line);
  const level = levelMatch?.[1];
  const levelColor =
    level === 'ERROR' || level === 'FATAL'
      ? 'text-[var(--danger)]'
      : level === 'WARN' || level === 'WARNING'
        ? 'text-[var(--warn)]'
        : level === 'INFO'
          ? 'text-[var(--sev-normal)]'
          : 'text-[var(--text-tertiary)]';

  // 行号前缀单独着色
  const lineNoMatch = /^(L\d+:)\s?(.*)$/.exec(line);
  const lineNo = lineNoMatch?.[1] ?? '';
  const rest = lineNoMatch?.[2] ?? line;

  let body: React.ReactNode = rest;
  if (keyword) {
    const parts = rest.split(keyword);
    if (parts.length > 1) {
      body = parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && (
            <mark className="rounded bg-[var(--gold)]/30 px-0.5 text-[var(--gold-bright)]">{keyword}</mark>
          )}
        </span>
      ));
    }
  }

  return (
    <>
      {lineNo && <span className="w-14 shrink-0 select-none pr-2 text-right text-[var(--text-tertiary)]/60">{lineNo}</span>}
      <span className={levelColor}>{body}</span>
    </>
  );
}
