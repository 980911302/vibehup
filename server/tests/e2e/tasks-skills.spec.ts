import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOwnerWithProject, gotoBoardWithSession } from './fixtures.js';

/**
 * R80 浏览器回归：
 * ① 当前项目跨页保持（功能巡检 B1：此前一换页就被重置）；
 * ② 任务流转 + 详情编辑 + 打回写原因 + 删除；
 * ③ 技能：选文件夹上传 → 详情渲染 SKILL.md → 查看附带文件。
 */

test('当前项目跨页保持，刷新后仍记得', async ({ page }) => {
  const other = await createOwnerWithProject(`另一个项目 ${Date.now()}`);
  const session = await createOwnerWithProject(`跨页项目 ${Date.now()}`);
  await gotoBoardWithSession(page, session);

  const switcher = page.getByTestId('project-switcher');
  await switcher.click();
  await page.getByRole('button', { name: new RegExp(other.project.slug) }).click();
  await expect(switcher).toContainText('另一个项目');

  await page.getByTestId('nav-tasks').click();
  await expect(page.getByTestId('project-switcher')).toContainText('另一个项目');
  await page.reload();
  await expect(page.getByTestId('project-switcher')).toContainText('另一个项目');

  await other.api.dispose();
  await session.api.dispose();
});

test('任务：六列、详情改标签、提交验证、打回写原因、删除', async ({ page }) => {
  const session = await createOwnerWithProject(`任务项目 ${Date.now()}`);
  const auth = { authorization: `Bearer ${session.token}` };
  const created = await session.api.post('/api/tasks', { headers: auth, data: { project_id: session.project.id, title: '接入企业微信扫码登录' } });
  expect(created.status(), await created.text()).toBe(201);
  await gotoBoardWithSession(page, session);
  await page.getByTestId('nav-tasks').click();

  await expect(page.locator('[data-testid^="task-column-"]')).toHaveCount(6);
  await page.getByText('接入企业微信扫码登录').click();
  const detail = page.getByTestId('task-detail');
  await expect(detail).toBeVisible();

  await page.getByTestId('label-input').fill('登录');
  await page.getByTestId('label-input').press('Enter');
  await expect(detail).toContainText('#登录');

  await page.getByTestId('task-to-doing').click();
  await expect(page.getByTestId('task-status-chip')).toHaveText('进行中');
  await page.getByTestId('task-to-review').click();
  await expect(page.getByTestId('task-status-chip')).toHaveText('待验证');

  await page.getByTestId('task-to-doing').click();
  await page.getByTestId('task-reopen-form').locator('input').fill('回调地址还是测试环境');
  await page.getByRole('button', { name: '确认打回' }).click();
  await expect(page.getByTestId('task-status-chip')).toHaveText('进行中');
  await expect(detail).toContainText('上次打回原因：回调地址还是测试环境');

  await page.getByTestId('task-delete').click();
  await page.getByTestId('task-delete-confirm').click();
  await expect(detail).toBeHidden();
  await expect(page.getByText('接入企业微信扫码登录')).toHaveCount(0);

  await session.api.dispose();
});

test('技能：选文件夹上传 → 渲染 SKILL.md → 查看附带文件', async ({ page }) => {
  const session = await createOwnerWithProject(`技能项目 ${Date.now()}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-skill-'));
  const root = path.join(dir, 'release-checklist');
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'SKILL.md'), '---\nname: release-checklist\ndescription: 发版前检查清单\n---\n\n# 发版检查清单\n\n1. 跑迁移\n');
  fs.writeFileSync(path.join(root, 'scripts', 'check.sh'), 'echo 检查迁移\n');

  await gotoBoardWithSession(page, session);
  await page.getByTestId('nav-skills').click();
  await page.getByTestId('skill-upload-open').click();
  await page.getByTestId('skill-pick-folder').setInputFiles(root);
  await expect(page.getByTestId('skill-picked')).toContainText('SKILL.md + 1 个附带文件');
  await page.getByTestId('skill-upload-submit').click();

  await expect(page.getByTestId('skill-detail')).toBeVisible();
  await expect(page.getByTestId('skill-content')).toContainText('发版检查清单');
  await page.getByTestId('skill-files').getByText('scripts/check.sh').click();
  await expect(page.getByTestId('skill-content')).toContainText('echo 检查迁移');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('skill-card-release-checklist')).toBeVisible();

  fs.rmSync(dir, { recursive: true, force: true });
  await session.api.dispose();
});
