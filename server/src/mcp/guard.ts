import type { McpContext } from './context.js';
import { resolveMcpContext, refreshKeyedContext, ctxHas } from './context.js';
import { mcpStore } from './context-store.js';
import { recordToolCall } from './usage.js';
import { enforceSizeBudget } from './token-budget.js';
import { AppError } from '../core/errors.js';
import type { Scope } from './scopes.js';

/**
 * MCP 工具统一包装（步骤 03 §3.4 契约）：
 * scope 校验 → 执行 → Token 经济学校形 → 打点。错误一律转为 isError 结果，不穿协议层。
 */

export type McpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface ToolSuccess {
  content: McpContentBlock[];
  isError?: boolean;
  /** MCP SDK 的工具回调返回类型要求索引签名 */
  [key: string]: unknown;
}

export function toolResult(data: unknown): ToolSuccess {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/**
 * 工具要返回 MCP 原生内容块（如图片，R84）时返回它：guard 原样透传，
 * 多模态客户端会把图片直接呈现给模型；其余返回值照常 JSON 化为文本。
 */
export class ToolContent {
  constructor(readonly blocks: McpContentBlock[]) {}
}

export function toolError(message: string): ToolSuccess {
  return { content: [{ type: 'text', text: `错误: ${message}` }], isError: true };
}

export type ToolFn = (ctx: McpContext, args: Record<string, unknown>) => Promise<unknown>;

/** 注册一个带 scope 守卫与计量的工具处理器 */
export function guarded(toolName: string, scope: Scope, fn: ToolFn) {
  return async (args: Record<string, unknown>): Promise<ToolSuccess> => {
    let ctx: McpContext;
    try {
      // 优先取 SSE 连接上下文（mcpStore），且每次调用复核密钥状态（R76：撤销即时生效）；
      // stdio 进程无 store，回落 env 解析（每次调用本就按明文密钥重查）
      const sessionCtx = mcpStore.get();
      ctx = sessionCtx ? await refreshKeyedContext(sessionCtx) : await resolveMcpContext();
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
    if (!ctxHas(ctx, scope)) {
      return toolError(`缺少 scope: ${scope}。请在 Web 端「密钥」页为该密钥授予权限后重试`);
    }

    const t0 = Date.now();
    try {
      const data = await fn(ctx, args);
      if (data instanceof ToolContent) {
        const bytesOut = data.blocks.reduce((n, b) => n + (b.type === 'text' ? Buffer.byteLength(b.text) : b.data.length), 0);
        await recordToolCall(ctx, { tool: toolName, latencyMs: Date.now() - t0, bytesOut, result: 'ok' });
        return { content: data.blocks };
      }
      const shaped = enforceSizeBudget(data as never);
      const bytesOut = Buffer.byteLength(JSON.stringify(shaped));
      await recordToolCall(ctx, { tool: toolName, latencyMs: Date.now() - t0, bytesOut, result: 'ok' });
      return toolResult(shaped);
    } catch (err) {
      await recordToolCall(ctx, { tool: toolName, latencyMs: Date.now() - t0, bytesOut: 0, result: 'error' });
      if (err instanceof AppError) return toolError(err.message);
      console.error(`[vibehub-mcp] ${toolName} 未预期错误:`, err);
      return toolError(`内部错误: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}
