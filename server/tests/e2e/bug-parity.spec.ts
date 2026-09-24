import { test, expect, type Page } from '@playwright/test';
import { createOwnerWithProject, gotoBoardWithSession, openBugDetail, uniqueEmail, type OwnerSession } from './fixtures.js';

/**
 * R81 浏览器回归（功能巡检第一批 + 第二批 1、2）：
 * ① 缺陷详情全字段可改、只摆合法下一步、页内写重开原因、二次确认删除、截止日期上卡片；
 * ② 拖拽跳级有提示（此前静默弹回）；
 * ③ 提出人 +「指派给我 / 我提的 / 未指派」筛选；
 * ④ 只读成员（viewer）看不到任何写入口。
 */

function auth(session: OwnerSession) {
  return { authorization: `Bearer ${session.token}` };
}

async function createBug(session: OwnerSession, data: Record<string, unknown>, token = session.token): Promise<string> {
  const res = await session.api.post('/api/bugs', {
    headers: { authorization: `Bearer ${token}` },
    data: { project_id: session.project.id, ...data },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id as string;
}

/** 建一个指定角色的成员并用一次性密码登录，拿到其令牌 */
async function createUserToken(session: OwnerSession, name: string, role: 'member' | 'viewer'): Promise<{ id: string; token: string }> {
  const email = uniqueEmail(role);
  const res = await session.api.post('/api/users', { headers: auth(session), data: { email, name, role } });
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  const login = await session.api.post('/api/auth/login', { data: { email, password: body.one_time_password } });
  expect(login.status(), await login.text()).toBe(200);
  return { id: body.user.id, token: (await login.json()).access_token };
}

function card(page: Page, title: string) {
  return page.getByTestId('bug-card').filter({ hasText: title });
}

test('缺陷详情：改标题、合法下一步、重开写原因、截止日期、二次确认删除', async ({ page }) => {
  const session = await createOwnerWithProject(`详情项目 ${Date.now()}`);
  await createBug(session, { title: '支付回调偶发 500', severity: 'high' });
  await gotoBoardWithSession(page, session);

  await openBugDetail(page, '支付回调偶发 500');
  await expect(page.getByTestId('bug-reporter')).toHaveText(`提出人 ${session.user.name}`);
  await expect(page.getByTestId('bug-status-chip')).toHaveText('待处理');
  // 待处理只能去「进行中」，不摆跳级按钮
  await expect(page.getByTestId('bug-to-resolved')).toHaveCount(0);
  await page.getByTestId('bug-to-in_progress').click();
  await expect(page.getByTestId('bug-status-chip')).toHaveText('进行中');
  await page.getByTestId('bug-to-resolved').click();
  await expect(page.getByTestId('bug-status-chip')).toHaveText('已解决');

  // 重开：页内写原因（不是浏览器原生 prompt）
  await page.getByTestId('bug-to-open').click();
  const form = page.getByTestId('bug-reopen-form');
  await form.locator('input').fill('生产环境还能复现');
  await form.getByRole('button', { name: '确认重开' }).click();
  await expect(page.getByTestId('bug-status-chip')).toHaveText('待处理');
  await expect(page.getByTestId('bug-detail')).toContainText('重开原因：生产环境还能复现');
  await expect(page.getByTestId('bug-detail')).toContainText('状态变更：已解决 → 待处理');

  // 标题、复现步骤、截止日期
  const titleInput = page.getByTestId('bug-detail-title');
  await titleInput.fill('支付回调偶发 500（微信渠道）');
  await titleInput.press('Enter');
  await page.getByTestId('bug-steps_to_reproduce').fill('1. 下单\n2. 微信支付');
  await page.getByTestId('bug-text-save').click();
  await expect(page.getByTestId('bug-text-save')).toHaveCount(0);
  await page.getByTestId('bug-due-input').fill('2020-01-02');
  await page.keyboard.press('Escape');

  const renamed = card(page, '支付回调偶发 500（微信渠道）');
  await expect(renamed).toBeVisible();
  await expect(renamed.getByTestId('bug-due')).toHaveText(/逾期 01-02/);

  // 删除要二次确认
  await openBugDetail(page, '支付回调偶发 500（微信渠道）');
  await page.getByTestId('bug-delete').click();
  await page.getByTestId('bug-delete-confirm').click();
  await expect(page.getByTestId('bug-detail')).toBeHidden();
  await expect(renamed).toHaveCount(0);

  await session.api.dispose();
});

test('拖拽跳级给出提示，合法拖拽生效', async ({ page }) => {
  const session = await createOwnerWithProject(`拖拽项目 ${Date.now()}`);
  await createBug(session, { title: '导出 Excel 乱码' });
  await gotoBoardWithSession(page, session);

  const bug = card(page, '导出 Excel 乱码');
  await bug.dragTo(page.getByTestId('board-column-resolved'));
  await expect(page.getByText('「待处理」不能直接到「已解决」，只能改为：进行中 / 已关闭')).toBeVisible();
  await expect(page.getByTestId('board-column-open').getByTestId('bug-card').filter({ hasText: '导出 Excel 乱码' })).toBeVisible();

  await bug.dragTo(page.getByTestId('board-column-in_progress'));
  await expect(page.getByTestId('board-column-in_progress').getByTestId('bug-card').filter({ hasText: '导出 Excel 乱码' })).toBeVisible();

  await session.api.dispose();
});

test('提出人 +「指派给我 / 我提的 / 未指派」筛选', async ({ page }) => {
  const session = await createOwnerWithProject(`筛选项目 ${Date.now()}`);
  const member = await createUserToken(session, '莫妮卡', 'member');
  await createBug(session, { title: '我提的并指派给我', assignee_id: session.user.id });
  await createBug(session, { title: '成员提的未指派' }, member.token);
  await createBug(session, { title: '我提的指派给成员', assignee_id: member.id });
  await gotoBoardWithSession(page, session);

  const titles = ['我提的并指派给我', '成员提的未指派', '我提的指派给成员'];
  const expectVisible = async (visible: string[]) => {
    for (const t of titles) await expect(card(page, t)).toHaveCount(visible.includes(t) ? 1 : 0);
  };

  await expectVisible(titles);
  await page.getByTestId('board-who-mine').click();
  await expectVisible(['我提的并指派给我']);
  await page.getByTestId('board-who-reported').click();
  await expectVisible(['我提的并指派给我', '我提的指派给成员']);
  await page.getByTestId('board-who-unassigned').click();
  await expectVisible(['成员提的未指派']);
  await page.getByTestId('board-who-all').click();
  await expectVisible(titles);

  await openBugDetail(page, '成员提的未指派');
  await expect(page.getByTestId('bug-reporter')).toHaveText('提出人 莫妮卡');

  await session.api.dispose();
});

test('只读成员：看得到缺陷，但没有任何写入口', async ({ page }) => {
  const session = await createOwnerWithProject(`只读项目 ${Date.now()}`);
  const viewer = await createUserToken(session, '维多利亚', 'viewer');
  await createBug(session, { title: '首页白屏' });
  await gotoBoardWithSession(page, { ...session, token: viewer.token });

  await expect(card(page, '首页白屏')).toBeVisible();
  await expect(page.getByRole('button', { name: /录缺陷/ })).toHaveCount(0);
  await openBugDetail(page, '首页白屏');
  await expect(page.getByTestId('bug-status-chip')).toHaveText('待处理');
  await expect(page.getByTestId('bug-to-in_progress')).toHaveCount(0);
  await expect(page.getByTestId('bug-delete')).toHaveCount(0);
  await expect(page.getByTestId('bug-detail-title')).toBeDisabled();
  await expect(page.getByTestId('bug-severity-select')).toBeDisabled();

  await session.api.dispose();
});
