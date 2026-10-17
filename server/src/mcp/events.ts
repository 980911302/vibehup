import type { McpContext } from './context.js';
import { listMcpEventDefinitions, createOrRefreshMcpEventSubscription, removeMcpEventSubscription } from '../services/mcp-event-subscriptions.js';

export const MCP_EVENT_PROTOCOL_VERSION = '2026-07-28';
export const MCP_EVENT_METHODS = ['server/discover', 'events/list', 'events/subscribe', 'events/unsubscribe'] as const;

export function discoverMcpServer() {
  return {
    resultType: 'complete',
    supportedVersions: [MCP_EVENT_PROTOCOL_VERSION],
    capabilities: { tools: {}, events: {} },
  };
}

export async function handleMcpEventMethod(
  method: (typeof MCP_EVENT_METHODS)[number],
  params: Record<string, unknown>,
  ctx: McpContext,
): Promise<unknown> {
  switch (method) {
    case 'server/discover': return discoverMcpServer();
    case 'events/list': return { events: listMcpEventDefinitions() };
    case 'events/subscribe': return createOrRefreshMcpEventSubscription(ctx, params);
    case 'events/unsubscribe': return removeMcpEventSubscription(ctx, params);
  }
}
