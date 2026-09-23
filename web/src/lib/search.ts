import { pinyin } from 'pinyin-pro';

/** 与 Server 端保持一致的拼音检索规则（lib/core/search.ts 的前端镜像） */
export interface SearchIndex {
  raw: string;
  full: string;
  initials: string;
}

export function buildSearchIndex(primary: string, secondary = ''): SearchIndex {
  const combined = secondary ? `${primary} ${secondary}` : primary;
  return {
    raw: combined.toLowerCase(),
    full: pinyin(combined, { toneType: 'none' }).toLowerCase().replace(/\s+/g, ''),
    initials: pinyin(primary, { pattern: 'first' }).toLowerCase().replace(/\s+/g, ''),
  };
}

function isSubsequence(query: string, target: string): boolean {
  let i = 0;
  for (const ch of target) {
    if (ch === query[i]) i++;
    if (i === query.length) return true;
  }
  return false;
}

export function matchIndex(query: string, index: SearchIndex): boolean {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return true;
  if (index.raw.includes(q)) return true;
  if (index.full.includes(q)) return true;
  if (index.initials.includes(q)) return true;
  if (/^[a-z]+$/.test(q) && isSubsequence(q, index.initials)) return true;
  return false;
}
