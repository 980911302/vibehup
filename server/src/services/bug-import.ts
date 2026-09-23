import { prisma } from '../core/prisma.js';
import { ids } from '../core/ids.js';
import { BUG_STATUSES, BUG_SEVERITIES, BUG_PRIORITIES } from './bugs.js';
import { ValidationError } from '../core/errors.js';

/**
 * 缺陷 CSV 导入导出（步骤 04 §4.4）。
 * 列：标题,严重度,状态,指派邮箱,标签,优先级,截止日,复现步骤
 * 导出带 UTF-8 BOM（Excel 直接打开中文不乱码）。
 */

export const CSV_COLUMNS = [
  '标题',
  '严重度',
  '状态',
  '指派邮箱',
  '标签',
  '优先级',
  '截止日',
  '复现步骤',
] as const;

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** 导出项目缺陷为 CSV 文本 */
export async function exportBugsCsv(projectId: string): Promise<string> {
  const bugs = await prisma.bug.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
  });
  const users = bugs
    .map((b) => b.assigneeId)
    .filter((id): id is string => Boolean(id));
  const userRows = users.length
    ? await prisma.user.findMany({ where: { id: { in: [...new Set(users)] } }, select: { id: true, email: true } })
    : [];
  const emailMap = new Map(userRows.map((u) => [u.id, u.email]));

  const lines: string[] = [CSV_COLUMNS.join(',')];
  for (const b of bugs) {
    lines.push(
      [
        b.title,
        b.severity,
        b.status,
        b.assigneeId ? emailMap.get(b.assigneeId) ?? '' : '',
        b.labels.join(','),
        b.priority,
        b.dueDate ? b.dueDate.toISOString().slice(0, 10) : '',
        b.stepsToReproduce ?? '',
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  return '\uFEFF' + lines.join('\n');
}

export interface ImportRowResult {
  row: number;
  ok: boolean;
  reason?: string;
}

/** 极简 CSV 解析（支持引号包裹与逗号/换行转义） */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  const clean = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** 导入 CSV：逐行校验，部分失败不中断 */
export async function importBugsCsv(
  projectId: string,
  csvText: string,
): Promise<{ imported: number; results: ImportRowResult[] }> {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new ValidationError('CSV 至少需要表头和一行数据');

  const [header, ...dataRows] = rows;
  const headerText = header.map((h) => h.trim()).join(',');
  if (headerText !== CSV_COLUMNS.join(',')) {
    throw new ValidationError(`CSV 表头应为: ${CSV_COLUMNS.join(',')}`);
  }

  // 邮箱 → 用户映射（指派解析）
  const emails = [...new Set(dataRows.map((r) => (r[3] ?? '').trim().toLowerCase()).filter(Boolean))];
  const userRows = emails.length
    ? await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } })
    : [];
  const userMap = new Map(userRows.map((u) => [u.email.toLowerCase(), u.id]));

  const results: ImportRowResult[] = [];
  let imported = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const cols = dataRows[i];
    const rowNo = i + 2; // 表头是第 1 行
    const title = (cols[0] ?? '').trim();
    const severity = (cols[1] ?? '').trim() || 'normal';
    const status = (cols[2] ?? '').trim() || 'open';
    const assigneeEmail = (cols[3] ?? '').trim().toLowerCase();
    const labelsRaw = (cols[4] ?? '').trim();
    const priority = (cols[5] ?? '').trim() || 'medium';
    const dueRaw = (cols[6] ?? '').trim();
    const steps = (cols[7] ?? '').trim();

    if (!title) {
      results.push({ row: rowNo, ok: false, reason: '标题为空' });
      continue;
    }
    if (!BUG_SEVERITIES.includes(severity as never)) {
      results.push({ row: rowNo, ok: false, reason: `严重度非法: ${severity}` });
      continue;
    }
    if (!BUG_STATUSES.includes(status as never)) {
      results.push({ row: rowNo, ok: false, reason: `状态非法: ${status}` });
      continue;
    }
    if (!BUG_PRIORITIES.includes(priority as never)) {
      results.push({ row: rowNo, ok: false, reason: `优先级非法: ${priority}` });
      continue;
    }
    let assigneeId: string | null = null;
    if (assigneeEmail) {
      assigneeId = userMap.get(assigneeEmail) ?? null;
      if (!assigneeId) {
        results.push({ row: rowNo, ok: false, reason: `指派邮箱无匹配用户: ${assigneeEmail}` });
        continue;
      }
    }
    let dueDate: Date | null = null;
    if (dueRaw) {
      dueDate = new Date(dueRaw);
      if (Number.isNaN(dueDate.getTime())) {
        results.push({ row: rowNo, ok: false, reason: `截止日格式非法: ${dueRaw}（应为 YYYY-MM-DD）` });
        continue;
      }
    }

    try {
      // 导入是管理员 bulk 操作：字段已逐行校验，直接建单（含状态）以保证 round-trip 一致，
      // 不走交互状态机（reopenedCount 保持 0）。
      await prisma.bug.create({
        data: {
          id: ids.attachment(),
          projectId,
          title,
          severity,
          status,
          priority,
          assigneeId,
          dueDate,
          labels: labelsRaw ? labelsRaw.split(/[,，]/).map((t) => t.trim()).filter(Boolean) : [],
          stepsToReproduce: steps || null,
          createdBy: 'human',
        },
      });
      imported++;
      results.push({ row: rowNo, ok: true });
    } catch (err) {
      results.push({ row: rowNo, ok: false, reason: err instanceof Error ? err.message : '创建失败' });
    }
  }

  return { imported, results };
}
