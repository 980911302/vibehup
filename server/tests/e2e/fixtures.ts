import { expect, request as pwRequest, type APIRequestContext, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * E2E 共用夹具（卡片 F1/F3）：经 API 准备 Owner/成员/项目，再把登录态注入浏览器。
 * 前置：空测试库（首注册用户才是 Owner）——acceptance.sh 已在 E2E 前清库。
 *
 * Owner 只注册一次：整套用例共用同一 Owner（并发/多文件注册第二个用户会降级为 member，
 * 无法建项目），凭据写在模块同级的 .test-owner.json（gitignore），每个用例再建自己的项目。
 */

export const E2E_BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3457';

const CRED_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.test-owner.json');
const OWNER_PASSWORD = 'abcd1234';

export interface OwnerSession {
  api: APIRequestContext;
  token: string;
  user: { id: string; name: string };
  project: { id: string; slug: string };
}

let seq = 0;
export function uniqueEmail(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now()}_${seq}@vibehub.local`;
}

interface OwnerCred {
  email: string;
  userId: string;
  name: string;
}

function readCred(): OwnerCred | null {
  try {
    return JSON.parse(fs.readFileSync(CRED_FILE, 'utf8')) as OwnerCred;
  } catch {
    return null;
  }
}

/** 取得本套 E2E 的 Owner 令牌（不存在则注册，存在则登录） */
async function ensureOwner(api: APIRequestContext): Promise<{ token: string; cred: OwnerCred }> {
  const existing = readCred();
  if (existing) {
    const login = await api.post('/api/auth/login', { data: { email: existing.email, password: OWNER_PASSWORD } });
    if (login.status() === 200) {
      const body = await login.json();
      expect(body.user.role, '复用 Owner 应为 owner 角色').toBe('owner');
      return { token: body.access_token, cred: existing };
    }
  }
  const email = uniqueEmail('e2e-owner');
  const reg = await api.post('/api/auth/register', { data: { email, password: OWNER_PASSWORD, name: 'E2E Owner' } });
  expect(reg.status(), await reg.text()).toBe(201);
  const body = await reg.json();
  expect(body.user.role, '空库首注册用户应为 owner').toBe('owner');
  const cred: OwnerCred = { email, userId: body.user.id, name: body.user.name };
  fs.writeFileSync(CRED_FILE, JSON.stringify(cred));
  return { token: body.access_token, cred };
}

/** 复用 Owner + 新建本项目，返回 API 上下文与令牌 */
export async function createOwnerWithProject(projectName = 'E2E 项目'): Promise<OwnerSession> {
  const api = await pwRequest.newContext({ baseURL: E2E_BASE });
  const { token, cred } = await ensureOwner(api);

  const projectRes = await api.post('/api/projects', {
    headers: { authorization: `Bearer ${token}` },
    data: { name: projectName },
  });
  expect(projectRes.status(), await projectRes.text()).toBe(201);
  const project = await projectRes.json();
  return { api, token, user: { id: cred.userId, name: cred.name }, project: { id: project.id, slug: project.slug } };
}

/** 通过管理接口建一个 member 账号（用于指派场景）；/api/users 响应为 { user, one_time_password } */
export async function createMember(session: OwnerSession, name: string): Promise<{ id: string; name: string }> {
  const res = await session.api.post('/api/users', {
    headers: { authorization: `Bearer ${session.token}` },
    data: { email: uniqueEmail('member'), name, role: 'member' },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  const user = body.user ?? body;
  return { id: user.id, name: user.name };
}

/** 注入登录态并跳过首启向导，随后进入看板 */
export async function gotoBoardWithSession(page: Page, session: OwnerSession): Promise<void> {
  await page.addInitScript(
    ([t]) => {
      localStorage.setItem('vibehub_token', t as string);
      localStorage.setItem('vibehub_onboarded', '1');
    },
    [session.token],
  );
  await page.goto('/board');
  await expect(page.getByPlaceholder('搜索缺陷')).toBeVisible();
}

/** 打开「录缺陷」对话框并等标题输入框就绪 */
export async function openCreateDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: /录缺陷/ }).first().click();
  await expect(page.getByPlaceholder('缺陷标题（两句核心描述即可，其他都能省）')).toBeVisible();
}

/** 在看板打开某缺陷详情（点卡片）。详情标题以 level 2 呈现 */
export async function openBugDetail(page: Page, title: string): Promise<void> {
  await page.getByTestId('bug-card').filter({ hasText: title }).first().click();
  await expect(page.getByTestId('bug-assignee-chip')).toBeVisible();
}

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export interface McpClient {
  call: (name: string, args?: Record<string, unknown>) => Promise<any>;
  close: () => void;
}

/**
 * MCP stdio 子进程客户端（与 IDE 同款传输）。
 * DATABASE_URL 必须与 HTTP 服务同库：父进程缺 DATABASE_URL 时会继承 server/.env 的 dev 库，
 * 查不到测试库里的密钥 → 子进程 exit 1 → initialize 超时（历史踩坑）。
 */
export async function connectMcp(apiKey: string): Promise<McpClient> {
  const child = spawn('npx', ['tsx', 'src/mcp-entry.ts'], {
    cwd: SERVER_DIR,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, VIBEHUB_API_KEY: apiKey },
  });
  let buf = '';
  let nextId = 1;
  const pending = new Map<number, (v: any) => void>();
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && pending.has(msg.id)) {
          pending.get(msg.id)?.(msg);
          pending.delete(msg.id);
        }
      } catch {
        /* 非 JSON 行忽略（stdout 只应有 JSON-RPC） */
      }
    }
  });
  child.stderr.on('data', () => {});
  const send = (method: string, params?: unknown) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      setTimeout(() => reject(new Error(`MCP ${method} 超时`)), 25_000);
    });
  await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  return {
    call: (name, args = {}) => send('tools/call', { name, arguments: args }),
    close: () => child.kill(),
  };
}
