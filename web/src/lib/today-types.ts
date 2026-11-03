/** GET /api/today 响应类型（R89 今日工作台） */

export interface TodayActor {
  type: 'user' | 'ai';
  name: string;
}

export interface TodayPerson {
  id: string;
  name: string;
}

export interface TodayItem {
  kind: 'bug' | 'task';
  id: string;
  title: string;
  status: string;
  priority: string;
  severity: string | null;
  labels: string[];
  project: { id: string; name: string };
  assignee: TodayPerson | null;
  reporter?: TodayPerson | null;
  due_date: string | null;
  actor: TodayActor | null;
  since: string;
  stale: boolean;
}

export interface TodayResponse {
  generated_at: string;
  date: string;
  projects: { id: string; name: string }[];
  needs_me: TodayItem[];
  to_verify: TodayItem[];
  ai_active: TodayItem[];
  active: TodayItem[];
  today: {
    bugs_fixed: number;
    bugs_closed_unfixed: number;
    tasks_done: number;
    bugs_created: number;
    tasks_created: number;
  };
  remaining: {
    bugs: { unresolved: number; unverified: number };
    tasks: { todo: number; doing: number; unverified: number };
  };
  trend: { date: string; bugs_fixed: number; tasks_done: number }[];
}
