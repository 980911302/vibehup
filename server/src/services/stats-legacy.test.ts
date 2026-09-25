import { describe, it, expect } from 'vitest';
import { parseStatusChangeComment } from './stats-legacy.js';

describe('parseStatusChangeComment', () => {
  it('解析中文文案格式（当前格式）', () => {
    expect(parseStatusChangeComment('状态变更：已验证 → 已关闭')).toEqual({ from: 'verified', to: 'closed' });
  });

  it('解析英文状态码格式（更老的历史数据）', () => {
    expect(parseStatusChangeComment('状态变更：open → in_progress')).toEqual({ from: 'open', to: 'in_progress' });
  });

  it('只看第一行：后续行（重开原因/修复说明/commit）不影响解析', () => {
    const content = '状态变更：验证中 → 已验证\n修复说明：已在测试环境复验通过\ncommit: abc1234';
    expect(parseStatusChangeComment(content)).toEqual({ from: 'verifying', to: 'verified' });
  });

  it('非状态变更评论返回 null', () => {
    expect(parseStatusChangeComment('AI：已定位到 NPE，需要确认期望行为')).toBeNull();
  });

  it('格式对但状态名无法识别时返回 null（防脏数据把假状态当真）', () => {
    expect(parseStatusChangeComment('状态变更：不存在的状态 → 也不存在')).toBeNull();
  });

  it('六种缺陷状态的中英文名都能识别', () => {
    const pairs: [string, string][] = [
      ['open', '待处理'], ['in_progress', '进行中'], ['resolved', '已解决'],
      ['verifying', '验证中'], ['verified', '已验证'], ['closed', '已关闭'],
    ];
    for (const [code, label] of pairs) {
      expect(parseStatusChangeComment(`状态变更：${code} → ${code}`)).toEqual({ from: code, to: code });
      expect(parseStatusChangeComment(`状态变更：${label} → ${label}`)).toEqual({ from: code, to: code });
    }
  });
});
