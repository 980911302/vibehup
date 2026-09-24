import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { AppError } from '../core/errors.js';
import * as tools from './tools.js';
import * as ext from './tools-extended.js';
import { guarded } from './guard.js';
import { SERVER_INSTRUCTIONS } from './workflow.js';
import { TOOL_SCOPES } from './tool-scopes.js';
import { registerMoreTools } from './register-more.js';

/**
 * VibeHub MCP Server（设计文档第 4 节 + 步骤 03 §3.2 工具矩阵）。
 * 基于 @modelcontextprotocol/sdk；stdio（本地信任）与 SSE（容器部署，卡片 11）共用本工厂。
 * 所有工具经 guarded() 包装：scope 校验 → 执行 → Token 经济学校形 → 打点。
 *
 * 注意：MCP 协议占用 stdout，任何日志必须走 stderr。
 */

/** 工具名清单（冒烟与文档对账用） */
export const TOOL_NAMES = [
  // 既有 7 个
  'get_project_context',
  'list_bugs',
  'get_bug_detail',
  'read_attachment_text',
  'inspect_image_asset',
  'update_bug_status',
  'append_scratchpad',
  // 新增 8 个（ steps 03 §3.2）
  'list_notes',
  'search',
  'create_bug',
  'add_bug_comment',
  'upload_attachment',
  'list_tasks',
  'update_task',
  'purge_trash',
  // 后补：AI 建任务（此前只能改不能建）
  'create_task',
  // R80：任务详情、删除与便签修改、技能
  'get_task_detail',
  'delete_task',
  'delete_bug',
  'update_note',
  'delete_note',
  'delete_attachment',
  'list_skills',
  'download_skill',
  'upload_skill',
  'delete_skill',
] as const;

const TASK_STATUS_ENUM = ['todo', 'doing', 'review', 'done', 'cancelled'] as const;

const TOKEN_BUDGET_NOTE =
  '返回已按 Token 经济学校形：列表默认最多 20 条，has_more 为 true 时用分页参数继续；长文本自动截断到 500 字符，需要完整内容时用 read_attachment_text 分片读取。';

/** 经 resolveProject 解析项目的工具共用（R76：不再按 MCP 服务进程 cwd 猜项目） */
const PROJECT_SLUG_DESC = '项目 slug（Web 端「项目」页可复制）；多项目时必填，只有一个进行中项目时可省略';

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'vibehub', version: '0.2.0' },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  // ============ 读取类 ============

  server.registerTool(
    'get_project_context',
    {
      title: '获取项目上下文',
      description: `获取项目当前活跃状态（冷启动用）：open/in_progress 缺陷、待验证/待关闭缺陷（awaiting_verification）、doing 与 todo 任务、最新 5 条便签，以及 reminders（该流转却还没流转的提醒，照做）。只有一个进行中项目时可省略 project_slug；多项目时必须传（不传会报错并列出可选 slug）。${TOKEN_BUDGET_NOTE}`,
      inputSchema: {
        project_slug: z.string().optional().describe(PROJECT_SLUG_DESC),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded('get_project_context', TOOL_SCOPES.get_project_context, (_ctx, args) =>
      tools.getProjectContext(args as { project_slug?: string }),
    ),
  );

  server.registerTool(
    'list_bugs',
    {
      title: '缺陷列表',
      description: `分页/按状态拉取缺陷列表，返回扁平元数据（ID、标题、严重度、附件数量）。${TOKEN_BUDGET_NOTE}`,
      inputSchema: {
        project_slug: z.string().optional().describe(PROJECT_SLUG_DESC),
        status: z
          .enum(['open', 'in_progress', 'resolved', 'verified', 'closed'])
          .optional()
          .describe('按状态过滤'),
        page: z.number().int().min(1).optional().default(1),
        page_size: z.number().int().min(1).max(200).optional().default(20),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded('list_bugs', TOOL_SCOPES.list_bugs, (_ctx, args) =>
      tools.listBugs(args as { project_slug?: string; status?: string; page?: number; page_size?: number }),
    ),
  );

  server.registerTool(
    'get_bug_detail',
    {
      title: '缺陷详情',
      description: `提取 Bug 完整复现描述与附件清单（附件 ID 与文件规格）。长字段自动截断到 500 字符。`,
      inputSchema: {
        bug_id: z.string().describe('缺陷 ID'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded('get_bug_detail', TOOL_SCOPES.get_bug_detail, (_ctx, args) =>
      tools.getBugDetail(args as { bug_id: string }),
    ),
  );

  server.registerTool(
    'read_attachment_text',
    {
      title: '读取文本附件',
      description:
        '分片/范围读取文本与日志附件（.log/.txt/.json 等）。支持行号偏移、行数限制与 grep 关键词过滤，返回 has_more 截断标志，防止撑爆上下文窗口。',
      inputSchema: {
        attachment_id: z.string().describe('附件 ID'),
        offset_line: z.number().int().min(1).optional().default(1).describe('起始行号，从 1 开始'),
        limit_lines: z.number().int().min(1).max(2000).optional().default(200).describe('返回行数上限'),
        grep_keyword: z.string().optional().describe('关键词过滤，仅返回包含该词的行'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded('read_attachment_text', TOOL_SCOPES.read_attachment_text, (_ctx, args) =>
      tools.readAttachmentText(args as {
        attachment_id: string;
        offset_line?: number;
        limit_lines?: number;
        grep_keyword?: string;
      }),
    ),
  );

  server.registerTool(
    'inspect_image_asset',
    {
      title: '检查图片资产',
      description:
        '提取图像资产供多模态模型消费：自动缩放降采样至目标最大边长（默认 1080），返回本地绝对路径或 Base64 编码数据。',
      inputSchema: {
        attachment_id: z.string().describe('附件 ID'),
        target_max_dimension: z.number().int().min(64).max(4096).optional().default(1080).describe('目标最大边长'),
        return_mode: z
          .enum(['path', 'base64'])
          .optional()
          .default('path')
          .describe('path 返回本地绝对路径；base64 返回编码数据'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded('inspect_image_asset', TOOL_SCOPES.inspect_image_asset, (_ctx, args) =>
      tools.inspectImageAssetTool(args as {
        attachment_id: string;
        target_max_dimension?: number;
        return_mode?: 'path' | 'base64';
      }),
    ),
  );

  server.registerTool(
    'list_notes',
    {
      title: '便签列表',
      description: `拉取项目便签（Scratchpad），content 自动截断。${TOKEN_BUDGET_NOTE}`,
      inputSchema: {
        project_slug: z.string().optional().describe('项目 slug，选填（缺省查全部）'),
        limit: z.number().int().min(1).max(100).optional().default(10),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded('list_notes', TOOL_SCOPES.list_notes, (ctx, args) =>
      ext.listNotes(ctx, args as { project_slug?: string; limit?: number }),
    ),
  );

  server.registerTool(
    'search',
    {
      title: '全局搜索',
      description: '跨缺陷/任务/便签/附件/项目检索（支持中文与拼音），每类默认 5 条。',
      inputSchema: {
        q: z.string().describe('关键词'),
        limit: z.number().int().min(1).max(20).optional().default(5),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded('search', TOOL_SCOPES.search, (ctx, args) => ext.search(ctx, args as { q: string; limit?: number })),
  );

  server.registerTool(
    'list_tasks',
    {
      title: '任务列表',
      description: `拉取项目任务，可按状态、标签过滤；要看完整描述、附件和可走的下一步用 get_task_detail。${TOKEN_BUDGET_NOTE}`,
      inputSchema: {
        project_slug: z.string().optional().describe(PROJECT_SLUG_DESC),
        status: z.enum(TASK_STATUS_ENUM).optional().describe('按状态过滤：todo 待办 / doing 进行中 / review 待验证 / done 已完成 / cancelled 已取消'),
        label: z.string().optional().describe('按标签过滤'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded('list_tasks', TOOL_SCOPES.list_tasks, (ctx, args) =>
      ext.listTasks(ctx, args as { project_slug?: string; status?: string; label?: string }),
    ),
  );

  // ============ 写入类 ============

  server.registerTool(
    'update_bug_status',
    {
      title: '更新缺陷状态',
      description:
        '流转缺陷状态，经手就要调，不等人提醒。状态机 open → in_progress → resolved → verified → closed，不能跳级（一次只走一步，需要时连续调用）。' +
        '开始修 → in_progress；修完且自测通过 → resolved（写 resolution_notes，有提交带 commit_hash）；验证通过 → verified；已在最终环境生效或无需发布 → closed；' +
        '验证不通过 → open 并填 reopen_reason（从 resolved/verified/closed 回流都必须填）。返回 allowed_next_statuses 与 next_step。',
      inputSchema: {
        bug_id: z.string().describe('缺陷 ID'),
        status: z.enum(['open', 'in_progress', 'resolved', 'verified', 'closed']).describe('目标状态（只能是当前状态的下一步，见 get_bug_detail 的 allowed_next_statuses）'),
        resolution_notes: z.string().optional().describe('resolved 时必写：根因、改了什么、怎么自测的；verified 时写在哪个环境怎么验证的；不修/重复时写原因'),
        commit_hash: z.string().optional().describe('修复对应的 git commit hash（有提交才填）'),
        reopen_reason: z.string().optional().describe('回流到 open/in_progress 时必填：验证没过的现象'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    guarded('update_bug_status', TOOL_SCOPES.update_bug_status, (ctx, args) =>
      tools.updateBugStatus(args as Parameters<typeof tools.updateBugStatus>[0], { type: 'ai', id: ctx.apiKeyId }),
    ),
  );

  server.registerTool(
    'create_bug',
    {
      title: '创建缺陷',
      description:
        'AI 把自己发现的问题建成工单（可关联已通过 upload_attachment 上传的截图/日志）。自动写入 AI 活动流。',
      inputSchema: {
        project_slug: z.string().optional().describe(PROJECT_SLUG_DESC),
        title: z.string().describe('缺陷标题'),
        severity: z.enum(['low', 'normal', 'high', 'critical']).optional(),
        steps_to_reproduce: z.string().optional(),
        expected_result: z.string().optional(),
        actual_result: z.string().optional(),
        attachment_ids: z.array(z.string()).optional().describe('关联的附件 ID 列表'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    guarded('create_bug', TOOL_SCOPES.create_bug, (ctx, args) =>
      ext.createBug(ctx, args as Parameters<typeof ext.createBug>[1]),
    ),
  );

  server.registerTool(
    'add_bug_comment',
    {
      title: '追加缺陷评论',
      description: 'AI 记录修复过程、定位结论或向人类追问（活动流中标记为 AI）。',
      inputSchema: {
        bug_id: z.string().describe('缺陷 ID'),
        content: z.string().describe('评论内容'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    guarded('add_bug_comment', TOOL_SCOPES.add_bug_comment, (ctx, args) =>
      ext.addBugComment(ctx, args as { bug_id: string; content: string }),
    ),
  );

  server.registerTool(
    'append_scratchpad',
    {
      title: '追加随手记',
      description: 'AI 暂存临时想法或设计草案到项目便签墙（Scratchpad）。',
      inputSchema: {
        content: z.string().describe('便签内容（支持 Markdown）'),
        project_slug: z.string().optional().describe('项目 slug，选填'),
        tags: z.array(z.string()).optional().describe('标签数组，如 ["auth","tech-debt"]'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    guarded('append_scratchpad', TOOL_SCOPES.append_scratchpad, (_ctx, args) =>
      tools.appendScratchpad(args as { content: string; project_slug?: string; tags?: string[] }),
    ),
  );

  server.registerTool(
    'upload_attachment',
    {
      title: '上传附件',
      description:
        'AI 把日志/截图贴回工单：base64 入，落盘并返回 attachment id 与访问 url（可被 create_bug 关联）。',
      inputSchema: {
        project_slug: z.string().optional().describe(PROJECT_SLUG_DESC),
        bug_id: z.string().optional().describe('关联到缺陷（缺省为 general）'),
        file_name: z.string().describe('文件名（如 stacktrace.log）'),
        file_type: z.string().describe('MIME 类型（如 text/plain、image/png）'),
        data_base64: z.string().describe('文件内容 Base64'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    guarded('upload_attachment', TOOL_SCOPES.upload_attachment, (ctx, args) =>
      ext.uploadAttachment(ctx, args as Parameters<typeof ext.uploadAttachment>[1]),
    ),
  );

  server.registerTool(
    'create_task',
    {
      title: '创建任务',
      description:
        'AI 把拆出来的待办/验收遗留项建成任务（可关联已通过 upload_attachment 上传的附件、可带标签）。建之前先 search 查重。状态缺省 todo、优先级缺省 medium；马上就要动手的可直接建成 doing。',
      inputSchema: {
        project_slug: z.string().optional().describe(PROJECT_SLUG_DESC),
        title: z.string().describe('任务标题'),
        description: z.string().optional().describe('任务描述（支持 Markdown）'),
        priority: z.enum(['low', 'medium', 'high']).optional().describe('优先级，缺省 medium'),
        status: z.enum(['todo', 'doing']).optional().describe('初始状态，缺省 todo'),
        labels: z.array(z.string()).optional().describe('标签，如 ["前端","登录"]'),
        attachment_ids: z.array(z.string()).optional().describe('关联的附件 ID 列表'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    guarded('create_task', TOOL_SCOPES.create_task, (ctx, args) =>
      ext.createTask(ctx, args as Parameters<typeof ext.createTask>[1]),
    ),
  );

  server.registerTool(
    'update_task',
    {
      title: '更新任务',
      description:
        '流转任务状态（也可改优先级、标题、描述、标签，只改传入的字段），经手就要调。流转不能跳级：todo → doing → review → done；开始做 → doing；做完并自测通过 → review（待验证）；验收通过 → done（自己做的不算验收）；验收不通过 → doing 并填 reopen_reason；不做了 → cancelled，重做 → todo。description 是整段替换，list_tasks 返回的是截断后的描述，要改先用 get_task_detail(full: true) 取全文。',
      inputSchema: {
        task_id: z.string().describe('任务 ID'),
        status: z.enum(TASK_STATUS_ENUM).optional().describe('目标状态（只能是当前状态可走的下一步，见 get_task_detail 的 allowed_next_statuses）'),
        reopen_reason: z.string().optional().describe('打回（review/done → doing）时必填：验收没过的现象'),
        labels: z.array(z.string()).optional().describe('标签（整组替换）'),
        priority: z.enum(['low', 'medium', 'high']).optional().describe('优先级'),
        title: z.string().optional().describe('新标题'),
        description: z.string().optional().describe('新描述（整段替换）'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    guarded('update_task', TOOL_SCOPES.update_task, (ctx, args) =>
      ext.updateTask(ctx, args as Parameters<typeof ext.updateTask>[1]),
    ),
  );

  server.registerTool(
    'purge_trash',
    {
      title: '清理回收站',
      description: '清理回收区中超过保留期（默认 30 天）的附件文件。需要 admin scope。',
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    guarded('purge_trash', TOOL_SCOPES.purge_trash, (ctx, args) => ext.purgeTrash(ctx, args)),
  );

  registerMoreTools(server);
  return server;
}

/** stdio 入口：供 IDE Agent 以子进程方式拉起 */
export async function startStdioServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[vibehub-mcp] VibeHub MCP Server 已启动 (stdio)');
}

export { AppError };
