import type { DeliveryEvidence } from './api-types';

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

/** 证据摘要：一行标签，不展开长文本。 */
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
