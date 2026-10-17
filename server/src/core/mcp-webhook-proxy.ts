import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

/** A dedicated local HTTP CONNECT hop; TLS still authenticates the original host. */
export function webhookProxyAgent(proxyString: string, servername: string, address: string): https.Agent {
  const proxy = new URL(proxyString);
  if (proxy.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(proxy.hostname) ||
      proxy.username || proxy.password) throw new Error('事件中转代理必须是本机 HTTP 代理');
  const authority = `${address.includes(':') ? `[${address}]` : address}:443`;
  const agent = new https.Agent();
  agent.createConnection = ((_options: unknown, callback: (error: Error | null, socket?: tls.TLSSocket) => void) => {
    let settled = false;
    const finish = (error: Error | null, socket?: tls.TLSSocket) => {
      if (settled) return;
      settled = true;
      callback(error, socket);
    };
    const connect = http.request(proxy, {
      method: 'CONNECT', path: authority, headers: { host: authority }, timeout: 5_000,
    });
    connect.once('connect', (response, socket, head) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        finish(new Error('本机代理连接失败'));
        return;
      }
      if (head.length) socket.unshift(head);
      const secure = tls.connect({ socket, servername, rejectUnauthorized: true });
      secure.setTimeout(8_000, () => secure.destroy(new Error('代理 TLS 连接超时')));
      secure.once('secureConnect', () => {
        secure.setTimeout(0);
        finish(null, secure);
      });
      secure.once('error', (error) => finish(error));
    });
    connect.once('timeout', () => connect.destroy(new Error('本机代理连接超时')));
    connect.once('error', (error) => finish(error));
    connect.end();
  }) as typeof agent.createConnection;
  return agent;
}
