import { defineConfig } from '@playwright/test';

/**
 * 核心闭环 E2E（卡片 F3）：真实浏览器 + 真实后端 + 真实 MCP stdio。
 * 服务与静态产物由 acceptance.sh 的 E2E 步骤准备（web/out 构建 + tsx src/index.ts）；
 * 本配置不做 reuse 之外的编排，直接连 E2E_BASE（默认 :3457）。
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE ?? 'http://127.0.0.1:3457',
    headless: true,
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
