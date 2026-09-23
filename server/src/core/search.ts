import { pinyin } from 'pinyin-pro';

/**
 * 拼音检索工具（设计文档 5.1：项目切换支持拼音/模糊检索）。
 *
 * 匹配规则（可预测、低误报）：
 * - 原文 / 全拼：子串匹配（"用户"、"yonghu" 命中「用户中心」）
 * - 主字段首字母：子串或子序列匹配（"yhzx"、"yzx" 命中「用户中心」）
 * 首字母仅取主字段（名称/标题），避免长描述串扰导致误报。
 */

export interface SearchIndex {
  /** 原文 + 次要字段，小写 */
  raw: string;
  /** 全文全拼，小写无空格 */
  full: string;
  /** 主字段首字母，小写（短串，允许子序列） */
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

/** 多字段索引，任一命中即返回 */
export function matchAnyIndex(query: string, indices: SearchIndex[]): boolean {
  if (!query.trim()) return true;
  return indices.some((idx) => matchIndex(query, idx));
}
