import { ValidationError } from '../core/errors.js';

/**
 * 交付证据包（R90）：AI 或人把「改了什么、怎么验的、证据在哪」结构化留下，
 * 人验收时先看证据，而不是只看状态。存在 bugs/tasks 的 evidence JSONB 列。
 */
export interface DeliveryEvidence {
  commit?: string;
  pr_url?: string;
  tests?: string;
  changed_files?: string[];
  screenshots?: string[];
  notes?: string;
  no_code_reason?: string;
}

const MAX_TEXT = 2000;
const MAX_ARRAY = 30;
const MAX_ITEM = 500;
const MAX_JSON = 30_000;

const TEXT_FIELDS = ['commit', 'pr_url', 'tests', 'notes', 'no_code_reason'] as const;
const ARRAY_FIELDS = ['changed_files', 'screenshots'] as const;

/**
 * 归一化 + 校验；非法结构直接 400，避免把任意 JSON 塞进库。
 * 允许传 null 表示清空。
 */
export function normalizeEvidence(raw: unknown): DeliveryEvidence | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('evidence 必须是对象，例如 { commit, pr_url, tests, screenshots, notes }');
  }
  const input = raw as Record<string, unknown>;
  const out: DeliveryEvidence = {};
  for (const key of TEXT_FIELDS) {
    const value = input[key];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string') throw new ValidationError(`evidence.${key} 必须是字符串`);
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_TEXT) throw new ValidationError(`evidence.${key} 太长（最多 ${MAX_TEXT} 字符）`);
    out[key] = trimmed;
  }
  for (const key of ARRAY_FIELDS) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value)) throw new ValidationError(`evidence.${key} 必须是字符串数组`);
    const items = [...new Set(value.map((v) => String(v).trim()).filter(Boolean))];
    if (items.length > MAX_ARRAY) throw new ValidationError(`evidence.${key} 最多 ${MAX_ARRAY} 项`);
    if (items.some((v) => v.length > MAX_ITEM)) throw new ValidationError(`evidence.${key} 单项最多 ${MAX_ITEM} 字符`);
    if (items.length) out[key] = items;
  }
  if (JSON.stringify(out).length > MAX_JSON) throw new ValidationError('evidence 内容过大，请精简后再保存');
  return Object.keys(out).length ? out : null;
}

/** 是否达到「可验收」的最低证据标准：commit / PR / 测试 / 截图 / 非代码说明，任一项即可。 */
export function hasDeliveryEvidence(e: DeliveryEvidence | null | undefined): boolean {
  if (!e) return false;
  return Boolean(
    e.no_code_reason?.trim() ||
      e.commit?.trim() ||
      e.pr_url?.trim() ||
      e.tests?.trim() ||
      (e.screenshots?.length ?? 0) > 0,
  );
}

/** 证据摘要（列表/Today 用）：不展开长文本。 */
export function evidenceSummary(e: DeliveryEvidence | null | undefined): string[] {
  if (!e) return [];
  const out: string[] = [];
  if (e.commit) out.push('commit');
  if (e.pr_url) out.push('PR');
  if (e.tests) out.push('测试');
  if (e.screenshots?.length) out.push(`截图 ${e.screenshots.length}`);
  if (e.changed_files?.length) out.push(`改动 ${e.changed_files.length} 文件`);
  if (e.no_code_reason) out.push('无需代码');
  return out;
}
