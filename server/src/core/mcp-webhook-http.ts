import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { isIP } from 'node:net';
import { webhookProxyAgent } from './mcp-webhook-proxy.js';

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

export function validateWebhookUrl(urlString: string): URL {
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

  return url;
}

async function resolvePublicHttps(urlString: string, useDoh: boolean, proxy: string) {
  const url = validateWebhookUrl(urlString);
  const addresses = useDoh ? await resolveDoh(url.hostname, proxy) : await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('Webhook 回调地址必须解析到公网 IP');
  }
  return { url, addresses };
}

async function resolveDoh(hostname: string, proxy: string) {
  const endpoint = new URL('https://cloudflare-dns.com/dns-query');
  endpoint.search = new URLSearchParams({ name: hostname, type: 'A' }).toString();
  const text = await new Promise<string>((resolve, reject) => {
    const request = https.get(endpoint, {
      headers: { accept: 'application/dns-json' }, timeout: 4_000,
      agent: proxy ? webhookProxyAgent(proxy, endpoint.hostname, endpoint.hostname) : undefined,
    }, (response) => {
      let text = '';
      response.on('data', (chunk: Buffer) => {
        text += chunk.toString('utf8');
        if (text.length > 32_768) request.destroy(new Error('DNS 响应过大'));
      });
      response.on('error', reject);
      response.on('end', () => response.statusCode === 200 ? resolve(text) : reject(new Error('Webhook 公网 DNS 查询失败')));
    });
    request.once('timeout', () => request.destroy(new Error('DNS 请求超时')));
    request.once('error', reject);
  });
  const data = JSON.parse(text) as { Status?: number; Answer?: Array<{ type: number; data: string }> };
  if (data.Status !== 0) throw new Error('Webhook 公网 DNS 查询失败');
  return (data.Answer ?? []).filter((a) => a.type === 1).map((a) => ({ address: a.data, family: 4 }));
}

export async function postPinned(urlString: string, body: string, headers: Record<string, string>, useDoh = false, proxy = ''): Promise<string> {
  const { url, addresses } = await resolvePublicHttps(urlString, useDoh, proxy);
  const pinned = addresses[0]!;
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'POST',
      headers: { ...headers, 'content-length': Buffer.byteLength(body) },
      timeout: 8_000,
      agent: proxy ? webhookProxyAgent(proxy, url.hostname, pinned.address) : new https.Agent({
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
      response.on('error', reject);
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

