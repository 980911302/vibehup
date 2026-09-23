import { prisma } from '../core/prisma.js';

/**
 * AI 活动可见流（卡片 36）：usage_events 中 MCP 调用的脱敏视图。
 * 全员可读（路由层不挂 requireRole）——让非管理员也能感知「AI 读了什么」；
 * 脱敏：只出密钥展示名/前缀，禁出 keyHash/salt（Prisma select 收敛）。
 */

export interface ActivityItem {
  id: string;
  event_type: string;
  tool: string | null;
  actor: string | null;
  result: string | null;
  latency_ms: number | null;
  key_name: string | null;
  key_prefix: string | null;
  created_at: string;
}

function parseMetadata(raw: string | null): { tool?: string; actor?: string; result?: string; latency_ms?: number } {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as { tool?: string; actor?: string; result?: string; latency_ms?: number };
  } catch {
    return {};
  }
}

export async function listRecentActivity(limit = 20): Promise<ActivityItem[]> {
  const rows = await prisma.usageEvent.findMany({
    where: { eventType: 'mcp.tool_call' },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
    include: {
      apiKey: { select: { name: true, keyPrefix: true } },
    },
  });
  return rows.map((r) => {
    const meta = parseMetadata(r.metadata);
    return {
      id: r.id,
      event_type: r.eventType,
      tool: meta.tool ?? null,
      actor: meta.actor ?? null,
      result: meta.result ?? null,
      latency_ms: typeof meta.latency_ms === 'number' ? meta.latency_ms : null,
      key_name: r.apiKey?.name ?? null,
      key_prefix: r.apiKey?.keyPrefix ?? null,
      created_at: r.createdAt.toISOString(),
    };
  });
}
