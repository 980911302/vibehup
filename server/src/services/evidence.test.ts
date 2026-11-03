import { describe, expect, it } from 'vitest';
import { evidenceSummary, hasDeliveryEvidence, normalizeEvidence } from './evidence.js';

describe('交付证据包（R90）', () => {
  it('归一化：去空白、保留字段、数组去重', () => {
    expect(normalizeEvidence({
      commit: ' 9f2c1ab ',
      pr_url: ' https://github.com/o/r/pull/1 ',
      tests: ' vitest 348 passed ',
      changed_files: ['a.ts', ' a.ts ', 'b.ts'],
      screenshots: ['att_1'],
      notes: ' 首页修复 ',
      no_code_reason: '',
    })).toEqual({
      commit: '9f2c1ab',
      pr_url: 'https://github.com/o/r/pull/1',
      tests: 'vitest 348 passed',
      changed_files: ['a.ts', 'b.ts'],
      screenshots: ['att_1'],
      notes: '首页修复',
    });
  });

  it('空对象/null 归一为 null', () => {
    expect(normalizeEvidence(null)).toBeNull();
    expect(normalizeEvidence({})).toBeNull();
    expect(normalizeEvidence({ notes: '   ' })).toBeNull();
  });

  it('非法结构给人话报错', () => {
    expect(() => normalizeEvidence('x')).toThrow(/evidence 必须是对象/);
    expect(() => normalizeEvidence({ commit: 1 })).toThrow(/commit 必须是字符串/);
    expect(() => normalizeEvidence({ screenshots: 'att_1' })).toThrow(/screenshots 必须是字符串数组/);
  });

  it('验收门槛：commit/PR/测试/截图/非代码原因任一即可，notes 单独不算', () => {
    expect(hasDeliveryEvidence(null)).toBe(false);
    expect(hasDeliveryEvidence({ notes: '只是说明' })).toBe(false);
    expect(hasDeliveryEvidence({ commit: 'abc' })).toBe(true);
    expect(hasDeliveryEvidence({ pr_url: 'https://x' })).toBe(true);
    expect(hasDeliveryEvidence({ tests: 'passed' })).toBe(true);
    expect(hasDeliveryEvidence({ screenshots: ['att_1'] })).toBe(true);
    expect(hasDeliveryEvidence({ no_code_reason: '只改线上配置' })).toBe(true);
  });

  it('摘要只给短标签', () => {
    expect(evidenceSummary({ commit: 'abc', pr_url: 'https://x', tests: 'ok', screenshots: ['a', 'b'], changed_files: ['a.ts'], no_code_reason: 'ops' })).toEqual([
      'commit', 'PR', '测试', '截图 2', '改动 1 文件', '无需代码',
    ]);
  });
});
