/**
 * 随手记列表摘要：从 Markdown 原文里抽一行标题和一段纯文本预览。
 * 只服务“扫一眼”的列表，不替代完整 Markdown 渲染；解析失败时退回原文前 N 字。
 */

const HEADING = /^#{1,6}\s+/;

/** 去掉行内 Markdown 标记，保留可读文字 */
export function stripNoteMarkdown(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/^[-*+]\s+(?:\[[ xX]\]\s+)?/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface NoteSummary {
  title: string;
  preview: string;
}

/**
 * 标题优先取第一个 Markdown 标题；没有标题时取第一行。
 * 预览最多 `previewLimit` 字，列表用 line-clamp 控制视觉行数。
 */
export function noteSummary(content: string, previewLimit = 180): NoteSummary {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const headingIndex = lines.findIndex((line) => HEADING.test(line));

  if (headingIndex >= 0) {
    const title = stripNoteMarkdown(lines[headingIndex]).slice(0, 60).trim() || '未命名随手记';
    const preview = lines
      .filter((_, i) => i !== headingIndex)
      .map(stripNoteMarkdown)
      .filter(Boolean)
      .join(' ')
      .slice(0, previewLimit)
      .trim();
    return { title, preview };
  }

  // 没有标题：第一行当标题，预览从标题截断后的剩余部分开始，避免列表里重复同一句话
  const firstLine = stripNoteMarkdown(lines[0] ?? '');
  const title = firstLine.slice(0, 60).trim() || '未命名随手记';
  const preview = [firstLine.slice(60), ...lines.slice(1).map(stripNoteMarkdown)]
    .filter(Boolean)
    .join(' ')
    .slice(0, previewLimit)
    .trim();
  return { title, preview };
}

/** 列表搜索：正文或标签包含关键词（忽略大小写与首尾空白） */
export function noteMatchesQuery(content: string, tags: string[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (content.toLowerCase().includes(q)) return true;
  return tags.some((tag) => tag.toLowerCase().includes(q));
}
