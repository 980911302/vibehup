import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { guarded } from './guard.js';
import { TOOL_SCOPES } from './tool-scopes.js';
import * as more from './tools-more.js';
import * as skills from './tools-skills.js';

/**
 * R80 新增 10 个工具：任务详情、四类删除、修改便签、技能四件套。
 * 从 server.ts 拆出以控制单文件长度；scope 一律取自 tool-scopes.ts。
 */

const PROJECT_SLUG_DESC = '项目 slug（Web 端「项目」页可复制）；多项目时必填，只有一个进行中项目时可省略';
const CONFIRM = '删除不可恢复：除非用户明确要求删除，否则先向用户确认。';
const READ = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

type Args<F extends (...a: never[]) => unknown> = Parameters<F>[1];

function registerTaskAndDataTools(server: McpServer): void {
  server.registerTool(
    'get_task_detail',
    {
      title: '任务详情',
      description:
        '读取单个任务：描述、标签、负责人、上次打回原因、附件，以及 allowed_next_statuses / next_step。描述默认截断到 500 字符，要改描述前带 full: true 取全文。',
      inputSchema: {
        task_id: z.string().describe('任务 ID'),
        full: z.boolean().optional().describe('返回完整描述（不截断）'),
      },
      annotations: READ,
    },
    guarded('get_task_detail', TOOL_SCOPES.get_task_detail, (ctx, a) => more.getTaskDetail(ctx, a as Args<typeof more.getTaskDetail>)),
  );

  server.registerTool(
    'delete_task',
    { title: '删除任务', description: `删除任务，任务上的附件转为项目通用附件。${CONFIRM}`, inputSchema: { task_id: z.string().describe('任务 ID') }, annotations: DESTRUCTIVE },
    guarded('delete_task', TOOL_SCOPES.delete_task, (ctx, a) => more.deleteTask(ctx, a as Args<typeof more.deleteTask>)),
  );

  server.registerTool(
    'delete_bug',
    {
      title: '删除缺陷',
      description: `删除缺陷及其评论流。重复单/误建单才删；不修、无法复现应走状态流转（resolved 写原因后 closed）而不是删除。${CONFIRM}`,
      inputSchema: { bug_id: z.string().describe('缺陷 ID') },
      annotations: DESTRUCTIVE,
    },
    guarded('delete_bug', TOOL_SCOPES.delete_bug, (ctx, a) => more.deleteBug(ctx, a as Args<typeof more.deleteBug>)),
  );

  server.registerTool(
    'update_note',
    {
      title: '修改便签',
      description: '修改随手记：content 整段替换（先用 list_notes 找到 note_id）、tags 整组替换、pinned 置顶开关，只改传入的字段。',
      inputSchema: {
        note_id: z.string().describe('便签 ID'),
        content: z.string().optional().describe('新内容（Markdown，整段替换）'),
        tags: z.array(z.string()).optional().describe('标签（整组替换）'),
        pinned: z.boolean().optional().describe('是否置顶'),
      },
      annotations: WRITE,
    },
    guarded('update_note', TOOL_SCOPES.update_note, (ctx, a) => more.updateNote(ctx, a as Args<typeof more.updateNote>)),
  );

  server.registerTool(
    'delete_note',
    { title: '删除便签', description: `删除随手记。${CONFIRM}`, inputSchema: { note_id: z.string().describe('便签 ID') }, annotations: DESTRUCTIVE },
    guarded('delete_note', TOOL_SCOPES.delete_note, (ctx, a) => more.deleteNote(ctx, a as Args<typeof more.deleteNote>)),
  );

  server.registerTool(
    'delete_attachment',
    { title: '删除附件', description: `删除附件（文件进回收站，按保留期清理）。${CONFIRM}`, inputSchema: { attachment_id: z.string().describe('附件 ID') }, annotations: DESTRUCTIVE },
    guarded('delete_attachment', TOOL_SCOPES.delete_attachment, (ctx, a) => more.deleteAttachment(ctx, a as Args<typeof more.deleteAttachment>)),
  );
}

function registerSkillTools(server: McpServer): void {
  const locator = {
    name: z.string().optional().describe('技能名（与 skill_id 二选一；项目内同名优先，其次通用）'),
    skill_id: z.string().optional().describe('技能 ID'),
    project_slug: z.string().optional().describe(PROJECT_SLUG_DESC),
  };

  server.registerTool(
    'list_skills',
    {
      title: '查看技能',
      description: '列出本项目和全团队通用的技能：名称、描述、范围、文件数（不含正文）。要用某个技能时再 download_skill。',
      inputSchema: { project_slug: z.string().optional().describe(PROJECT_SLUG_DESC), q: z.string().optional().describe('按名称/描述检索') },
      annotations: READ,
    },
    guarded('list_skills', TOOL_SCOPES.list_skills, (ctx, a) => skills.listSkills(ctx, a as Args<typeof skills.listSkills>)),
  );

  server.registerTool(
    'download_skill',
    {
      title: '下载技能',
      description:
        '取回技能全文：skill_md（SKILL.md）+ files（文本给 content，二进制给 content_base64）。按原目录结构写到 install_dir（.claude/skills/<name>/）即可使用。complete 为 false 时，标了 pending 的文件带 path 再调；单文件过大时按 next_offset 分段取。',
      inputSchema: {
        ...locator,
        path: z.string().optional().describe('只取某个附带文件（相对技能目录，如 scripts/run.sh）'),
        offset: z.number().int().min(0).optional().describe('分段读取的起始位置（上次返回的 next_offset）'),
      },
      annotations: READ,
    },
    guarded('download_skill', TOOL_SCOPES.download_skill, (ctx, a) => skills.downloadSkill(ctx, a as Args<typeof skills.downloadSkill>)),
  );

  server.registerTool(
    'upload_skill',
    {
      title: '上传技能',
      description:
        '把一个技能上传到团队：skill_md 是 SKILL.md 全文（开头 frontmatter 必须有 name 与 description，name 只能用小写字母、数字和连字符），files 是附带文件。默认挂到当前项目，scope: "global" 为全团队通用；同一范围内同名即覆盖（action=updated）。',
      inputSchema: {
        skill_md: z.string().describe('SKILL.md 全文'),
        files: z
          .array(z.object({ path: z.string(), content: z.string().optional(), content_base64: z.string().optional() }))
          .optional()
          .describe('附带文件：path 相对技能目录；文本用 content，二进制用 content_base64'),
        project_slug: z.string().optional().describe(PROJECT_SLUG_DESC),
        scope: z.enum(['project', 'global']).optional().describe('project（缺省，挂当前项目）或 global（全团队通用）'),
      },
      annotations: WRITE,
    },
    guarded('upload_skill', TOOL_SCOPES.upload_skill, (ctx, a) => skills.uploadSkill(ctx, a as Args<typeof skills.uploadSkill>)),
  );

  server.registerTool(
    'delete_skill',
    { title: '删除技能', description: `删除技能及其附带文件。${CONFIRM}`, inputSchema: locator, annotations: DESTRUCTIVE },
    guarded('delete_skill', TOOL_SCOPES.delete_skill, (ctx, a) => skills.deleteSkill(ctx, a as Args<typeof skills.deleteSkill>)),
  );
}

export function registerMoreTools(server: McpServer): void {
  registerTaskAndDataTools(server);
  registerSkillTools(server);
}
