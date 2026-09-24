import { BUG_TRANSITIONS, type BugStatus } from '../services/bugs.js';
import { allowedNextTaskStatuses } from '../services/tasks.js';

/**
 * 状态流转协议（缺陷 / 任务）——MCP 侧唯一出处。
 *
 * 技能文件（skills/vibehub-mcp/SKILL.md）要靠 AI 自己想起来加载，靠不住；
 * 这里的规则会随 initialize 的 instructions、工具描述和工具返回一起送到每个连上来的 AI。
 * 改规则时同步 SKILL.md 第 2～4 节。
 */

/** initialize 时下发给客户端的服务说明（Claude Code 等会把它放进系统提示） */
export const SERVER_INSTRUCTIONS = [
  'VibeHub 是团队的缺陷与任务看板，看板上的状态就是团队看到的事实。',
  '开工先调 get_project_context；有多个项目时必须传 project_slug（不传会报错并列出可选值，按当前代码仓库对应的项目选）。',
  '【状态流转硬规则：谁经手谁流转，做完当场改，不等人提醒】',
  '缺陷 open → in_progress → resolved → verified → closed，不能跳级：',
  '开始修 → in_progress；修完且自测通过 → resolved（resolution_notes 写根因、改动、自测方式，有提交就带 commit_hash）；',
  '验证通过 → verified（修复者自测不算验证；用户说「验证过了/没问题」时由当前 AI 代为流转）；',
  '修复已在最终环境生效或无需发布 → closed；验证不通过 → open 并填 reopen_reason；重复/不修/无法复现 → resolved 写明原因后 closed。',
  '任务 todo → doing → review → done，不能跳级：开始做 → doing；做完并自测通过 → review（待验证，等人验收）；',
  '验收通过 → done（自己做的不算验收；用户说「验收过了/没问题」时由当前 AI 代为流转）；验收不通过 → doing 并填 reopen_reason；',
  '不做了 → cancelled（未完成的任务都可以取消），取消的要重做 → todo；受阻保持 doing 并在回复里说明。',
  '每轮回复前自查：本轮碰过的 bug_/tsk_ 状态是否与实际一致，并在回复末尾列出流转记录。',
  '角色职责里「vibehub 由幕僚统一写 / 不写 vibehub」只指便签和新建记录，不包括状态流转：自己经手的缺陷和任务一律自己流转。',
  '新建缺陷/任务前先 search 查重。完整规范见技能 vibehub-mcp（SKILL.md，服务端 /skills/vibehub-mcp/SKILL.md）。',
  '【团队技能】get_project_context 会列出本项目和全团队通用的技能（名称+描述）；要用时 download_skill 取回全文，按原目录结构写到 .claude/skills/<name>/；',
  '沉淀出新的可复用流程时用 upload_skill 上传（同名即覆盖），删除用 delete_skill。删除缺陷/任务/便签/附件前先向用户确认。',
].join('\n');

const BUG_NEXT_STEP: Record<BugStatus, string> = {
  open: '开始定位/修复时先改为 in_progress',
  in_progress:
    '修完并自测通过后改为 resolved：resolution_notes 写根因、改了什么、怎么自测的；有提交就带 commit_hash',
  resolved:
    '等待验证：验证方按复现步骤验证，通过改 verified，不通过改 open 并填 reopen_reason；修复者自测不算验证，用户明确说验证通过时可代为流转',
  verified:
    '修复已在最终环境生效或无需发布时改 closed；还要等发布的，发布后再 closed',
  closed: '已关闭；问题再次出现时改 open 并填 reopen_reason',
};

const TASK_NEXT_STEP: Record<string, string> = {
  todo: '开始做时改为 doing；不做了改为 cancelled',
  doing: '做完并自测通过后改为 review（待验证）；受阻就保持 doing，并在回复里说明阻塞原因',
  review:
    '等待验收：通过改 done，不通过改回 doing 并填 reopen_reason；自己做的不算验收，用户明确说验收通过时可代为流转',
  done: '已完成；发现没做完或返工时改回 doing 并填 reopen_reason',
  cancelled: '已取消；要重新做时改回 todo',
};

export function bugNextStep(status: string): { allowed_next_statuses: string[]; next_step: string } {
  const key = status as BugStatus;
  return {
    allowed_next_statuses: BUG_TRANSITIONS[key] ?? [],
    next_step: BUG_NEXT_STEP[key] ?? '',
  };
}

export function taskNextStep(status: string): string {
  return TASK_NEXT_STEP[status] ?? '';
}

/** 任务流转提示：与 bugNextStep 对称，工具返回时一并送到 AI 眼前 */
export function taskFlow(status: string): { allowed_next_statuses: string[]; next_step: string } {
  return { allowed_next_statuses: allowedNextTaskStatuses(status), next_step: taskNextStep(status) };
}

/** get_project_context 的提醒：把「该流转却没流转」的存量摆到 AI 眼前 */
export function contextReminders(counts: {
  inProgressBugs: number;
  awaitingVerification: number;
  doingTasks: number;
  reviewTasks?: number;
}): string[] {
  const reminders: string[] = [];
  if (counts.inProgressBugs > 0) {
    reminders.push(`${counts.inProgressBugs} 个缺陷在 in_progress：本轮修完的请改 resolved（写 resolution_notes）`);
  }
  if (counts.awaitingVerification > 0) {
    reminders.push(
      `${counts.awaitingVerification} 个缺陷待验证或待关闭（awaiting_verification）：验证通过改 verified，已在最终环境生效改 closed，不通过改 open 并填 reopen_reason`,
    );
  }
  if (counts.doingTasks > 0) {
    reminders.push(`${counts.doingTasks} 个任务在 doing：做完并自测通过的请改 review（待验证）`);
  }
  if (counts.reviewTasks) {
    reminders.push(`${counts.reviewTasks} 个任务待验证（review）：验收通过改 done，不通过改回 doing 并填 reopen_reason`);
  }
  reminders.push('谁经手谁流转，做完当场改状态；回复末尾列出本轮流转记录');
  return reminders;
}
