import { chromium } from 'playwright';

/**
 * 点击延迟体检（R78 排查）：真实浏览器里测「点击 → 界面响应」的网络与耗时，
 * 与 curl 测得的接口耗时对照，判断瓶颈在接口还是在客户端。
 * 用法：node scripts/perf-probe.mjs [BASE] [email] [password]
 */
const BASE = process.argv[2] ?? 'http://127.0.0.1:3458';
const EMAIL = process.argv[3] ?? 'perf@t.local';
const PASSWORD = process.argv[4] ?? 'abcd1234';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const calls = [];
page.on('requestfinished', async (req) => {
  const url = req.url();
  if (!url.includes('/api/')) return;
  const res = await req.response();
  const timing = req.timing();
  const dur = timing.responseEnd >= 0 ? timing.responseEnd - timing.requestStart : -1;
  calls.push({ url: url.replace(BASE, ''), method: req.method(), status: res?.status() ?? 0, ms: dur });
});

// 登录并写入登录态
const login = await page.request.post(`${BASE}/api/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
const { access_token: token } = await login.json();
await page.addInitScript((t) => {
  localStorage.setItem('vibehub_token', t);
  localStorage.setItem('vibehub_onboarded', '1');
}, token);

const t = async (label, fn) => {
  const t0 = Date.now();
  await fn();
  console.log(`  ${label}: ${Date.now() - t0}ms`);
};

console.log('=== 1) 打开看板（首次）===');
await t('goto /board + 看板渲染', async () => {
  await page.goto(`${BASE}/board`);
  await page.getByPlaceholder('搜索缺陷').waitFor({ state: 'visible' });
  await page.getByTestId('bug-card').first().waitFor({ state: 'visible', timeout: 30000 });
});

console.log('=== 2) 点击缺陷卡片 → 详情弹窗 ===');
await t('点击卡片到弹窗可见', async () => {
  await page.getByTestId('bug-card').first().click();
  await page.getByTestId('bug-assignee-chip').waitFor({ state: 'visible' });
});
await page.keyboard.press('Escape');

console.log('=== 3) 拖拽改状态（走状态按钮：详情内点「进行中」）===');
await t('点击卡片到详情', async () => {
  await page.getByTestId('bug-card').first().click();
  await page.getByTestId('bug-assignee-chip').waitFor({ state: 'visible' });
});
const statusBtn = page.locator('button', { hasText: /^进行中$/ }).first();
if (await statusBtn.count()) {
  await t('点「进行中」到弹窗状态更新', async () => {
    await statusBtn.click();
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="bug-assignee-chip"]');
      return el !== null;
    });
    await page.waitForTimeout(400);
  });
} else {
  console.log('  （未找到状态按钮，跳过）');
}
await page.keyboard.press('Escape');

console.log('=== 4) 输入搜索（每次按键触发过滤）===');
await t('输入 3 个字符并等待稳定', async () => {
  await page.getByPlaceholder('搜索缺陷').fill('性能');
  await page.waitForTimeout(600);
});
await page.getByPlaceholder('搜索缺陷').fill('');

console.log('=== 5) 静置 12s：统计轮询与 SSE 的后台请求 ===');
calls.length = 0;
await page.waitForTimeout(12000);
const byUrl = new Map();
for (const c of calls) byUrl.set(c.url, (byUrl.get(c.url) ?? 0) + 1);
console.log(`  12s 内后台请求共 ${calls.length} 次：`);
for (const [url, n] of [...byUrl].sort((a, b) => b[1] - a[1])) console.log(`    ${n}× ${url}`);

await browser.close();
