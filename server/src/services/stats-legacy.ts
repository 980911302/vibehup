import { BUG_STATUSES, BUG_STATUS_LABELS, type BugStatus } from './bug-flow.js';

/**
 * 解析 R83 之前（无 statusChangedAt 列）的老缺陷「状态变更」评论（R85 统计页兜底用）。
 * 评论首行格式固定为「状态变更：A → B」（services/bugs.ts 写入），A/B 历史上出现过
 * 英文状态码（早期）与中文文案（bugStatusLabel 上线后）两种写法，这里都要认得。
 */

export interface ParsedStatusChange {
  from: BugStatus;
  to: BugStatus;
}

/** 状态码/中文文案 → 状态码 的反查表，两种写法都收进去 */
const STATUS_BY_TEXT: Record<string, BugStatus> = {};
for (const s of BUG_STATUSES) {
  STATUS_BY_TEXT[s] = s;
  STATUS_BY_TEXT[BUG_STATUS_LABELS[s]] = s;
}

const FIRST_LINE_RE = /^状态变更：(.+?) → (.+)$/;

export function parseStatusChangeComment(content: string): ParsedStatusChange | null {
  const firstLine = content.split('\n')[0]?.trim() ?? '';
  const m = FIRST_LINE_RE.exec(firstLine);
  if (!m) return null;
  const from = STATUS_BY_TEXT[m[1].trim()];
  const to = STATUS_BY_TEXT[m[2].trim()];
  if (!from || !to) return null;
  return { from, to };
}
