import type { Bug, BugBoard } from './api-types';
import { BUG_STATUSES } from './bug-flow';

/** 看板筛选：人员维度（全部 / 指派给我 / 我提的 / 未指派）+ 严重度 + 标签 + 关键字 */
export type WhoFilter = 'all' | 'mine' | 'reported' | 'unassigned';

export interface BoardFilters {
  who: WhoFilter;
  severity?: string;
  label?: string;
  search?: string;
}

export const WHO_LABELS: Record<WhoFilter, string> = {
  all: '全部',
  mine: '指派给我',
  reported: '我提的',
  unassigned: '未指派',
};

export function matchesBug(bug: Bug, f: BoardFilters, userId: string | null): boolean {
  if (f.who === 'mine' && bug.assignee_id !== userId) return false;
  if (f.who === 'reported' && bug.reporter_id !== userId) return false;
  if (f.who === 'unassigned' && bug.assignee_id) return false;
  if (f.severity && bug.severity !== f.severity) return false;
  if (f.label && !bug.labels.includes(f.label)) return false;
  const q = f.search?.trim().toLowerCase();
  if (q && !`${bug.title} ${bug.labels.join(' ')}`.toLowerCase().includes(q)) return false;
  return true;
}

export function filterBoard(board: BugBoard, f: BoardFilters, userId: string | null): BugBoard {
  const apply = (bugs: Bug[] = []) => bugs.filter((b) => matchesBug(b, f, userId));
  return Object.fromEntries(BUG_STATUSES.map((st) => [st, apply(board[st])])) as unknown as BugBoard;
}

/** 生效中的筛选条件个数（人员维度选「全部」不算） */
export function activeFilterCount(f: BoardFilters): number {
  return (f.who !== 'all' ? 1 : 0) + (f.severity ? 1 : 0) + (f.label ? 1 : 0) + (f.search?.trim() ? 1 : 0);
}
