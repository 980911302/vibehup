/** GET /api/stats 响应类型（R85 统计页，见 docs/计划/07 §7.16） */

export interface StatsActorRef {
  type: 'user' | 'ai';
  name: string;
}

export interface StatsToday {
  bugs_fixed: number;
  bugs_closed_unfixed: number;
  tasks_done: number;
  bugs_created: number;
  tasks_created: number;
}

export interface StatsRemaining {
  bugs: { unresolved: number; unverified: number };
  tasks: { todo: number; doing: number; unverified: number };
}

export interface StatsActiveItem {
  kind: 'bug' | 'task';
  id: string;
  title: string;
  status: string;
  project_id: string;
  actor: StatsActorRef | null;
  since: string;
  stale: boolean;
}

export interface StatsByActor {
  type: 'user' | 'ai';
  name: string;
  in_hand_bugs: number;
  in_hand_tasks: number;
  fixed_today: number;
  done_today: number;
}

export interface StatsTrendPoint {
  date: string;
  bugs_fixed: number;
  tasks_done: number;
}

export interface StatsResponse {
  scope: { project_id: string | null; today: string; timezone: string; days: number };
  today: StatsToday;
  remaining: StatsRemaining;
  active: StatsActiveItem[];
  by_actor: StatsByActor[];
  trend: StatsTrendPoint[];
}