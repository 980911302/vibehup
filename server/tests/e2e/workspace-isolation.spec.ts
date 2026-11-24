import { test, expect } from '@playwright/test';
import { createOwnerWithProject, gotoBoardWithSession } from './fixtures.js';

/**
 * 工作区彻底隔离与新操作逻辑回归：
 * 1. 左上角切换项目后，概览(/today)、⌘K 搜索、技能、缺陷、任务、统计全部严格按当前项目物理隔离；
 * 2. 概览页点击条目原地打开详情弹窗，不强行跳页；
 * 3. 缺陷支持看板/列表双视图切换；全局设置与项目工作区导航彻底分离。
 */
test('单项目工作区彻底隔离 + 原地详情弹窗 + 看板/列表切换 + 全局管理分离', async ({ page }) => {
  const beta = await createOwnerWithProject(`隔离工作区 Beta ${Date.now()}`);
  const alpha = await createOwnerWithProject(`隔离工作区 Alpha ${Date.now()}`);
  const headers = { authorization: `Bearer ${alpha.token}` };

  // 在 Alpha 与 Beta 各创建同名关键词的缺陷、任务与专属技能
  const bugAlphaRes = await alpha.api.post('/api/bugs', {
    headers,
    data: { project_id: alpha.project.id, title: '核心网关鉴权失败 Alpha', assignee_id: alpha.user.id },
  });
  expect(bugAlphaRes.status()).toBe(201);

  const bugBetaRes = await beta.api.post('/api/bugs', {
    headers,
    data: { project_id: beta.project.id, title: '核心网关鉴权失败 Beta', assignee_id: beta.user.id },
  });
  expect(bugBetaRes.status()).toBe(201);

  await alpha.api.post('/api/skills', {
    headers,
    data: {
      project_id: alpha.project.id,
      skill_md: '---\nname: alpha-deploy\ndescription: Alpha 专属部署规范\n---\n# Alpha 部署\n',
    },
  });
  await beta.api.post('/api/skills', {
    headers,
    data: {
      project_id: beta.project.id,
      skill_md: '---\nname: beta-deploy\ndescription: Beta 专属部署规范\n---\n# Beta 部署\n',
    },
  });
  // 同时创建一个全团队通用技能，验证项目内技能模块默认不混入通用技能
  await alpha.api.post('/api/skills', {
    headers,
    data: {
      project_id: null,
      skill_md: '---\nname: team-common\ndescription: 团队通用规范\n---\n# 通用规范\n',
    },
  });

  await gotoBoardWithSession(page, alpha);

  // 切换到 Alpha 工作区
  await page.getByTestId('project-switcher').click();
  await page.getByRole('button', { name: new RegExp(alpha.project.slug) }).click();
  await expect(page.getByTestId('project-switcher')).toContainText(alpha.project.name);

  // 1) 缺陷看板/列表切换
  await expect(page.getByTestId('bug-board')).toBeVisible();
  await page.getByTestId('bug-view-list').click();
  await expect(page.getByTestId('bug-list-view')).toBeVisible();
  await expect(page.getByTestId('bug-list-view')).toContainText('核心网关鉴权失败 Alpha');
  await expect(page.getByTestId('bug-list-view')).not.toContainText('核心网关鉴权失败 Beta');

  // 2) 概览页严格只显示 Alpha，且点击条目原地弹详情不跳页
  await page.getByTestId('nav-today').click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByTestId('today-needs-me')).toContainText('核心网关鉴权失败 Alpha');
  await expect(page.getByTestId('today-needs-me')).not.toContainText('核心网关鉴权失败 Beta');

  await page.getByTestId('today-needs-me').getByText('核心网关鉴权失败 Alpha').click();
  await expect(page.getByTestId('bug-detail')).toBeVisible();
  await expect(page).toHaveURL(/\/today$/); // 原地弹窗，URL 不跳走
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('bug-detail')).toBeHidden();

  // 3) ⌘K 搜索严格隔离在 Alpha 内
  await page.getByTestId('open-palette').click();
  const palette = page.getByTestId('command-palette');
  await expect(palette).toBeVisible();
  await palette.locator('input').fill('核心网关鉴权失败');
  await expect(palette).toContainText('核心网关鉴权失败 Alpha');
  await expect(palette).not.toContainText('核心网关鉴权失败 Beta');
  await page.keyboard.press('Escape');

  // 4) 技能模块严格只展示 Alpha 专属技能，通用技能隔离至全局设置
  await page.getByTestId('context-skills').click();
  await expect(page.getByTestId('skill-card-alpha-deploy')).toBeVisible();
  await expect(page.getByTestId('skill-card-beta-deploy')).toHaveCount(0);
  await expect(page.getByTestId('skill-card-team-common')).toHaveCount(0);

  // 5) 切换到 Beta 工作区，立即切换为 Beta 数据
  await page.getByTestId('project-switcher').click();
  await page.getByRole('button', { name: new RegExp(beta.project.slug) }).click();
  await expect(page.getByTestId('skill-card-beta-deploy')).toBeVisible();
  await expect(page.getByTestId('skill-card-alpha-deploy')).toHaveCount(0);

  // 6) 进入全局设置：边栏切换为全局管理态，可见通用技能库并可一键返回工作区
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('back-to-workspace')).toBeVisible();
  await expect(page.getByTestId('global-skills-card')).toContainText('team-common');
  await page.getByTestId('back-to-workspace').click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByTestId('project-switcher')).toContainText(beta.project.name);

  await alpha.api.dispose();
  await beta.api.dispose();
});
