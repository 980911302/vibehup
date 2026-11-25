import { BUG_TRANSITIONS, type BugStatus } from '../services/bugs.js';
import { allowedNextTaskStatuses } from '../services/tasks.js';

/**
 * 状态流转协议（缺陷 / 任务）——MCP 侧唯一出处（R96 9 工具精简版）。
 *
 * 这里的规则随 initialize 的 instructions、工具描述和工具返回一起送到每个连上来的 AI。
 * 改规则时同步 skills/vibehub-mcp/SKILL.md。
 */

/** initialize 时下发给客户端的服务说明 */
export const SERVER_INSTRUCTIONS = [
  'VibeHub 是团队的缺陷与任务看板，看板上的状态就是团队看到的事实。',
  '开工只需调一次 get_project_context（多项目时必须传 project_slug，按当前代码仓库对应的项目选）：返回里同时包含「我是谁（me）、可转交成员（members）、项目记忆（memory）、在办/待验收工作项、提醒（reminders）与可用技能清单（skills）」。',
  '【9 个高内聚工具】get_project_context / search / get_work_item / create_work_item / update_work_item / read_attachment / upload_attachment / append_note / get_skill；删除与清回收站仅限人类在 Web 端操作，AI 不得删单。',
  '【状态流转硬规则：谁经手谁流转，做完当场改，不等人提醒】',
  '缺陷 open → in_progress → resolved → verifying → verified，不能跳级，verified 就是修复完成的终点（统一用 update_work_item 流转）：',
  '开始修 → in_progress；修完且自测通过 → resolved（resolution_notes 写根因、改动、自测方式，有提交带 commit_hash）；',
  '开始验证 → 先改 verifying（验证中，看板上靠它知道有人在验）；验证通过 → verified（resolution_notes 写在哪个环境怎么验的；修复者自测不算验证；用户说「验证过了/没问题」时由当前 AI 代为流转）；',
  '验证不通过 → in_progress 或 open 并填 reopen_reason；验不了、要交给别人 → 改回 resolved。',
  '重复/不修/无法复现 → closed，必须在 resolution_notes 写明原因（重复写上缺陷号）；closed 只用于这种不修复的结局。',
  '任务 todo → doing → review → verifying → done，不能跳级：开始做 → doing；做完并自测通过 → review（待验证）；',
  '开始验收 → 先改 verifying（验证中）；验收通过 → done（自己做的不算验收；用户说「验收过了/没问题」时由当前 AI 代为流转）；验收不通过 → doing 并填 reopen_reason；验不了 → 改回 review；',
  '不做了 → cancelled（未完成的任务都可以取消），取消的要重做 → todo；受阻保持 doing 并在回复里说明。',
  '【交付证据、评论与转交】都在 update_work_item 一次完成：标记 resolved/review 时尽量传 evidence（commit / pr_url / tests / changed_files / screenshots / notes；非代码交付写 no_code_reason）；追加过程记录传 comment；转交负责人传 assignee_id（取自 get_project_context.members 中 writable=true 的成员）+ handoff_reason。',
  '新建缺陷/任务前先 search 查重，再用 create_work_item(type="bug"|"task") 创建。每轮回复末尾列出本轮碰过的 bug_/tsk_ 流转记录。',
  '【团队技能与附件】要用某个技能时调 get_skill(name=...) 取回全文写到 .claude/skills/<name>/；读附件统一调 read_attachment（图片自动返回视觉块、文本支持行号分片与 grep）；传短文本调 upload_attachment(content=...)，传本地截图/大文件调 upload_attachment（不传 content）拿 curl -T 直传命令。',
].join('\n');

const BUG_NEXT_STEP: Record<BugStatus, string> = {
  open: '开始定位/修复时先改为 in_progress；重复/不修/无法复现的改 closed 并在 resolution_notes 写原因',
  in_progress:
    '修完并自测通过后改为 resolved：resolution_notes 写根因、改了什么、怎么自测的；有提交就带 commit_hash 并补齐 evidence',
  resolved:
    '等待验证：验证方开始验证时先改 verifying（验证中），让团队看到有人在验；修复者自测不算验证，用户明确说验证通过时可代为流转（先 verifying 再 verified）',
  verifying:
    '验证中：按复现步骤验证，通过改 verified（resolution_notes 写环境与验证方式），不通过改 in_progress 并填 reopen_reason；验不了要交给别人就改回 resolved',
  verified: '已验证，修复完成（终点，不用再关闭）；问题再次出现时改 open 或 in_progress 并填 reopen_reason',
  closed: '已关闭（不修复的结局）；问题需要重新处理时改 open 并填 reopen_reason',
};

const TASK_NEXT_STEP: Record<string, string> = {
  todo: '开始做时改为 doing；不做了改为 cancelled',
  doing: '做完并自测通过后改为 review（待验证）并补齐 evidence；受阻就保持 doing，并在回复里说明阻塞原因',
  review:
    '等待验收：验收方开始验收时先改 verifying（验证中）；自己做的不算验收，用户明确说验收通过时可代为流转（先 verifying 再 done）',
  verifying: '验证中：通过改 done，不通过改回 doing 并填 reopen_reason；验不了要交给别人就改回 review',
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

/** get_project_context 的提醒：把「该流转却没流转」和「有人接手却迟迟没结果」的摆到 AI 眼前 */
export function contextReminders(counts: {
  inProgressBugs: number;
  awaitingVerification: number;
  doingTasks: number;
  reviewTasks?: number;
  staleBugs?: number;
  staleTasks?: number;
}): string[] {
  const reminders: string[] = [];
  if (counts.inProgressBugs > 0) {
    reminders.push(`${counts.inProgressBugs} 个缺陷在 in_progress：本轮修完的请改 resolved（写 resolution_notes 与 evidence）`);
  }
  if (counts.awaitingVerification > 0) {
    reminders.push(
      `${counts.awaitingVerification} 个缺陷待验证（resolved）：要验证的先改 verifying 再动手，通过改 verified，不通过改 in_progress 并填 reopen_reason`,
    );
  }
  if (counts.doingTasks > 0) {
    reminders.push(`${counts.doingTasks} 个任务在 doing：做完并自测通过的请改 review（待验证）`);
  }
  if (counts.reviewTasks) {
    reminders.push(`${counts.reviewTasks} 个任务待验证（review）：要验收的先改 verifying，通过改 done，不通过改回 doing 并填 reopen_reason`);
  }
  const stale = (counts.staleBugs ?? 0) + (counts.staleTasks ?? 0);
  if (stale > 0) {
    reminders.push(
      `${stale} 个缺陷/任务处理中停留过久（stale_items：验证中超过 2 小时、进行中超过 24 小时）：是你在处理的请给出结论；处理方已中断的，改回上一步（verifying → resolved/review，in_progress → open，doing → todo）让别人接手`,
    );
  }
  reminders.push('谁经手谁流转，做完当场改状态；回复末尾列出本轮流转记录');
  return reminders;
}
