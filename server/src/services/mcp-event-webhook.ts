import { config } from '../config.js';
import { postPinned, validateWebhookUrl } from '../core/mcp-webhook-http.js';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export interface WebhookSubscription {
  id: string;
  callbackUrl: string;
  secret: string;
}

function signingSecret(value: string): Buffer {
  if (!value.startsWith('whsec_')) throw new Error('Webhook 签名密钥格式无效');
  const key = Buffer.from(value.slice(6), 'base64');
  if (key.length < 24 || key.length > 64) throw new Error('Webhook 签名密钥长度无效');
  return key;
}

function signedHeaders(id: string, timestamp: string, body: string, key: Buffer, subscriptionId: string) {
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return {
    'content-type': 'application/json',
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${signature}`,
    'X-MCP-Subscription-Id': subscriptionId,
  };
}

async function postWebhook(url: string, body: string, headers: Record<string, string>): Promise<string> {
  const relay = config.mcpEventRelay;
  if (!relay.url && !relay.token) return postPinned(url, body, headers);
  if (!relay.url || relay.token.length < 32) throw new Error('MCP 事件中转地址或令牌配置不完整');
  validateWebhookUrl(url);
  // Callback resolution and IP pinning happen at the trusted egress relay.
  const response = await fetch(relay.url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${relay.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ url, body, headers }),
  });
  if (!response.ok) throw new Error(`Webhook 中转返回 HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Webhook 中转响应为空');
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16_384) throw new Error('Webhook 中转响应过大');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString('utf8');
}

export async function verifyWebhookCallback(subscription: WebhookSubscription): Promise<void> {
  const key = signingSecret(subscription.secret);
  const id = `msg_verification_${randomUUID()}`;
  const challenge = randomUUID();
  const body = JSON.stringify({ type: 'verification', challenge });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const response = await postWebhook(
    subscription.callbackUrl,
    body,
    signedHeaders(id, timestamp, body, key, subscription.id),
  );
  let echoed: unknown;
  try { echoed = (JSON.parse(response) as { challenge?: unknown }).challenge; } catch { /* invalid callback body */ }
  const expected = Buffer.from(challenge);
  const actual = Buffer.from(typeof echoed === 'string' ? echoed : '');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('Webhook 回调验证失败：challenge 不匹配');
  }
}

export async function sendWebhookEvent(
  subscription: WebhookSubscription,
  event: { name: string; data: Record<string, unknown>; timestamp: string },
): Promise<void> {
  const key = signingSecret(subscription.secret);
  const eventId = randomUUID();
  const body = JSON.stringify({ eventId, name: event.name, timestamp: event.timestamp, data: event.data, cursor: null });
  const headers = signedHeaders(eventId, String(Math.floor(Date.now() / 1000)), body, key, subscription.id);
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await postWebhook(subscription.callbackUrl, body, headers);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Webhook 投递失败');
}
