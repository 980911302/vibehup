/** 与后端 REST API 对应的前端类型（snake_case） */

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  status: 'active' | 'disabled';
  last_login_at: string | null;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Bug {
  id: string;
  project_id: string;
  title: string;
  steps_to_reproduce: string | null;
  expected_result: string | null;
  actual_result: string | null;
  severity: 'low' | 'normal' | 'high' | 'critical';
  status: 'open' | 'in_progress' | 'resolved' | 'verified' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignee_id: string | null;
  /** 指派负责人摘要（R74：后端 include + 序列化；未指派为 null） */
  assignee: { id: string; name: string } | null;
  due_date: string | null;
  labels: string[];
  reopened_count: number;
  git_commit_hash: string | null;
  created_by: 'human' | 'ai';
  resolution_notes: string | null;
  attachment_count: number;
  comment_count: number;
  created_at: string;
  updated_at: string;
}

export interface BugDetail extends Bug {
  attachments: Attachment[];
}

export interface BugComment {
  id: string;
  bug_id: string;
  author_type: 'user' | 'ai';
  author_id: string | null;
  author_name: string | null;
  content: string;
  created_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high';
  status: 'todo' | 'doing' | 'done';
  assignee_id: string | null;
  attachment_count: number;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  project_id: string | null;
  content: string;
  tags: string[];
  is_archived: boolean;
  pinned_at: string | null;
  attachment_count: number;
  created_at: string;
  updated_at: string;
}

export interface Attachment {
  id: string;
  project_id: string;
  entity_type: 'bug' | 'task' | 'note' | 'general';
  entity_id: string | null;
  file_name: string;
  file_type: string;
  file_size: number;
  storage_type: string;
  uploaded_by: string | null;
  public_url: string | null;
  width: number | null;
  height: number | null;
  created_at: string;
}

export interface BugBoard {
  open: Bug[];
  in_progress: Bug[];
  resolved: Bug[];
  verified: Bug[];
  closed: Bug[];
}

export interface BugTemplate {
  id: string;
  name: string;
  title_template: string;
  fields: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}

export interface SavedView {
  id: string;
  user_id: string;
  entity: string;
  name: string;
  filters: Record<string, unknown>;
  sort: Record<string, unknown>;
  columns: Record<string, unknown>;
  is_default: boolean;
  created_at: string;
}

export interface ApiKeyView {
  id: string;
  name: string;
  masked: string;
  scopes: string[];
  rate_limit: number;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  status: 'active' | 'expired' | 'revoked';
  created_by: string | null;
  created_at: string;
}

export interface KeyUsage {
  total: number;
  points: { day: string; calls: number }[];
}

export interface UserWithStats extends PublicUser {
  stats: { bugs_created: number; files_uploaded: number; active_keys: number };
}

/** AI 活动条目（卡片 36）：usage_events 脱敏视图，全员可读 */
export interface ActivityItem {
  id: string;
  event_type: string;
  tool: string | null;
  actor: string | null;
  result: string | null;
  latency_ms: number | null;
  key_name: string | null;
  key_prefix: string | null;
  created_at: string;
}

export interface SearchResults {
  projects: Project[];
  bugs: Bug[];
  tasks: Task[];
  notes: Note[];
  attachments: Attachment[];
  /** 语义相似（卡片 28 后端产出、卡片 34 消费）：pgvector 近邻，distance 升序 */
  similar: {
    bugs: Bug[];
    notes: Note[];
  };
}

export interface TextSlice {
  attachment_id: string;
  file_name: string;
  file_type: string;
  content: string;
  total_lines: number;
  returned_lines: number;
  has_more: boolean;
  next_offset_line: number | null;
  grep_keyword: string | null;
}

export const BUG_STATUS_LABELS: Record<Bug['status'], string> = {
  open: '待处理',
  in_progress: '进行中',
  resolved: '已解决',
  verified: '待验证',
  closed: '已关闭',
};

export const SEVERITY_LABELS: Record<Bug['severity'], string> = {
  low: '低',
  normal: '中',
  high: '高',
  critical: '紧急',
};

export const PRIORITY_LABELS: Record<Bug['priority'], string> = {
  low: '低',
  medium: '中',
  high: '高',
  urgent: '紧急',
};

export function isImage(a: Attachment): boolean {
  return a.file_type.startsWith('image/');
}

export function isText(a: Attachment): boolean {
  if (a.file_type.startsWith('text/')) return true;
  return ['json', 'log', 'md', 'txt', 'yml', 'yaml', 'csv', 'xml'].includes(
    a.file_name.split('.').pop()?.toLowerCase() ?? '',
  );
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
