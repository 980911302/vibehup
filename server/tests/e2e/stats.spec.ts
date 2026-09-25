import { test, expect } from '@playwright/test';
import { createOwnerWithProject, connectMcp } from './fixtures.js';

/**
 * 统计页闭环（R85）：经 MCP 把一个缺陷走到 verified、完成一个任务后，
 * 统计页「今天」两项各 +1，「按密钥」行显示该密钥名。
 * 前置同 core-loop.spec.ts：空测试库、DATABASE_URL 与 HTTP 服务同库。
 */
if (!process.env.DATABASE_URL) {
  throw new Error('E2E 需要 DATABASE_URL（与 E2E 服务同库）；请经 bash scripts/acceptance.sh 运行，或显式设置 DATABASE_URL');
}

const KEY_NAME = 'e2e-stats-key';

test('MCP 把缺陷验证完成、任务完成后，统计页今天数字与按密钥行都更新', async ({ page }) => {
  const session = await createOwnerWithProject(`统计闭环 ${Date.now()}`);
  const { api, token, project } = session;
  const headers = { authorization: `Bearer ${token}` };

  const bugRes = await api.post('/api/bugs', { headers, data: { project_id: project.id, title: '统计闭环：登录接口偶发 500' } });
  expect(bugRes.status()).toBe(201);
  const bugId = (await bugRes.json()).id as string;

  const taskRes = await api.post('/api/tasks', { headers, data: { project_id: project.id, title: '统计闭环：补充接口重试逻辑' } });
  expect(taskRes.status()).toBe(201);
  const taskId = (await taskRes.json()).id as string;

  const keyRes = await api.post('/api/api-keys', {
    headers,
    data: { name: KEY_NAME, scopes: ['context:read', 'bug:write', 'task:write'] },
  });
  expect(keyRes.status()).toBe(201);
  const { key } = await keyRes.json();

  const mcp = await connectMcp(key);
  try {
    for (const status of ['in_progress', 'resolved', 'verifying', 'verified']) {
      const r = await mcp.call('update_bug_status', { bug_id: bugId, status, resolution_notes: status === 'resolved' ? '已定位并修复' : undefined });
      expect(r.result?.isError ?? r.isError ?? false, JSON.stringify(r).slice(0, 200)).toBe(false);
    }
    for (const status of ['doing', 'review', 'verifying', 'done']) {
      const r = await mcp.call('update_task', { task_id: taskId, status });
      expect(r.result?.isError ?? r.isError ?? false, JSON.stringify(r).slice(0, 200)).toBe(false);
    }
  } finally {
    mcp.close();
  }

  // 直接注入登录态进统计页（复用 fixtures 的写法，不经 gotoBoardWithSession 以免多余跳转）。
  // 必须同时锁定「当前项目」= 本用例项目：E2E Owner 名下已有多个项目，
  // 不锁定的话页面默认查「当前项目」会落到别的项目上，数字断言随机为 0。
  await page.addInitScript(([t, pid]) => {
    localStorage.setItem('vibehub_token', t as string);
    localStorage.setItem('vibehub_onboarded', '1');
    localStorage.setItem('vibehub_current_project', pid as string);
  }, [token, project.id]);
  await page.goto('/stats');
  await expect(page.getByTestId('stats-refresh')).toBeVisible();

  await expect
    .poll(async () => {
      const res = await api.get(`/api/stats?project_id=${project.id}`, { headers });
      return (await res.json()).today.bugs_fixed;
    }, { message: '接口应统计到今天修复完成 1 个缺陷', timeout: 15_000 })
    .toBe(1);

  await page.getByTestId('stats-refresh').click();
  await expect(page.getByText('修复完成的缺陷')).toBeVisible();
  const todaySection = page.locator('section', { hasText: '今天' }).first();
  await expect(todaySection.getByText('1', { exact: true }).first()).toBeVisible();

  await expect(page.getByTestId('stats-by-actor-table')).toBeVisible();
  const actorRow = page.getByTestId('stats-by-actor-table').locator('tr', { hasText: KEY_NAME });
  await expect(actorRow).toBeVisible();
  await expect(actorRow).toContainText('AI');

  await api.dispose();
});