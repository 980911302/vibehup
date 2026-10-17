import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { postPinned, validateWebhookUrl } from './core/mcp-webhook-http.js';

const token = process.env.VIBEHUB_MCP_EVENT_RELAY_TOKEN ?? '';
const host = process.env.VIBEHUB_MCP_EVENT_RELAY_HOST ?? '127.0.0.1';
const port = Number(process.env.VIBEHUB_MCP_EVENT_RELAY_PORT ?? 3218);
const proxy = process.env.VIBEHUB_MCP_EVENT_RELAY_PROXY ?? '';
if (token.length < 32) throw new Error('中转令牌必须至少 32 字符');
const expectedAuth = Buffer.from(`Bearer ${token}`);
const allowedHeaders = [
  'content-type', 'webhook-id', 'webhook-timestamp', 'webhook-signature', 'x-mcp-subscription-id',
];

function authorized(value: string | undefined): boolean {
  const actual = Buffer.from(value ?? '');
  return actual.length === expectedAuth.length && timingSafeEqual(actual, expectedAuth);
}

async function readBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65_536) throw new Error('请求过大');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseForward(text: string) {
  const input = JSON.parse(text) as { url?: unknown; body?: unknown; headers?: unknown };
  if (typeof input.url !== 'string' || typeof input.body !== 'string' ||
      !input.headers || typeof input.headers !== 'object' || Array.isArray(input.headers)) {
    throw new Error('中转请求格式无效');
  }
  const url = validateWebhookUrl(input.url);
  if (url.hostname !== 'connectors.api.openai.com') throw new Error('仅允许 OpenAI 事件回调域名');
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers)) {
    const lower = name.toLowerCase();
    if (!allowedHeaders.includes(lower) || typeof value !== 'string' || /[\r\n]/.test(value)) {
      throw new Error('中转请求头无效');
    }
    headers[lower] = value;
  }
  if (allowedHeaders.some((name) => !headers[name])) throw new Error('缺少签名请求头');
  return { url: url.toString(), body: input.body, headers };
}

const server = http.createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json');
  response.setHeader('cache-control', 'no-store');
  if (!authorized(request.headers.authorization)) {
    response.writeHead(401).end('{"error":"未授权"}');
    request.resume();
    return;
  }
  if (request.method === 'GET' && request.url === '/health') {
    response.end('{"ok":true}');
    return;
  }
  if (request.method !== 'POST' || request.url !== '/forward') {
    response.writeHead(404).end('{"error":"未找到"}');
    request.resume();
    return;
  }
  let input: ReturnType<typeof parseForward>;
  try { input = parseForward(await readBody(request)); }
  catch {
    response.writeHead(400).end('{"error":"中转请求无效"}');
    return;
  }
  try {
    // Public DNS via authenticated HTTPS avoids polluted/fake-IP system DNS.
    // postPinned still validates the public IP and the target TLS certificate.
    const result = await postPinned(input.url, input.body, input.headers, true, proxy);
    response.end(result);
    console.info('MCP callback delivered');
  } catch (error) {
    // Never log callback URLs, signed payloads, authorization or signing headers.
    const message = error instanceof Error ? error.message : '未知错误';
    const status = /^Webhook 返回 HTTP (\d{3})$/.exec(message)?.[1];
    const safeMessage = status ? `upstream HTTP ${status}` : 'upstream network error';
    console.error(`MCP callback failed: ${safeMessage}`);
    response.writeHead(status ? Number(status) : 502).end('{"error":"回调投递失败"}');
  }
});
server.requestTimeout = 20_000;
server.headersTimeout = 10_000;
server.maxRequestsPerSocket = 100;
server.listen(port, host, () => console.info(`MCP event relay listening on ${host}:${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
