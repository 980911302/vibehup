import { prisma } from '../core/prisma.js';
import { ids } from '../core/ids.js';

/**
 * 计量与审计事件（闭环⑤的账本）。
 * 所有认证、密钥操作、MCP 调用均经此落 UsageEvent。
 */

export interface LogEventInput {
  userId?: string | null;
  apiKeyId?: string | null;
  eventType: string;
  metadata?: Record<string, unknown>;
}

export async function logEvent(input: LogEventInput): Promise<void> {
  try {
    await prisma.usageEvent.create({
      data: {
        id: ids.attachment(),
        userId: input.userId ?? null,
        apiKeyId: input.apiKeyId ?? null,
        eventType: input.eventType,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
    });
  } catch (err) {
    // 计量失败不阻断业务主流程，仅告警式日志
    console.error('[vibehub] usage event 写入失败:', err);
  }
}
