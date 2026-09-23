/** Excel/TSV 粘贴解析（卡片 50）：把剪贴板文本解析为缺陷草稿行 */

export interface TsvRow {
  title: string;
  severity?: 'low' | 'normal' | 'high' | 'critical';
  steps?: string;
  /** 无法导入的原因（如标题为空）；有 error 的行创建时跳过 */
  error?: string;
}

const SEVERITY_ALIAS: Record<string, TsvRow['severity']> = {
  '低': 'low', low: 'low', l: 'low',
  '中': 'normal', normal: 'normal', medium: 'normal', n: 'normal',
  '高': 'high', high: 'high', h: 'high',
  '紧急': 'critical', critical: 'critical', c: 'critical',
};

function mapSeverity(raw: string | undefined): TsvRow['severity'] {
  if (!raw) return undefined;
  return SEVERITY_ALIAS[raw.trim().toLowerCase()];
}

/**
 * 解析剪贴板文本为缺陷行：
 * - 单行无制表符 → 整行作为标题
 * - 含制表符 → 列序：标题 / 严重度（可空）/ 复现步骤（可空），多余列忽略
 * - 空行跳过；标题为空的行记 error 不中断其他行
 */
export function parseTsvRows(text: string): TsvRow[] {
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const rows: TsvRow[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = line.split('\t').map((c) => c.trim());
    const [title, severityRaw, ...rest] = cols;
    if (!title) {
      rows.push({ title: '', error: '标题为空' });
      continue;
    }
    const steps = rest.filter(Boolean).join(' ');
    rows.push({
      title,
      severity: mapSeverity(severityRaw),
      steps: steps || undefined,
    });
  }
  return rows;
}

/** 是否值得走批量导入（多行或含制表符）；单行短文本按标题填充处理 */
export function isBulkPaste(text: string): boolean {
  if (!text) return false;
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
  return lines.length > 1 || text.includes('\t');
}
