import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { z as z4 } from 'zod/v4';
import { AppError } from '../core/errors.js';
import { BUG_STATUSES } from '../services/bug-flow.js';
import { TASK_STATUSES } from '../services/tasks.js';
import { refreshKeyedContext, resolveMcpContext } from './context.js';
import { mcpStore } from './context-store.js';
import { MCP_EVENT_METHODS, MCP_EVENT_PROTOCOL_VERSION, handleMcpEventMethod } from './events.js';
import { guarded } from './guard.js';
import { TOOL_SCOPES } from './tool-scopes.js';
import * as tools from './tools.js';
import * as fileTools from './tools-files.js';
import * as skillTools from './tools-skills.js';
import * as workTools from './tools-work.js';
import { SERVER_INSTRUCTIONS } from './workflow.js';

/**
 * VibeHub MCP Server（R96 精简高内聚版：30 → 9 工具）。
 * stdio（本地信任）与 SSE / Streamable HTTP（容器/远端部署）共用本工厂；
 * 所有工具经 guarded() 包装：scope 校验 → 执行 → Token 经济学校形 → 打点。
 */

export const TOOL_NAMES = [
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

const ALL_WORK_STATUSES = [...new Set([...BUG_STATUSES, ...TASK_STATUSES])] as [string, ...string[]];
const PROJECT_SLUG_DESC = '项目 slug；多项目时必填，只有一个进行中项目时可省略';
const READ_ANNOT = { readOnlyHint: true, openWorldHint: false };
const WRITE_ANNOT = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

const EVIDENCE_SCHEMA = z
  .object({
    commit: z.string().optional().describe('修复提交 hash'),
    pr_url: z.string().optional().describe('PR / MR 链接'),
    tests: z.string().optional().describe('测试命令与结果（如 vitest 373 passed）'),
    changed_files: z.array(z.string()).optional().describe('改动文件路径'),
    screenshots: z.array(z.string()).optional().describe('附件 ID 列表（先用 upload_attachment 上传）'),
    notes: z.string().optional().describe('一句话交付说明'),
    no_code_reason: z.string().optional().describe('非代码交付原因；与 commit/PR/tests/截图至少给一项'),
  })
  .optional()
  .describe('交付证据包；标记 resolved/review 时尽量提供，缺证据无法直接验收通过');

if (!(SUPPORTED_PROTOCOL_VERSIONS as string[]).includes(MCP_EVENT_PROTOCOL_VERSION)) {
  (SUPPORTED_PROTOCOL_VERSIONS as string[]).push(MCP_EVENT_PROTOCOL_VERSION);
}

type Args<F extends (...a: never[]) => unknown> = Parameters<F>[1];

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'vibehub', version: '0.2.0' },
    { instructions: SERVER_INSTRUCTIONS, capabilities: { events: {} } as never },
  );

  for (const method of MCP_EVENT_METHODS) {
    server.server.assertCanSetRequestHandler(method);
    server.server.setRequestHandler(
      z4.object({ method: z4.literal(method), params: z4.record(z4.string(), z4.unknown()).optional() }).passthrough(),
      async (request) => {
        const initial = mcpStore.get() ?? (await resolveMcpContext());
        const ctx = await refreshKeyedContext(initial);
        return handleMcpEventMethod(method, request.params ?? {}, ctx) as Promise<never>;
      },
    );
  }

  server.registerTool(
    'get_project_context',
    {
      title: '获取项目全景上下文',
      description:
        '开工冷启动必调：一次返回当前身份（me）、可转交成员（members）、项目记忆（memory）、待处理/待验证/验证中/卡住的缺陷与任务、流转提醒（reminders）以及可用技能目录（skills）。多项目时必须传 project_slug。',
      inputSchema: { project_slug: z.string().optional().describe(PROJECT_SLUG_DESC) },
      annotations: READ_ANNOT,
    },
    guarded('get_project_context', TOOL_SCOPES.get_project_context, (ctx, a) => tools.getProjectContext(ctx, a)),
  );

  server.registerTool(
    'search',
    {
      title: '检索与列工作项',
      description:
        '列表与搜索二合一：传 q 做关键词/拼音/语义检索；不传 q 则按项目分页列出缺陷、任务或便签（支持 type / status / label 过滤）。建卡前先传 q 查重。',
      inputSchema: {
        q: z.string().optional().describe('关键词（选填；不传则按条件列项目内条目）'),
        project_slug: z.string().optional().describe(PROJECT_SLUG_DESC),
        type: z.enum(['all', 'bug', 'task', 'note']).optional().describe('限定实体类型，默认 all'),
        status: z.enum(ALL_WORK_STATUSES).optional().describe('按缺陷或任务状态过滤'),
        label: z.string().optional().describe('按标签过滤'),
        page: z.number().int().min(1).optional().default(1),
        limit: z.number().int().min(1).max(100).optional().default(20),
      },
      annotations: READ_ANNOT,
    },
    guarded('search', TOOL_SCOPES.search, (ctx, a) => tools.search(ctx, a)),
  );

  server.registerTool(
    'get_work_item',
    {
      title: '工作项详情',
      description:
        '读取单个缺陷（bug_）或任务（tsk_）详情：复现步骤/描述、标签、负责人、交付证据、附件清单及 allowed_next_statuses / next_step。长文本默认 500 字截断，需全文传 full: true。',
      inputSchema: {
        id: z.string().describe('缺陷 ID（bug_...）或任务 ID（tsk_...）'),
        type: z.enum(['bug', 'task']).optional().describe('显式类型（默认按 ID 前缀自动识别）'),
        full: z.boolean().optional().describe('返回不截断的完整长文本'),
      },
      annotations: READ_ANNOT,
    },
    guarded('get_work_item', TOOL_SCOPES.get_work_item, (ctx, a) => workTools.getWorkItem(ctx, a)),
  );

  server.registerTool(
    'create_work_item',
    {
      title: '新建缺陷或任务',
      description:
        '创建缺陷（type="bug"）或任务（type="task"），可关联已上传的 attachment_ids 并指定标签/负责人。建前请先用 search 查重。',
      inputSchema: {
        type: z.enum(['bug', 'task']).describe('bug（缺陷）或 task（任务）'),
        project_slug: z.string().optional().describe(PROJECT_SLUG_DESC),
        title: z.string().describe('标题'),
        description: z.string().optional().describe('任务描述（Markdown）；建 bug 且未传 steps_to_reproduce 时作复现说明'),
        priority: z.enum(['low', 'medium', 'high']).optional().describe('优先级'),
        severity: z.enum(['low', 'normal', 'high', 'critical']).optional().describe('仅 bug：严重度'),
        status: z.enum(['todo', 'doing']).optional().describe('仅 task：初始状态，默认 todo'),
        steps_to_reproduce: z.string().optional().describe('仅 bug：复现步骤'),
        expected_result: z.string().optional().describe('仅 bug：期望结果'),
        actual_result: z.string().optional().describe('仅 bug：实际结果'),
        labels: z.array(z.string()).optional().describe('标签列表'),
        assignee_id: z.string().optional().describe('负责人 ID（取自 get_project_context.members 中 writable=true 的成员）'),
        attachment_ids: z.array(z.string()).optional().describe('关联附件 ID 列表'),
      },
      annotations: WRITE_ANNOT,
    },
    guarded('create_work_item', TOOL_SCOPES.create_work_item, (ctx, a) => workTools.createWorkItem(ctx, a)),
  );

  server.registerTool(
    'update_work_item',
    {
      title: '更新/流转/评论/转交工作项',
      description:
        '缺陷与任务写操作四合一：① 逐级流转 status（禁止跳级：bug 为 open→in_progress→resolved→verifying→verified，不修走 closed 必写 resolution_notes；task 为 todo→doing→review→verifying→done，另可 cancelled；回流/打回必写 reopen_reason）；② 填交付证据 evidence / commit_hash；③ 给缺陷追加 AI 评论 comment；④ 转交负责人 assignee_id（必填 handoff_reason 或 comment）。',
      inputSchema: {
        id: z.string().describe('缺陷 ID（bug_...）或任务 ID（tsk_...）'),
        type: z.enum(['bug', 'task']).optional().describe('显式类型（默认自动识别）'),
        status: z.enum(ALL_WORK_STATUSES).optional().describe('目标下一步状态（见 get_work_item 的 allowed_next_statuses）'),
        resolution_notes: z.string().optional().describe('bug 标 resolved/verified/closed 时写根因、验证方式或不修原因'),
        commit_hash: z.string().optional().describe('修复 git commit hash'),
        reopen_reason: z.string().optional().describe('重开缺陷或打回任务时必填原因'),
        evidence: EVIDENCE_SCHEMA,
        comment: z.string().optional().describe('追加到缺陷活动流的 AI 评论'),
        assignee_id: z.string().optional().describe('转交目标成员 ID（不可为 viewer）'),
        handoff_reason: z.string().optional().describe('转交原因（最多 500 字）'),
        title: z.string().optional().describe('修改标题'),
        description: z.string().optional().describe('仅 task：整段替换描述（改前先 get_work_item(full: true)）'),
        priority: z.enum(['low', 'medium', 'high']).optional(),
        severity: z.enum(['low', 'normal', 'high', 'critical']).optional(),
        labels: z.array(z.string()).optional().describe('整组替换标签'),
      },
      annotations: WRITE_ANNOT,
    },
    guarded('update_work_item', TOOL_SCOPES.update_work_item, (ctx, a) => workTools.updateWorkItem(ctx, a)),
  );

  server.registerTool(
    'read_attachment',
    {
      title: '读取附件（自动识图与分片读文本）',
      description:
        '读取截图或日志附件：图片自动降采样（默认最大边 1080）并以多模态图片块直接呈现给模型；日志/代码支持行号分片与 grep_keyword 过滤。',
      inputSchema: {
        attachment_id: z.string().describe('附件 ID'),
        offset_line: z.number().int().min(1).optional().default(1).describe('文本附件：起始行号'),
        limit_lines: z.number().int().min(1).max(2000).optional().default(200).describe('文本附件：最大返回行数'),
        grep_keyword: z.string().optional().describe('文本附件：仅返回包含该词的行'),
        target_max_dimension: z.number().int().min(64).max(4096).optional().default(1080).describe('图片附件：降采样最大边'),
        return_mode: z.enum(['image', 'path', 'base64']).optional().default('image').describe('图片返回模式，默认 image'),
      },
      annotations: READ_ANNOT,
    },
    guarded('read_attachment', TOOL_SCOPES.read_attachment, (ctx, a) => fileTools.readAttachment(ctx, a)),
  );

  server.registerTool(
    'upload_attachment',
    {
      title: '上传附件（直传短文本或签发本地 curl 链接）',
      description:
        '上传二合一：① 小段文本（堆栈/JSON/日志片段）直接传 content 落盘；② 本地文件（截图/压缩包/大日志）不要传 content 和 data_base64，调用即返回一次性 curl -T 命令供终端直传，文件内容不经过对话。传 work_item_id 可直接挂到对应 bug 或 task。',
      inputSchema: {
        file_name: z.string().describe('带扩展名的文件名（如 screenshot.png、trace.log）'),
        file_type: z.string().optional().describe('MIME 类型，缺省按扩展名推断'),
        work_item_id: z.string().optional().describe('关联的缺陷或任务 ID（缺省存为项目通用附件）'),
        project_slug: z.string().optional().describe(PROJECT_SLUG_DESC),
        content: z.string().optional().describe('短文本原文（传本地文件时请留空以获取 curl 链接）'),
        data_base64: z.string().optional().describe('极小二进制 Base64（与 content 互斥；大文件请留空走 curl）'),
      },
      annotations: WRITE_ANNOT,
    },
    guarded('upload_attachment', TOOL_SCOPES.upload_attachment, (ctx, a) => fileTools.uploadAttachment(ctx, a)),
  );

  server.registerTool(
    'append_note',
    {
      title: '追加随手记',
      description: '将排查草稿、上下文备忘写入项目随手记（Markdown）。单活跃项目时自动归属该项目，多项目必须传 project_slug。',
      inputSchema: {
        content: z.string().describe('便签正文（Markdown）'),
        project_slug: z.string().optional().describe(PROJECT_SLUG_DESC),
        tags: z.array(z.string()).optional().describe('标签列表'),
      },
      annotations: WRITE_ANNOT,
    },
    guarded('append_note', TOOL_SCOPES.append_note, (ctx, a) => tools.appendNote(ctx, a)),
  );

  server.registerTool(
    'get_skill',
    {
      title: '获取团队技能',
      description:
        '按名称或 skill_id 取回技能 SKILL.md 与附带文件（可用技能见 get_project_context.skills）。超长技能支持带 path 与 offset 分批读取。',
      inputSchema: {
        name: z.string().optional().describe('技能名（项目专属技能优先于全局通用技能）'),
        skill_id: z.string().optional().describe('技能 ID'),
        project_slug: z.string().optional().describe(PROJECT_SLUG_DESC),
        path: z.string().optional().describe('仅取指定附带文件路径'),
        offset: z.number().int().min(0).optional().describe('大文件分段起始偏移'),
      },
      annotations: READ_ANNOT,
    },
    guarded('get_skill', TOOL_SCOPES.get_skill, (ctx, a) => skillTools.getSkill(ctx, a)),
  );

  return server;
}

export async function startStdioServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[vibehub-mcp] VibeHub MCP Server 已启动 (stdio)');
}

export { AppError };
