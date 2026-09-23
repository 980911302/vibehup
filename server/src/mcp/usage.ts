import { prisma } from '../core/prisma.js';
import { logEvent } from '../services/audit.js';
import type { McpContext } from './context.js';

/**
 * MCP 调用计量（闭环⑤）。
 * 每次工具调用：UsageEvent 落账 + ApiKey.lastUsedAt 更新（keyed 模式）。
 */

export interface ToolCallRecord {
  tool: string;
  latencyMs: number;
  bytesOut: number;
  result: 'ok' | 'error';
}

export async function recordToolCall(ctx: McpContext, record: ToolCallRecord): Promise<void> {
  // 必须 await：即发即弃会让紧随其后的用量查询漏账（竞态）
  await logEvent({
    apiKeyId: ctx.apiKeyId,
    eventType: 'mcp.tool_call',
    metadata: {
      tool: record.tool,
      latency_ms: record.latencyMs,
      bytes_out: record.bytesOut,
      result: record.result,
      actor: ctx.actorLabel,
    },
  });
  if (ctx.mode === 'keyed' && ctx.apiKeyId) {
    try {
      await prisma.apiKey.update({
        where: { id: ctx.apiKeyId },
        data: { lastUsedAt: new Date() },
      });
    } catch {
      // lastUsedAt 更新失败不影响主流程
    }
  }
}
