import type { VibeEvent } from '../core/events.js';
import { subscribe as subscribeToPgEvents } from './sse-listener.js';
import { getActiveMcpEventSubscriptions } from './mcp-event-subscriptions.js';
import { sendWebhookEvent } from './mcp-event-webhook.js';

type NormalizedEvent = { name: string; projectId: string | null; entityId: string; status?: string };

function normalizeEvent(event: VibeEvent): NormalizedEvent {
  switch (event.type) {
    case 'bug.created':
    case 'bug.updated': return { name: event.type, projectId: event.projectId, entityId: event.bugId, ...('status' in event ? { status: event.status } : {}) };
    case 'task.created':
    case 'task.updated':
    case 'task.deleted': return { name: event.type, projectId: event.projectId, entityId: event.taskId, ...('status' in event ? { status: event.status } : {}) };
    case 'note.created':
    case 'note.updated':
    case 'note.deleted': return { name: event.type, projectId: event.projectId, entityId: event.noteId };
    case 'attachment.created':
    case 'attachment.deleted': return { name: event.type, projectId: event.projectId, entityId: event.attachmentId };
    case 'skill.changed': return { name: event.type, projectId: event.projectId, entityId: event.skillId };
  }
}

async function dispatch(event: VibeEvent): Promise<void> {
  const normalized = normalizeEvent(event);
  const subscriptions = await getActiveMcpEventSubscriptions(normalized.name);
  const deliveries = subscriptions
    .filter((subscription) => !subscription.args.project_id || subscription.args.project_id === normalized.projectId)
    .map(async (subscription) => {
      await sendWebhookEvent(
        { id: subscription.id, callbackUrl: subscription.callbackUrl, secret: subscription.secret },
        {
          name: normalized.name,
          timestamp: new Date().toISOString(),
          data: {
            project_id: normalized.projectId,
            entity_id: normalized.entityId,
            ...(normalized.status ? { status: normalized.status } : {}),
          },
        },
      );
    });
  const results = await Promise.allSettled(deliveries);
  const failures = results.filter((result) => result.status === 'rejected').length;
  if (failures > 0) console.warn(`[vibehub] MCP event delivery failed: ${normalized.name} (${failures}/${results.length})`);
}

/** PG LISTEN bridges writes from the web process and separate stdio MCP processes. */
export async function startMcpEventDelivery(): Promise<() => void> {
  return subscribeToPgEvents((payload) => {
    let event: VibeEvent;
    try { event = JSON.parse(payload) as VibeEvent; } catch { return; }
    if (!event || typeof event.type !== 'string' || !event.type.includes('.')) return;
    void dispatch(event).catch((error) => {
      console.warn(`[vibehub] MCP event dispatch failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    });
  });
}
