import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../core/prisma.js';
import { createUser, resetDb } from '../test-helpers.js';
import * as notifications from './notifications.js';

beforeEach(async () => {
  await resetDb();
});

describe('站内通知（R90）', () => {
  it('创建/未读筛选/标记已读', async () => {
    const u = await createUser({ email: 'n@t.com', name: '通知' });
    await notifications.createNotification({ userId: u.user.id, type: 'handoff', title: '转交给你', body: '你更熟', entityType: 'bug', entityId: 'bug_1' });
    const list = await notifications.listNotifications(u.user.id);
    expect(list.items).toHaveLength(1);
    expect(list.unread).toBe(1);
    expect(await notifications.markRead(u.user.id, list.items[0].id)).toBe(true);
    expect((await notifications.listNotifications(u.user.id)).unread).toBe(0);
    expect((await notifications.listNotifications(u.user.id, { unread: true })).items).toHaveLength(0);
  });

  it('全部已读只影响本人', async () => {
    const a = await createUser({ email: 'a@t.com', name: '甲' });
    const b = await createUser({ email: 'b@t.com', name: '乙' });
    await notifications.createNotification({ userId: a.user.id, type: 'verify', title: 'A' });
    await notifications.createNotification({ userId: b.user.id, type: 'verify', title: 'B' });
    expect(await notifications.markAllRead(a.user.id)).toBe(1);
    expect((await notifications.listNotifications(a.user.id)).unread).toBe(0);
    expect((await notifications.listNotifications(b.user.id)).unread).toBe(1);
  });

  it('notifyWriters 排除操作者，只发 active 可写成员', async () => {
    const owner = await createUser({ email: 'o@t.com', name: 'Owner' });
    const member = await createUser({ email: 'm@t.com', name: 'Member' });
    await createUser({ email: 'v@t.com', name: 'Viewer', role: 'viewer' });
    await notifications.notifyWriters({ type: 'verify', title: '待验收', excludeUserId: owner.user.id });
    const rows = await prisma.notification.findMany();
    expect(rows.map((r) => r.userId)).toEqual([member.user.id]);
  });
});
