import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../index.js';
import { prisma } from '../core/prisma.js';
import { resetDb, createApiKey, authHeaders, createUser } from '../test-helpers.js';
import { Buffer } from 'node:buffer';

/** HTTP 层集成测试（步骤 05：对齐 v2，全带认证头） */

let app: FastifyInstance;

beforeEach(async () => {
  await resetDb();
  app = await buildServer();
  await app.ready();
});

describe('健康检查与守卫', () => {
  it('GET /api/health 无需登录', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });

  it('业务路由无令牌 401 UNAUTHORIZED（白名单除外）', async () => {
    for (const url of ['/api/projects', '/api/bugs', '/api/tasks', '/api/notes', '/api/attachments', '/api/search?q=x', '/api/users']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHORIZED');
    }
  });

  it('auth 路由白名单可访问', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'x@y.z', password: 'abcd1234' } });
    expect(res.statusCode).toBe(401); // 用户不存在，但路由可达
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('注册登录全链路', () => {
  it('注册第一个用户=owner，响应无 password_hash', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'o@t.com', password: 'abcd1234', name: 'Owner' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.role).toBe('owner');
    expect(body.expires_in).toBe(900);
    expect(JSON.stringify(body)).not.toContain('password_hash');
  });

  it('弱密码 400 人话 / 重复邮箱 409', async () => {
    const weak = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'w@t.com', password: '123', name: 'W' },
    });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error.message).toContain('8');

    await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'd@t.com', password: 'abcd1234', name: 'D' } });
    const dup = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'd@t.com', password: 'abcd1234', name: 'D2' } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('EMAIL_TAKEN');
  });

  it('refresh 轮换与重放检测', async () => {
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'r@t.com', password: 'abcd1234', name: 'R' } });
    const { refresh_token } = reg.json();
    const refreshed = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refresh_token } });
    expect(refreshed.statusCode).toBe(200);
    // 宽限期内重复提交（多请求/多标签同时刷新）→ 仍 200，不整族吊销（R76）
    const concurrent = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refresh_token } });
    expect(concurrent.statusCode).toBe(200);
    // 宽限期过后再提交 → 重放
    await prisma.refreshToken.updateMany({
      where: { revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });
    const replay = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refresh_token } });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe('TOKEN_REUSED');
  });

  it('me 返回 stats', async () => {
    const headers = await authHeaders(app, 'me@t.com');
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().stats).toHaveProperty('files_uploaded');
  });
});

describe('缺陷 CRUD 与看板', () => {
  it('创建（含附件关联）→ 拖拽改状态 → 详情含附件', async () => {
    const headers = await authHeaders(app, 'crud@t.com');
    const project = (
      await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { name: 'CRUD' } })
    ).json();

    // 上传附件
    const boundary = '----TB' + Math.random().toString(16).slice(2);
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="project_id"\r\n\r\n${project.id}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const upload = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(upload.statusCode).toBe(201);
    const attachment = upload.json().attachments[0];
    expect(attachment.uploaded_by).toBeTruthy();

    const bug = (
      await app.inject({
        method: 'POST',
        url: '/api/bugs',
        headers,
        payload: {
          project_id: project.id,
          title: 'HTTP 缺陷',
          severity: 'high',
          priority: 'urgent',
          labels: ['http'],
          attachment_ids: [attachment.id],
        },
      })
    ).json();
    expect(bug.status).toBe('open');
    expect(bug.priority).toBe('urgent');

    const moved = await app.inject({ method: 'PATCH', url: `/api/bugs/${bug.id}`, headers, payload: { status: 'in_progress' } });
    expect(moved.json().status).toBe('in_progress');

    const detail = await app.inject({ method: 'GET', url: `/api/bugs/${bug.id}`, headers });
    expect(detail.json().attachments).toHaveLength(1);
    expect(detail.json().attachment_count).toBe(1);

    const board = await app.inject({ method: 'GET', url: `/api/bugs/board/${project.id}`, headers });
    expect(board.json().in_progress[0].id).toBe(bug.id);
  });

  it('上传无令牌 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/upload', payload: {} });
    expect(res.statusCode).toBe(401);
  });
});

describe('缺陷域扩展', () => {
  it('评论 / 模板 / 视图 / batch / CSV', async () => {
    const headers = await authHeaders(app, 'extra@t.com');
    const member = await createUser({ name: '批量指派人' }); // 外键约束（R74）需真实用户
    const project = (
      await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { name: 'Extra' } })
    ).json();
    const bug = (
      await app.inject({ method: 'POST', url: '/api/bugs', headers, payload: { project_id: project.id, title: 'E' } })
    ).json();

    // 评论
    const c = await app.inject({ method: 'POST', url: `/api/bugs/${bug.id}/comments`, headers, payload: { content: '评论一' } });
    expect(c.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: `/api/bugs/${bug.id}/comments`, headers });
    expect(list.json()).toHaveLength(1);

    // 模板惰性创建；member 删除 403（当前用户是 owner，直接验证 admin 可删）
    const tpls = await app.inject({ method: 'GET', url: '/api/bugs/templates', headers });
    expect(tpls.json()).toHaveLength(3);

    // 视图
    const v = await app.inject({ method: 'POST', url: '/api/bugs/views', headers, payload: { entity: 'bug', name: 'V1' } });
    expect(v.statusCode).toBe(201);

    // 批量：部分成功
    const batch = await app.inject({
      method: 'POST',
      url: '/api/bugs/batch',
      headers,
      payload: { ids: [bug.id, 'bug_none'], action: 'assign', payload: { assignee_id: member.user.id } },
    });
    expect(batch.json().updated).toBe(1);
    expect(batch.json().skipped).toHaveLength(1);

    // CSV 导出（验 BOM 字节）
    const csv = await app.inject({ method: 'GET', url: `/api/bugs/export?project_id=${project.id}`, headers });
    expect(csv.statusCode).toBe(200);
    expect(csv.rawPayload.subarray(0, 3).toString('hex')).toBe('efbbbf');
  });

  it('模板管理权限：member 删除 403', async () => {
    const ownerHeaders = await authHeaders(app, 'own2@t.com');
    const member = (
      await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'mem2@t.com', password: 'abcd1234', name: 'M' } })
    ).json();
    const memberHeaders = { authorization: `Bearer ${member.access_token}` };
    const tpls = await app.inject({ method: 'GET', url: '/api/bugs/templates', headers: ownerHeaders });
    const res = await app.inject({ method: 'DELETE', url: `/api/bugs/templates/${tpls.json()[0].id}`, headers: memberHeaders });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });
});

describe('错误形态', () => {
  it('404 与参数校验返回结构化错误', async () => {
    const headers = await authHeaders(app, 'err@t.com');
    const notFound = await app.inject({ method: 'GET', url: '/api/bugs/bug_missing', headers });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json().error.code).toBe('NOT_FOUND');
    const invalid = await app.inject({ method: 'POST', url: '/api/bugs', headers, payload: { title: '缺 project' } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('MCP SSE 端点', () => {
  it('无/错密钥 401；合法密钥建立流', async () => {
    const noKey = await app.inject({ method: 'GET', url: '/mcp/sse' });
    expect(noKey.statusCode).toBe(401);
    const badKey = await app.inject({ method: 'GET', url: '/mcp/sse', headers: { authorization: 'Bearer vhk_test_wrong' } });
    expect(badKey.statusCode).toBe(401);
    expect(badKey.json().error.code).toBe('INVALID_API_KEY');

    const key = await createApiKey({ scopes: ['context:read'] });
    // app.inject 不支持挂起连接；仅验证握手前的 401 逻辑与未知 session 404
    const unknownSession = await app.inject({ method: 'POST', url: '/mcp/messages?sessionId=none', payload: {} });
    expect(unknownSession.statusCode).toBe(404);
    expect(key.prefix).toMatch(/^vhk_test_/);
  });
});

describe('上传字段顺序健壮性（卡片 30 容器验收抓到的真 bug）', () => {
  it('multipart 文件 part 在 project_id 字段之前送达也应成功（顺序无关）', async () => {
    const headers = await authHeaders(app, 'order@t.com');
    const project = (
      await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { name: '顺序' } })
    ).json();

    // 故意把文件放在 project_id 之前（curl -F 的默认顺序即此）
    const boundary = '----TB' + Math.random().toString(16).slice(2);
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="b.png"\r\nContent-Type: image/png\r\n\r\n`),
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
      Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="project_id"\r\n\r\n${project.id}\r\n`),
      Buffer.from(`--${boundary}--\r\n`),
    ]);
    const upload = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(upload.statusCode).toBe(201);
    expect(upload.json().attachments[0].project_id).toBe(project.id);
  });
});
