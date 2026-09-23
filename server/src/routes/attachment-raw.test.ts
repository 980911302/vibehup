import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Buffer } from 'node:buffer';
import { buildServer } from '../index.js';
import { prisma } from '../core/prisma.js';
import { uploadFromBuffer } from '../services/attachments.js';
import { resetDb, authHeaders } from '../test-helpers.js';

/**
 * R76 复现：Web 端 <img src={public_url}> 带不了 Authorization 头，
 * 而 /raw 挂在登录守卫下 → 看板缩略图、详情大图、文件灯箱全部 401。
 * 修复契约：public_url 为签名链接（无需令牌可取回），原文件下发带用户内容安全头。
 */

let app: FastifyInstance;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

beforeEach(async () => {
  await resetDb();
  app = await buildServer();
  await app.ready();
});

async function upload(headers: Record<string, string>, file: { name: string; type: string; body: Buffer }) {
  const project = (
    await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { name: '附件访问' } })
  ).json();
  const boundary = '----TB' + Math.random().toString(16).slice(2);
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="project_id"\r\n\r\n${project.id}\r\n`),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
    ),
    file.body,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({
    method: 'POST',
    url: '/api/upload',
    headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload,
  });
  expect(res.statusCode).toBe(201);
  return res.json().attachments[0] as { id: string; public_url: string };
}

describe('附件原文件访问（<img> 无令牌场景）', () => {
  it('public_url 不带 Authorization 头即可取回原图', async () => {
    const headers = await authHeaders(app, 'img@t.com');
    const att = await upload(headers, { name: 'shot.png', type: 'image/png', body: PNG });

    const res = await app.inject({ method: 'GET', url: att.public_url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.rawPayload.equals(PNG)).toBe(true);
  });

  it('既无签名也无令牌仍然 401', async () => {
    const headers = await authHeaders(app, 'img@t.com');
    const att = await upload(headers, { name: 'shot.png', type: 'image/png', body: PNG });

    const res = await app.inject({ method: 'GET', url: `/api/attachments/${att.id}/raw` });
    expect(res.statusCode).toBe(401);
  });

  it('篡改签名、拿 A 的签名取 B 都是 401', async () => {
    const headers = await authHeaders(app, 'img@t.com');
    const a = await upload(headers, { name: 'a.png', type: 'image/png', body: PNG });
    const b = await upload(headers, { name: 'b.png', type: 'image/png', body: PNG });

    const tampered = await app.inject({ method: 'GET', url: `${a.public_url}0` });
    expect(tampered.statusCode).toBe(401);

    const query = a.public_url.split('?')[1];
    const crossed = await app.inject({ method: 'GET', url: `/api/attachments/${b.id}/raw?${query}` });
    expect(crossed.statusCode).toBe(401);
  });

  it('带 Bearer 令牌访问仍可用（API 客户端兼容）', async () => {
    const headers = await authHeaders(app, 'img@t.com');
    const att = await upload(headers, { name: 'shot.png', type: 'image/png', body: PNG });

    const res = await app.inject({ method: 'GET', url: `/api/attachments/${att.id}/raw`, headers });
    expect(res.statusCode).toBe(200);
  });
});

describe('附件 ID 一致性（落盘 ID ≠ 记录 ID 的历史 bug：public_url 指向不存在的附件）', () => {
  it('multipart 与 base64 两个上传入口：public_url 指向记录自身 ID', async () => {
    const headers = await authHeaders(app, 'img@t.com');
    const multi = await upload(headers, { name: 'shot.png', type: 'image/png', body: PNG });
    expect(multi.public_url.startsWith(`/api/attachments/${multi.id}/raw?`)).toBe(true);

    const b64 = (
      await app.inject({
        method: 'POST',
        url: '/api/upload/base64',
        headers,
        payload: { project_id: (await prisma.project.findFirstOrThrow()).id, file_name: 'c.png', file_type: 'image/png', data_base64: PNG.toString('base64') },
      })
    ).json();
    expect(b64.public_url.startsWith(`/api/attachments/${b64.id}/raw?`)).toBe(true);
  });

  it('MCP 上传入口（uploadFromBuffer）落库的 publicUrl 与记录 ID 一致', async () => {
    const project = await prisma.project.create({ data: { id: 'prj_mcp', name: 'MCP', slug: 'mcp-1' } });
    const row = await uploadFromBuffer({ projectId: project.id, fileName: 'log.txt', fileType: 'text/plain', buffer: Buffer.from('x') });
    expect(row.publicUrl).toBe(`/api/attachments/${row.id}/raw`);
  });

  it('存量数据：库里 public_url 指向错误 ID 的老附件，序列化后指向真实 ID 且可取回', async () => {
    const headers = await authHeaders(app, 'img@t.com');
    const att = await upload(headers, { name: 'old.png', type: 'image/png', body: PNG });
    await prisma.attachment.update({ where: { id: att.id }, data: { publicUrl: '/api/attachments/att_wrongid/raw' } });

    const meta = (await app.inject({ method: 'GET', url: `/api/attachments/${att.id}`, headers })).json();
    expect(meta.public_url.startsWith(`/api/attachments/${att.id}/raw?`)).toBe(true);
    const res = await app.inject({ method: 'GET', url: meta.public_url });
    expect(res.statusCode).toBe(200);
  });
});

describe('原文件下发安全头（用户上传内容不得在应用同源执行）', () => {
  it('图片 inline 展示，并带 nosniff 与 CSP sandbox', async () => {
    const headers = await authHeaders(app, 'img@t.com');
    const att = await upload(headers, { name: 'shot.png', type: 'image/png', body: PNG });

    const res = await app.inject({ method: 'GET', url: att.public_url });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(String(res.headers['content-security-policy'])).toContain('sandbox');
    expect(String(res.headers['content-disposition'])).toMatch(/^inline;/);
  });

  it('HTML / SVG 等可执行类型强制下载（attachment），中文文件名用 filename*', async () => {
    const headers = await authHeaders(app, 'img@t.com');
    const html = await upload(headers, {
      name: '复现页.html',
      type: 'text/html',
      body: Buffer.from('<script>alert(localStorage.vibehub_token)</script>'),
    });
    const svg = await upload(headers, {
      name: 'x.svg',
      type: 'image/svg+xml',
      body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    });

    const h = await app.inject({ method: 'GET', url: html.public_url });
    expect(h.statusCode).toBe(200);
    expect(String(h.headers['content-disposition'])).toMatch(/^attachment;/);
    expect(String(h.headers['content-disposition'])).toContain("filename*=UTF-8''");
    expect(String(h.headers['content-security-policy'])).toContain('sandbox');

    const s = await app.inject({ method: 'GET', url: svg.public_url });
    expect(String(s.headers['content-disposition'])).toMatch(/^attachment;/);
  });
});
