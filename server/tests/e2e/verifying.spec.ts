import { test, expect } from '@playwright/test';
import { createOwnerWithProject, gotoBoardWithSession, openBugDetail, type OwnerSession } from './fixtures.js';

/**
 * R83 浏览器回归：验证中可见（谁在验、多久）、验证不通过写原因、已关闭只用于不修复且必须写原因；任务同样有验证中。
 */

async function bugAtResolved(session: OwnerSession, title: string): Promise<string> {
  const headers = { authorization: `Bearer ${session.token}` };
  const res = await session.api.post('/api/bugs', { headers, data: { project_id: session.project.id, title } });
  expect(res.status(), await res.text()).toBe(201);
  const id = (await res.json()).id as string;
  for (const status of ['in_progress', 'resolved']) {
    const r = await session.api.patch(`/api/bugs/${id}`, { headers, data: { status } });
    expect(r.status(), await r.text()).toBe(200);
  }
  return id;
}

test('缺陷：开始验证 → 验证中列显示谁在验 → 验证不通过写原因打回', async ({ page }) => {
  const session = await createOwnerWithProject(`验证项目 ${Date.now()}`);
  await bugAtResolved(session, '头像裁剪在 Safari 错位');
  await gotoBoardWithSession(page, session);

  await openBugDetail(page, '头像裁剪在 Safari 错位');
  await expect(page.getByTestId('bug-to-verified')).toHaveCount(0);
  await page.getByTestId('bug-to-verifying').click();
  await expect(page.getByTestId('bug-status-chip')).toHaveText('验证中');
  await page.keyboard.press('Escape');

  const card = page.getByTestId('board-column-verifying').getByTestId('bug-card').filter({ hasText: '头像裁剪在 Safari 错位' });
  await expect(card).toBeVisible();
  await expect(card.getByTestId('handling-line')).toContainText(session.user.name);
  await expect(card.getByTestId('handling-line')).toHaveAttribute('data-stale', 'false');

  await openBugDetail(page, '头像裁剪在 Safari 错位');
  await page.getByTestId('bug-to-in_progress').click();
  const form = page.getByTestId('bug-reopen-form');
  await form.locator('input').fill('Safari 17 仍然错位');
  await form.getByRole('button', { name: '确认打回' }).click();
  await expect(page.getByTestId('bug-status-chip')).toHaveText('进行中');
  await expect(page.getByTestId('bug-detail')).toContainText('验证不通过：Safari 17 仍然错位');

  await session.api.dispose();
});

test('缺陷：已关闭只用于不修复，必须写原因；已验证不能再拖去关闭', async ({ page }) => {
  const session = await createOwnerWithProject(`关闭项目 ${Date.now()}`);
  const headers = { authorization: `Bearer ${session.token}` };
  const dup = await session.api.post('/api/bugs', { headers, data: { project_id: session.project.id, title: '重复的登录白屏' } });
  expect(dup.status()).toBe(201);
  const doneId = await bugAtResolved(session, '已经验完的缺陷');
  for (const status of ['verifying', 'verified']) {
    await session.api.patch(`/api/bugs/${doneId}`, { headers, data: { status, resolution_notes: '测试环境复验通过' } });
  }
  await gotoBoardWithSession(page, session);

  await openBugDetail(page, '重复的登录白屏');
  await page.getByTestId('bug-to-closed').click();
  const form = page.getByTestId('bug-close-form');
  await expect(form.getByRole('button', { name: '确认关闭' })).toBeDisabled();
  await form.locator('input').fill('重复：与首页白屏同一根因');
  await form.getByRole('button', { name: '确认关闭' }).click();
  await expect(page.getByTestId('bug-status-chip')).toHaveText('已关闭');
  await expect(page.getByTestId('bug-detail')).toContainText('关闭原因');
  await page.keyboard.press('Escape');

  const verified = page.getByTestId('board-column-verified').getByTestId('bug-card').filter({ hasText: '已经验完的缺陷' });
  await verified.dragTo(page.getByTestId('board-column-closed'));
  await expect(page.getByText('已验证就是修复完成的终点，不用再关闭')).toBeVisible();

  await session.api.dispose();
});

test('任务：待验证 → 开始验证 → 验证中（显示谁在验）→ 验收通过', async ({ page }) => {
  const session = await createOwnerWithProject(`任务验证 ${Date.now()}`);
  const headers = { authorization: `Bearer ${session.token}` };
  const t = await session.api.post('/api/tasks', { headers, data: { project_id: session.project.id, title: '接入企业微信扫码', status: 'doing' } });
  const taskId = (await t.json()).id as string;
  await session.api.patch(`/api/tasks/${taskId}`, { headers, data: { status: 'review' } });
  await gotoBoardWithSession(page, session);
  await page.getByTestId('nav-tasks').click();

  await expect(page.locator('[data-testid^="task-column-"]')).toHaveCount(6);
  await page.getByText('接入企业微信扫码').click();
  await expect(page.getByTestId('task-to-done')).toHaveCount(0);
  await page.getByTestId('task-to-verifying').click();
  await expect(page.getByTestId('task-status-chip')).toHaveText('验证中');
  await expect(page.getByTestId('task-detail').getByTestId('handling-line')).toContainText(session.user.name);
  await page.getByTestId('task-to-done').click();
  await expect(page.getByTestId('task-status-chip')).toHaveText('已完成');

  await session.api.dispose();
});
