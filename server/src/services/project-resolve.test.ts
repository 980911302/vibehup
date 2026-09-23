import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../core/prisma.js';
import { resetDb } from '../test-helpers.js';
import * as projectsService from './projects.js';
import * as ext from '../mcp/tools-extended.js';
import type { McpContext } from '../mcp/context.js';

/**
 * MCP 未指定 project_slug 时的项目解析（R76）。
 * 旧逻辑按「MCP 服务进程自己的」cwd 前缀匹配 slug，匹配不到就静默回落到最近更新的项目——
 * 容器/SSE 部署下 cwd 是 /app，stdio 按 README 配置 cwd 是 vibehub/server，都不是 IDE 的工作区，
 * AI 不带 slug 调写工具时数据会悄悄写进别的项目。
 */

const ctx: McpContext = { mode: 'local', apiKeyId: null, scopes: new Set(['bug:write']), actorLabel: 'local' };

beforeEach(async () => {
  await resetDb();
});

describe('resolveProject(未指定)', () => {
  it('只有一个进行中的项目：自动使用它', async () => {
    const only = await projectsService.createProject({ name: '唯一项目' });
    expect((await projectsService.resolveProject(undefined)).id).toBe(only.id);
  });

  it('多个项目：报错并列出可选 slug，不再静默回落到最近更新的项目', async () => {
    const a = await projectsService.createProject({ name: '用户中心' });
    const b = await projectsService.createProject({ name: '支付网关' });

    const err = await projectsService.resolveProject(undefined).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('project_slug');
    expect((err as Error).message).toContain(a.slug);
    expect((err as Error).message).toContain(b.slug);
  });

  it('不按 MCP 服务进程的工作目录猜项目', async () => {
    // 测试进程 cwd = server/，旧逻辑会用 "server" 前缀命中下面这个项目
    await projectsService.createProject({ name: 'server' });
    await projectsService.createProject({ name: '另一个项目' });

    await expect(projectsService.resolveProject(undefined)).rejects.toThrow('project_slug');
  });

  it('已归档项目不参与自动选择', async () => {
    const active = await projectsService.createProject({ name: '进行中' });
    const archived = await projectsService.createProject({ name: '已归档' });
    await prisma.project.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });

    expect((await projectsService.resolveProject(undefined)).id).toBe(active.id);
  });
});

describe('MCP 写工具不带 project_slug', () => {
  it('多项目时 create_bug 报错且不落任何数据', async () => {
    await projectsService.createProject({ name: '用户中心' });
    await projectsService.createProject({ name: '支付网关' });

    await expect(ext.createBug(ctx, { title: 'AI 自动建单' })).rejects.toThrow('project_slug');
    expect(await prisma.bug.count()).toBe(0);
  });
});
