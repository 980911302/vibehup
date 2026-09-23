import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from './prisma.js';
import { resetDb, createApiKey } from '../test-helpers.js';
import { mcpStore } from '../mcp/context-store.js';
import { guarded } from '../mcp/guard.js';
import type { McpContext } from '../mcp/context.js';

/** MCP 上下文传递（R69 修复）：SSE 连接必须跑在握手时的 keyed 上下文里 */

function keyedCtx(keyId: string, scopes: string[]): McpContext {
  return { mode: 'keyed', apiKeyId: keyId, scopes: new Set(scopes), actorLabel: 'test-key' };
}

beforeEach(async () => {
  await resetDb();
});

describe('mcpStore + guarded 上下文传递', () => {
  it('store 中的 keyed 上下文：越权调用被拒（修 SSE scope 静默绕过）', async () => {
    const key = await createApiKey({ scopes: ['context:read'] });
    const handler = guarded('update_bug_status', 'bug:write', async () => ({ ok: true }));
    const res = await mcpStore.run(keyedCtx(key.id, ['context:read']), () => handler({ bug_id: 'x', status: 'resolved' }));
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('缺少 scope');
  });

  it('store 中的 keyed 上下文：授权范围内调用放行', async () => {
    const key = await createApiKey({ scopes: ['context:read'] });
    const handler = guarded('list_bugs', 'context:read', async () => ({ items: [] }));
    const res = await mcpStore.run(keyedCtx(key.id, ['context:read']), () => handler({}));
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(res.content[0].text)).toEqual({ items: [] });
  });

  it('打点归属到 store 中的密钥（修 SSE 用量 api_key_id 为 NULL）', async () => {
    const key = await createApiKey({ scopes: ['context:read'] });
    const handler = guarded('list_bugs', 'context:read', async () => ({ items: [] }));
    await mcpStore.run(keyedCtx(key.id, ['context:read']), () => handler({}));
    const events = await prisma.usageEvent.findMany({ where: { apiKeyId: key.id } });
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('mcp.tool_call');
  });

  it('store 之外（stdio 进程）仍回落 env 解析，行为不变', async () => {
    // 测试环境无 VIBEHUB_API_KEY → local 上下文 → 全权放行 + 打点 apiKeyId 为 null
    delete process.env.VIBEHUB_API_KEY;
    const handler = guarded('list_bugs', 'context:read', async () => ({ ok: true }));
    const res = await handler({});
    expect(res.isError).toBeFalsy();
    const events = await prisma.usageEvent.findMany({ where: { apiKeyId: null } });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});
