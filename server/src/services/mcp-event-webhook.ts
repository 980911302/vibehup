import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { isIP } from 'node:net';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export interface WebhookSubscription {
  id: string;
  callbackUrl: string;
  secret: string;
}

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168) ) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith('::ffff:')) return isPublicAddress(normalized.slice(7));
    return !(
      normalized === '::' || normalized === '::1' ||
      normalized.startsWith('fc') || normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized) || normalized.startsWith('ff')
    );
  }
  return false;
}

async function resolvePublicHttps(urlString: string): Promise<{ url: URL; addresses: Array<{ address: string; family: number }> }> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error('Webhook 回调地址格式无效');
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('Webhook 回调地址必须是 HTTPS，且不能包含账号或非标准端口');
  }
  if (isIP(url.hostname)) throw new Error('Webhook 回调地址不能使用 IP 地址');

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('Webhook 回调地址必须解析到公网 IP');
  }
  return { url, addresses };
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

async function postPinned(urlString: string, body: string, headers: Record<string, string>): Promise<string> {
  const { url, addresses } = await resolvePublicHttps(urlString);
  const pinned = addresses[0]!;
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'POST',
      headers: { ...headers, 'content-length': Buffer.byteLength(body) },
      timeout: 8_000,
      agent: new https.Agent({
        lookup: ((_hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
          // https.Agent may request all addresses; return the same pinned result in either callback form.
          if (options && typeof options === 'object' && 'all' in options && options.all) {
            callback(null, [pinned]);
          } else {
            callback(null, pinned.address, pinned.family);
          }
        }) as never,
      }),
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size <= 16_384) chunks.push(chunk);
        else request.destroy(new Error('Webhook 响应过大'));
      });
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
          reject(new Error(`Webhook 返回 HTTP ${response.statusCode ?? 500}`));
          return;
        }
        resolve(text);
      });
    });
    request.on('timeout', () => request.destroy(new Error('Webhook 请求超时')));
    request.on('error', reject);
    request.end(body);
  });
}

export async function verifyWebhookCallback(subscription: WebhookSubscription): Promise<void> {
  const key = signingSecret(subscription.secret);
  const id = `msg_verification_${randomUUID()}`;
  const challenge = randomUUID();
  const body = JSON.stringify({ type: 'verification', challenge });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const response = await postPinned(
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
      await postPinned(subscription.callbackUrl, body, headers);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Webhook 投递失败');
}
