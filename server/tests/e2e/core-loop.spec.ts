import { test, expect } from '@playwright/test';
import { createOwnerWithProject, gotoBoardWithSession, openCreateDialog, connectMcp } from './fixtures.js';

/**
 * 核心闭环 E2E（卡片 F3）：截图录入 → 缩略图加载 → MCP 读取 → 回填 → 看板刷新。
 * 断言点对应 docs/计划/09 的成功标准（验收库指标由 trial-metrics.sh 长期核对，此处锁行为）。
 * 前置：**空测试库**（首注册用户才是 Owner，否则建项目 403）——acceptance.sh 已在启动 E2E 服务前清库。
 */

const API_KEY_NAME = 'e2e-mcp-key';
const TITLE = 'E2E 闭环缺陷：登录按钮点了没反应';

// MCP 子进程必须与 HTTP 服务同库：父进程缺 DATABASE_URL 时会继承 server/.env 的 dev 库，
// 查不到测试库里的密钥 → 子进程 exit 1 → initialize 超时（本轮实测踩到）。
// acceptance.sh 已显式传入；这里做快速失败护栏，避免以「超时」这种模糊形态暴露。
if (!process.env.DATABASE_URL) {
  throw new Error('E2E 需要 DATABASE_URL（与 E2E 服务同库）；请经 bash scripts/acceptance.sh 运行，或显式设置 DATABASE_URL');
}

/** 1x1 透明 PNG（真实图片字节，供 <img> 解码） */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('截图录入 → 缩略图加载 → MCP 读取 → 回填 → 看板刷新', async ({ page }) => {
  const session = await createOwnerWithProject(`E2E 闭环项目 ${Date.now()}`);
  const { api, token, project } = session;
  await gotoBoardWithSession(page, session);

  // ── 1/5 截图录入：合成粘贴事件（与真实 Ctrl+V 同路径，卡片 37 起支持上传进度）──
  await openCreateDialog(page);
  await page.evaluate((b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'clip.png', { type: 'image/png' }));
    const target = document.querySelector('[data-testid="bug-paste-area"]') ?? document.body;
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, PNG_BASE64);
  // 上传完成的两个信号：对话框内预览缩略图出现 + 进度条消失
  // （用 last()：看板卡片可能存在同名文件，alt 会命中两个元素——本轮实测踩到 strict mode）
  await expect(page.getByAltText('clip.png').last()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('上传中…')).toHaveCount(0);
  await page.getByPlaceholder('缺陷标题（两句核心描述即可，其他都能省）').fill(TITLE);
  await page.getByTestId('bug-submit').click();

  // ── 2/5 看板刷新 + 缩略图真正解码（naturalWidth > 0，R76 回归核心断言）──
  const card = page.getByTestId('bug-card').filter({ hasText: TITLE });
  await expect(card).toBeVisible();
  await expect
    .poll(async () => card.locator('img').first().evaluate((el) => (el as HTMLImageElement).naturalWidth), {
      message: '看板缩略图应真实解码（签名 public_url 未被 401/404）',
    })
    .toBeGreaterThan(0);

  // ── 3/5 MCP 读取：真实 stdio 子进程，与 IDE 同款传输 ──
  const keyRes = await api.post('/api/api-keys', {
    headers: { authorization: `Bearer ${token}` },
    data: { name: API_KEY_NAME, scopes: ['context:read', 'bug:write', 'attachment:read'] },
  });
  expect(keyRes.status()).toBe(201);
  const { key } = await keyRes.json();
  const mcp = await connectMcp(key);
  try {
    const list = await mcp.call('list_bugs', { project_slug: project.slug });
    expect(JSON.stringify(list)).toContain(TITLE);
    const bugId = await api
      .get(`/api/bugs?project_id=${project.id}`, { headers: { authorization: `Bearer ${token}` } })
      .then(async (r) => (await r.json()).items.find((b: any) => b.title === TITLE).id);
    const detail = await mcp.call('get_bug_detail', { bug_id: bugId });
    expect(JSON.stringify(detail)).toContain(TITLE);
    expect(JSON.stringify(detail)).toContain('clip.png');

    // ── 4/5 回填：AI 写评论 + 按状态机推进（open→in_progress→resolved；不允许跨级跳）──
    const commented = await mcp.call('add_bug_comment', { bug_id: bugId, content: 'E2E：AI 已复现并修复' });
    expect(commented.result?.isError ?? commented.isError ?? false, JSON.stringify(commented).slice(0, 300)).toBe(false);
    const started = await mcp.call('update_bug_status', { bug_id: bugId, status: 'in_progress' });
    expect(started.result?.isError ?? started.isError ?? false, JSON.stringify(started).slice(0, 300)).toBe(false);
    const resolved = await mcp.call('update_bug_status', {
      bug_id: bugId,
      status: 'resolved',
      resolution_notes: 'E2E 回填：修复登录按钮事件绑定',
      commit_hash: 'e2e0000',
    });
    expect(resolved.result?.isError ?? resolved.isError ?? false, JSON.stringify(resolved).slice(0, 300)).toBe(false);
  } finally {
    mcp.close();
  }

  // ── 5/5 看板刷新：卡片从「待处理」列移动到「已解决」列（SSE 推送 / 轮询兜底）──
  const resolvedColumn = page.getByTestId('board-column-resolved');
  await expect
    .poll(async () => resolvedColumn.getByText(TITLE).count(), {
      message: '看板应在状态回填后把卡片渲染进「已解决」列',
      timeout: 20_000,
    })
    .toBeGreaterThan(0);
  expect(await page.getByTestId('board-column-open').getByText(TITLE).count()).toBe(0);

  const boardAfter = await api.get(`/api/bugs/board/${project.id}`, { headers: { authorization: `Bearer ${token}` } });
  const boardJson = await boardAfter.json();
  const resolvedBug = boardJson.resolved.find((b: any) => b.title === TITLE);
  expect(resolvedBug).toBeTruthy();
  expect(resolvedBug.git_commit_hash).toBe('e2e0000');

  await api.dispose();
});
