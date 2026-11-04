import { describe, it, expect } from 'vitest';
import { noteSummary, stripNoteMarkdown } from './note-summary';

describe('随手记列表摘要', () => {
  it('有标题时标题取标题行，预览从正文开始', () => {
    const s = noteSummary('# VibeHub 项目概览\n\n> 交接说明\n\n- **一句话**：粘贴截图即录缺陷。');
    expect(s.title).toBe('VibeHub 项目概览');
    expect(s.preview).toBe('交接说明 一句话：粘贴截图即录缺陷。');
  });

  it('没有标题时用第一行做标题，预览不重复标题', () => {
    const s = noteSummary('约定：今日页先只读聚合。\n验收口径＝能打开缺陷。');
    expect(s.title).toBe('约定：今日页先只读聚合。');
    expect(s.preview).toBe('验收口径＝能打开缺陷。');
  });

  it('没有标题且只有一行时，预览为空', () => {
    expect(noteSummary('AI 交接：cursor-main 负责界面重做。')).toEqual({
      title: 'AI 交接：cursor-main 负责界面重做。',
      preview: '',
    });
  });

  it('去掉 Markdown 标记、链接和行内代码', () => {
    expect(stripNoteMarkdown('- 看 [PR #8](https://example.com) 的 `evidence` 字段')).toBe(
      '看 PR #8 的 evidence 字段',
    );
    expect(stripNoteMarkdown('> **重点**：不要展开')).toBe('重点：不要展开');
  });

  it('空内容有兜底标题，预览按上限截断', () => {
    expect(noteSummary('   ').title).toBe('未命名随手记');
    expect(noteSummary('正文'.repeat(200)).preview).toHaveLength(180);
  });
});
