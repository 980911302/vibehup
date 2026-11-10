import type { StatsByActor, StatsRemaining, StatsToday, StatsTrendPoint } from './stats-types';

/** 手上未结 + 今天完成 的总量，用来给「按密钥」表排序（API 不保证顺序） */
function activityScore(row: StatsByActor): number {
  return row.in_hand_bugs + row.in_hand_tasks + row.fixed_today + row.done_today;
}

/** 活跃度降序；打平按名字排序，结果稳定 */
export function sortByActorActivity(rows: StatsByActor[]): StatsByActor[] {
  return [...rows].sort((a, b) => activityScore(b) - activityScore(a) || a.name.localeCompare(b.name));
}

/** api.stats 的 project_id 查询参数：null（全部项目）映射为 'all' */
export function scopeParam(projectId: string | null): string {
  return projectId ?? 'all';
}

/** 今天完成的总量：修复完成的缺陷 + 完成的任务（统计页主数字） */
export function todayDone(today: StatsToday): number {
  return today.bugs_fixed + today.tasks_done;
}

/** 今天新增的总量：新增缺陷 + 新增任务 */
export function todayCreated(today: StatsToday): number {
  return today.bugs_created + today.tasks_created;
}

/** 还剩多少的总量（取消的任务不在 remaining 里，天然不计） */
export function totalRemaining(remaining: StatsRemaining): number {
  return (
    remaining.bugs.unresolved +
    remaining.bugs.unverified +
    remaining.tasks.todo +
    remaining.tasks.doing +
    remaining.tasks.unverified
  );
}

export type RemainingTone = 'brand' | 'warn' | 'muted';

export interface RemainingSegment {
  key: string;
  label: string;
  count: number;
  tone: RemainingTone;
}

export interface RemainingGroup {
  kind: 'bug' | 'task';
  label: string;
  total: number;
  urgent: number;
  segments: RemainingSegment[];
}

/**
 * 「还剩多少」的两组堆叠条：缺陷（未解决 / 未验证）与任务（待办 / 进行中 / 未验收）。
 * 颜色语义交给组件映射成 token；这里只给出稳定的 key 与 tone，便于单测。
 */
export function remainingGroups(remaining: StatsRemaining): RemainingGroup[] {
  const bugSegments: RemainingSegment[] = [
    { key: 'bug_unresolved', label: '未解决', count: remaining.bugs.unresolved, tone: 'brand' },
    { key: 'bug_unverified', label: '未验证', count: remaining.bugs.unverified, tone: 'warn' },
  ];
  const taskSegments: RemainingSegment[] = [
    { key: 'task_todo', label: '待办', count: remaining.tasks.todo, tone: 'muted' },
    { key: 'task_doing', label: '进行中', count: remaining.tasks.doing, tone: 'brand' },
    { key: 'task_unverified', label: '未验收', count: remaining.tasks.unverified, tone: 'warn' },
  ];
  return [
    {
      kind: 'bug',
      label: '缺陷',
      total: remaining.bugs.unresolved + remaining.bugs.unverified,
      urgent: remaining.bugs.urgent,
      segments: bugSegments,
    },
    {
      kind: 'task',
      label: '任务',
      total: remaining.tasks.todo + remaining.tasks.doing + remaining.tasks.unverified,
      urgent: remaining.tasks.urgent,
      segments: taskSegments,
    },
  ];
}

/** 最近 14 天双系列合计，用于趋势卡摘要 */
export function trendTotals(points: StatsTrendPoint[]): { bugsFixed: number; tasksDone: number } {
  return points.reduce(
    (acc, p) => ({ bugsFixed: acc.bugsFixed + p.bugs_fixed, tasksDone: acc.tasksDone + p.tasks_done }),
    { bugsFixed: 0, tasksDone: 0 },
  );
}

/** 近 7 天 / 前 7 天的完成总量（用于趋势卡的环比说明） */
export function trendWeekTotals(points: StatsTrendPoint[]): { last7: number; prev7: number } {
  const total = (rows: StatsTrendPoint[]) => rows.reduce((sum, p) => sum + p.bugs_fixed + p.tasks_done, 0);
  return { last7: total(points.slice(-7)), prev7: total(points.slice(0, -7)) };
}

/** 页面刷新时间（北京时间 HH:mm:ss） */
export function clockLabel(at: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(at);
}

/** 服务端日期（YYYY-MM-DD，北京时间）→「11 月 5 日 · 周四」 */
export function statsDateLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('month')} 月 ${get('day')} 日 · ${get('weekday')}`;
}
