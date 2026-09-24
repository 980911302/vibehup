import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../core/prisma.js';
import { resetDb } from '../test-helpers.js';
import * as projectsService from './projects.js';
import * as bugsService from './bugs.js';

/**
 * 功能巡检 B9：缺陷的流转报错与活动流直出英文枚举（「不允许从 open 直接改为 resolved」「状态变更：open → in_progress」），
 * 与界面上的中文状态名对不上。改为与看板列名一致的中文。
 */

beforeEach(async () => {
  await resetDb();
});

async function newBug() {
  const p = await projectsService.createProject({ name: 'P', slug: 'p' });
  return bugsService.createBug({ projectId: p.id, title: '缺陷' });
}

describe('缺陷状态的中文文案', () => {
  it('跳级报错用中文状态名并列出可走的下一步', async () => {
    const bug = await newBug();
    await expect(bugsService.updateBug(bug.id, { status: 'resolved' })).rejects.toThrow(
      '不能从「待处理」直接改为「已解决」，可以改为：进行中',
    );
  });

  it('重开缺原因的报错用中文，并点明参数名', async () => {
    const bug = await newBug();
    await bugsService.updateBug(bug.id, { status: 'in_progress' });
    await bugsService.updateBug(bug.id, { status: 'resolved' });
    await expect(bugsService.updateBug(bug.id, { status: 'open' })).rejects.toThrow(
      '从「已解决」重开到「待处理」需要填写重开原因（reopen_reason）',
    );
  });

  it('活动流的状态变更记录用中文状态名', async () => {
    const bug = await newBug();
    await bugsService.updateBug(bug.id, { status: 'in_progress' });
    const comments = await prisma.bugComment.findMany({ where: { bugId: bug.id } });
    expect(comments.map((c) => c.content)).toContain('状态变更：待处理 → 进行中');
  });

  it('状态名表与看板列名一致（verified = 已验证，不是「待验证」）', () => {
    expect(bugsService.BUG_STATUS_LABELS).toEqual({
      open: '待处理', in_progress: '进行中', resolved: '已解决', verifying: '验证中', verified: '已验证', closed: '已关闭',
    });
  });
});
