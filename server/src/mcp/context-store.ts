import { AsyncLocalStorage } from 'node:async_hooks';
import type { McpContext } from './context.js';

/**
 * MCP 上下文异步传递（R69 修复安全级 bug）。
 * SSE 传输中每次工具调用如果各自 resolveMcpContext()，HTTP 进程没有
 * VIBEHUB_API_KEY 环境变量 → 全部落到 local 全权上下文：scope 校验被静默
 * 绕过（限权密钥能调写操作）、用量打点 api_key_id 为 NULL。
 * 握手时把 keyed ctx 存入 ALS，工具调用在 store 内运行时优先取之。
 */

const storage = new AsyncLocalStorage<{ ctx: McpContext }>();

export const mcpStore = {
  /** 在给定上下文内执行（SSE 消息处理包裹层） */
  run<T>(ctx: McpContext, fn: () => T): T {
    return storage.run({ ctx }, fn);
  },
  /** 取当前上下文；无则 null（调用方回落 env 解析，保持 stdio 行为） */
  get(): McpContext | null {
    return storage.getStore()?.ctx ?? null;
  },
};
