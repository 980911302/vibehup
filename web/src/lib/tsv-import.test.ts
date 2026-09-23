import { describe, it, expect } from 'vitest';
import { parseTsvRows } from './tsv-import';

/** Excel/TSV 粘贴解析（卡片 50）：标题必填，严重度/步骤按列序可选 */

describe('parseTsvRows', () => {
  it('单行纯文本 → 单条，标题即全文', () => {
    const rows = parseTsvRows('登录页按钮无响应');
    expect(rows).toEqual([{ title: '登录页按钮无响应', severity: undefined, steps: undefined, error: undefined }]);
  });

  it('TSV 三列：标题/严重度/步骤', () => {
    const rows = parseTsvRows('按钮无响应\t高\t点登录没反应\n列表空白\t中\t滚动到底');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ title: '按钮无响应', severity: 'high', steps: '点登录没反应' });
    expect(rows[1]).toMatchObject({ title: '列表空白', severity: 'normal', steps: '滚动到底' });
  });

  it('严重度接受中英文别名', () => {
    const rows = parseTsvRows('A\t紧急\tx\nB\tcritical\ty\nC\tlow\tz\nD\t高\tw');
    expect(rows.map((r) => r.severity)).toEqual(['critical', 'critical', 'low', 'high']);
  });

  it('空行跳过；标题为空的行记为 error 且不中断其他行', () => {
    const rows = parseTsvRows('好行\t中\t步骤\n\n\t高\t没标题\n另一行');
    expect(rows).toHaveLength(3);
    expect(rows[0].title).toBe('好行');
    expect(rows[1].error).toBe('标题为空');
    expect(rows[2].title).toBe('另一行');
  });

  it('空输入 → 空数组', () => {
    expect(parseTsvRows('   \n  \n')).toEqual([]);
  });

  it('行内多余列忽略，列数不足退化为仅标题', () => {
    // 列序固定：标题/严重度/步骤——第二列按严重度解析（无效则忽略），其余进步骤
    const rows = parseTsvRows('只有标题\textra1\textra2');
    expect(rows[0]).toMatchObject({ title: '只有标题', severity: undefined, steps: 'extra2' });
    const rows2 = parseTsvRows('单列');
    expect(rows2[0]).toMatchObject({ title: '单列', steps: undefined });
  });
});
