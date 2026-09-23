import { test, expect, type Page } from '@playwright/test';
import { createMember, createOwnerWithProject, gotoBoardWithSession, openBugDetail, openCreateDialog } from './fixtures.js';

/**
 * 补验回归 E2E（卡片 F1）：把历史上「因 IAB 环境故障跳过」的浏览器回归补齐——
 * ① 卡片 49 缺陷指派（创建带指派 → 卡片头像 → 详情改派）；
 * ② 卡片 50 Excel 式速录（TSV 多行粘贴 → 预览 → 确认导入 → 看板出现）。
 */

/** 在对话框内合成文本粘贴（与真实 Ctrl+V 同路径；多行=表格批量导入） */
async function pasteText(page: Page, text: string): Promise<void> {
  await page.evaluate((payload) => {
    const target = document.querySelector('[data-testid="bug-paste-area"]') ?? document.body;
    const dt = new DataTransfer();
    dt.setData('text/plain', payload);
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}

test('卡片 49：创建带指派 → 卡片负责人头像 → 详情改派', async ({ page }) => {
  const session = await createOwnerWithProject(`指派项目 ${Date.now()}`);
  const alice = await createMember(session, '爱丽丝');
  const bob = await createMember(session, '鲍勃');
  await gotoBoardWithSession(page, session);

  // 创建：展开「更多字段」后用指派下拉选爱丽丝
  await openCreateDialog(page);
  const title = '指派回归：导出的 CSV 缺少 BOM';
  await page.getByPlaceholder('缺陷标题（两句核心描述即可，其他都能省）').fill(title);
  await page.getByTestId('bug-extras-toggle').click();
  await expect(page.getByTestId('bug-extras-panel')).toBeVisible();
  await page.getByTestId('bug-assignee-select').selectOption(alice.id);
  await page.getByTestId('bug-submit').click();

  // 卡片上出现负责人首字头像（未指派则是虚线 +）
  const card = page.getByTestId('bug-card').filter({ hasText: title });
  await expect(card).toBeVisible();
  const avatar = card.getByTestId('bug-assignee-avatar');
  await expect(avatar).toHaveText('爱');
  await expect(avatar).toHaveAttribute('title', `负责人 ${alice.name}`);
  await expect(card.getByTestId('bug-assignee-empty')).toHaveCount(0);

  // 详情改派给鲍勃
  await openBugDetail(page, title);
  await expect(page.getByTestId('bug-assignee-chip')).toHaveText(`负责人 ${alice.name}`);
  await page.getByTestId('bug-reassign-select').selectOption(bob.id);
  await expect(page.getByTestId('bug-assignee-chip')).toHaveText(`负责人 ${bob.name}`);

  // 关掉详情后看板同步更新
  await page.keyboard.press('Escape');
  await expect(card.getByTestId('bug-assignee-avatar')).toHaveText('鲍');

  await session.api.dispose();
});

test('卡片 50：TSV 多行粘贴批量导入（含坏行跳过）', async ({ page }) => {
  const session = await createOwnerWithProject(`速录项目 ${Date.now()}`);
  await gotoBoardWithSession(page, session);

  await openCreateDialog(page);
  // 带表头 + 一行坏行（不回填标题，忽略表头行）+ 一行合法行
  await pasteText(page, '标题\t严重度\t步骤\n导出按钮无响应\t高\t点导出后无反应\n\t高\t标题为空的坏行\n登录超时\t不存在的严重度\t网络正常也超时');
  const panel = page.getByTestId('tsv-import-panel');
  await expect(panel).toBeVisible();
  // 表头行也参与解析（当前解析器不做表头识别，会作为一条「表头」缺陷导入）
  await expect(panel.getByTestId('tsv-import-row')).toHaveCount(4);
  await expect(panel).toContainText('3 条可导入');
  await expect(panel).toContainText('1 条将跳过');

  await panel.getByTestId('tsv-import-confirm').click();
  await expect(panel).toHaveCount(0); // 导入完成自动关闭
  await expect(page.getByTestId('bug-card').filter({ hasText: '导出按钮无响应' })).toBeVisible();
  await expect(page.getByTestId('bug-card').filter({ hasText: '登录超时' })).toBeVisible();

  await session.api.dispose();
});
