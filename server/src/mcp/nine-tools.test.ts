import { beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { prisma } from '../core/prisma.js';
import { createApiKey, createUser, resetDb } from '../test-helpers.js';
import * as projectsService from '../services/projects.js';
import * as skillsService from '../services/skills.js';
import { TOOL_NAMES } from './server.js';
import { TOOL_SCOPES } from './tool-scopes.js';
import { guarded } from './guard.js';
import { loadKeyedContext, type McpContext } from './context.js';
import * as mcpTools from './tools.js';
import * as workTools from './tools-work.js';
import * as fileTools from './tools-files.js';
import * as skillTools from './tools-skills.js';

const EXPECTED_NINE = [
  'get_project_context',
  'search',
  'get_work_item',
  'create_work_item',
  'update_work_item',
  'read_attachment',
  'upload_attachment',
  'append_note',
  'get_skill',
] as const;

function adminCtx(overrides: Partial<McpContext> = {}): McpContext {
  return {
    mode: 'keyed',
    apiKeyId: 'key_r96',
    scopes: new Set(['admin']),
    actorLabel: 'Cursor(vhk_r96)',
    actorName: 'Cursor',
    human: null,
    key: null,
    ...overrides,
  };
}

beforeEach(async () => {
  await resetDb();
});

describe('MCP 9 工具精简契约（R96）', () => {
  it('TOOL_NAMES 与 TOOL_SCOPES 严格收敛为 9 个核心工具，不含任何 delete_* 或 purge_trash', () => {
    expect(TOOL_NAMES).toHaveLength(9);
    expect([...TOOL_NAMES].sort()).toEqual([...EXPECTED_NINE].sort());
    expect(Object.keys(TOOL_SCOPES).sort()).toEqual([...EXPECTED_NINE].sort());
  });

  it('get_project_context 一次返回 me + members（非 admin 隐藏邮箱）+ 项目工作项与技能清单', async () => {
    const owner = await createUser({ email: 'owner@t.com', name: '林深' });
    await createUser({ email: 'viewer@t.com', name: '只读观察员', role: 'viewer' });
    const proj = await projectsService.createProject({ name: '核心台', slug: 'core', description: '单项目工作区' });
    await skillsService.uploadSkill({
      projectId: proj.id,
      skillMd: '---\nname: deploy-check\ndescription: 发版前自检清单\n---\n\n# Check\n',
      files: [],
      source: 'web',
      uploadedBy: owner.user.id,
    });

    const ctx = adminCtx({
      scopes: new Set(['context:read', 'bug:write']),
      human: { id: owner.user.id, name: '林深', role: 'owner' },
      key: { id: 'k1', name: 'Cursor', prefix: 'vhk_live_abc' },
    });
    const res = await mcpTools.getProjectContext(ctx, { project_slug: 'core' });
    expect(res.me.human?.name).toBe('林深');
    expect(res.me.capabilities).toEqual(['bug:write', 'context:read']);
    expect(res.members).toHaveLength(2);
    expect('email' in res.members[0]).toBe(false);
    expect(res.members.find((m) => m.name === '只读观察员')?.writable).toBe(false);
    expect(res.skills).toEqual([{ name: 'deploy-check', description: '发版前自检清单', scope: 'project' }]);
    expect(res.memory.project.description).toBe('单项目工作区');
  });

  it('search 兼顾列表过滤（无 q）与关键词搜索（有 q + project_slug 物理隔离）', async () => {
    const p1 = await projectsService.createProject({ name: 'Alpha', slug: 'alpha' });
    const p2 = await projectsService.createProject({ name: 'Beta', slug: 'beta' });
    const ctx = adminCtx();

    await workTools.createWorkItem(ctx, { type: 'bug', project_slug: 'alpha', title: 'Alpha 支付超时', labels: ['pay'] });
    await workTools.createWorkItem(ctx, { type: 'task', project_slug: 'alpha', title: 'Alpha 补重试逻辑', status: 'doing', labels: ['pay'] });
    await workTools.createWorkItem(ctx, { type: 'bug', project_slug: 'beta', title: 'Beta 支付超时' });

    const listed = await mcpTools.search(ctx, { project_slug: 'alpha', type: 'task', status: 'doing', label: 'pay' });
    expect(listed.mode).toBe('list');
    expect(listed.tasks?.items).toHaveLength(1);
    expect(listed.tasks?.items[0].title).toBe('Alpha 补重试逻辑');

    const queried = await mcpTools.search(ctx, { q: '支付超时', project_slug: 'alpha' });
    expect(queried.mode).toBe('query');
    expect(queried.bugs).toHaveLength(1);
    expect(queried.bugs?.[0].project_id).toBe(p1.id);
    expect(p2.slug).toBe('beta');
  });

  it('create/get/update_work_item：合一支持状态机、证据、评论、转交及细粒度 scope 隔离', async () => {
    const owner = await createUser({ email: 'lead@t.com', name: '负责人' });
    const viewer = await createUser({ email: 'view@t.com', name: '只读', role: 'viewer' });
    await projectsService.createProject({ name: 'Work', slug: 'work' });

    const bugOnlyKey = await createApiKey({ scopes: ['context:read', 'bug:write'], createdBy: owner.user.id });
    const bugOnlyCtx = await loadKeyedContext(bugOnlyKey.key);

    // 只有 bug:write 不能建 task
    await expect(
      workTools.createWorkItem(bugOnlyCtx, { type: 'task', project_slug: 'work', title: '越权任务' }),
    ).rejects.toThrow(/task:write/);

    const created = await workTools.createWorkItem(bugOnlyCtx, {
      type: 'bug',
      project_slug: 'work',
      title: '按钮失灵',
      actual_result: 'a'.repeat(700),
    });
    expect(created.entity_type).toBe('bug');
    const bugId = created.bug!.id;

    // get_work_item 自动识别 bug_ 前缀，支持 full=true
    const brief = await workTools.getWorkItem(bugOnlyCtx, { id: bugId });
    expect(brief.entity_type).toBe('bug');
    expect((brief as { actual_result_truncated?: boolean }).actual_result_truncated).toBe(true);
    const full = await workTools.getWorkItem(bugOnlyCtx, { id: bugId, full: true });
    expect(((full as { actual_result?: string }).actual_result ?? '').length).toBe(700);

    // 转交只读成员被拒；合法转交 + 评论 + 状态流转一次完成
    await expect(
      workTools.updateWorkItem(bugOnlyCtx, { id: bugId, assignee_id: viewer.user.id, handoff_reason: '转给你' }),
    ).rejects.toThrow(/只读成员/);

    const updated = await workTools.updateWorkItem(bugOnlyCtx, {
      id: bugId,
      status: 'in_progress',
      comment: '已复现，开始修复并同步负责人',
      assignee_id: owner.user.id,
      handoff_reason: '由林深主修',
    });
    expect(updated.bug?.status).toBe('in_progress');
    expect(updated.assignee).toEqual({ id: owner.user.id, name: '负责人' });
    const comments = await prisma.bugComment.findMany({ where: { bugId } });
    expect(comments.some((c) => c.content.includes('已复现'))).toBe(true);
    expect(comments.some((c) => c.content.includes('由林深主修'))).toBe(true);
  });

  it('upload_attachment（直传文本 / 签发 curl 链接二合一）+ read_attachment（图片视觉块 / 文本 grep 自动分流）', async () => {
    await projectsService.createProject({ name: 'Files', slug: 'files' });
    const ctx = adminCtx();

    // 1) 传 content → 直接落盘为文本附件，read_attachment 自动走文本 grep
    const txtUp = await fileTools.uploadAttachment(ctx, {
      file_name: 'server.log',
      content: 'INFO boot\nERROR timeout at db.connect\nINFO done',
    });
    expect(txtUp.mode).toBe('direct');
    const txtRead = (await fileTools.readAttachment(ctx, {
      attachment_id: txtUp.attachment!.id,
      grep_keyword: 'ERROR',
    })) as { total_lines: number; content: string };
    expect(txtRead.total_lines).toBe(1);
    expect(txtRead.content).toContain('ERROR timeout');

    // 2) 不传 content/data_base64 → 自动签发一次性 curl -T 链接
    const urlGrant = await fileTools.uploadAttachment(ctx, { file_name: 'screen.png' });
    expect(urlGrant.mode).toBe('upload_url');
    expect(urlGrant.curl).toContain('curl -sS -T');

    // 3) 图片附件 → read_attachment 自动返回 MCP image 内容块
    const pngBytes = await sharp({ create: { width: 1600, height: 800, channels: 3, background: { r: 20, g: 40, b: 80 } } }).png().toBuffer();
    const imgUp = await fileTools.uploadAttachment(ctx, {
      file_name: 'ui.png',
      file_type: 'image/png',
      data_base64: pngBytes.toString('base64'),
    });
    const handler = guarded('read_attachment', TOOL_SCOPES.read_attachment, (c, a) =>
      fileTools.readAttachment(c, a as { attachment_id: string }),
    );
    const res = await handler({ attachment_id: imgUp.attachment!.id });
    expect(res.isError).toBeFalsy();
    const imgBlock = res.content.find((b) => b.type === 'image') as { data: string; mimeType: string } | undefined;
    expect(imgBlock?.mimeType).toBe('image/png');
    const meta = await sharp(Buffer.from(imgBlock!.data, 'base64')).metadata();
    expect(meta.width).toBe(1080);
  });

  it('append_note 单项目自动归属当前项目；get_skill 读取技能全文', async () => {
    const p = await projectsService.createProject({ name: 'Solo', slug: 'solo' });
    const ctx = adminCtx();

    const note = await mcpTools.appendNote(ctx, { content: '排查草稿', tags: ['debug'] });
    expect(note.project_id).toBe(p.id);

    await skillsService.uploadSkill({
      projectId: null,
      skillMd: '---\nname: global-style\ndescription: 通用代码风格\n---\n\n遵守 <=300 行\n',
      files: [{ path: 'rules.txt', data: Buffer.from('no-bare-hex') }],
      source: 'web',
      uploadedBy: null,
    });
    const skill = await skillTools.getSkill(ctx, { name: 'global-style' });
    expect(skill.skill_md).toContain('遵守 <=300 行');
    expect(skill.files).toEqual([{ path: 'rules.txt', size: 11, is_text: true, content: 'no-bare-hex' }]);
  });
});
