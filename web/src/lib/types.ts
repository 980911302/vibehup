/** 与 VibeHub Server REST API 对应的前端类型（snake_case） */

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
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
  git_commit_hash: string | null;
  created_by: 'human' | 'ai';
  resolution_notes: string | null;
  attachment_count: number;
  created_at: string;
  updated_at: string;
}

export interface BugDetail extends Bug {
  attachments: Attachment[];
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high';
  status: 'todo' | 'doing' | 'done';
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

export interface SearchResults {
  projects: Project[];
  bugs: Bug[];
  tasks: Task[];
  notes: Note[];
  attachments: Attachment[];
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

export const BUG_STATUS_LABELS: Record<string, string> = {
  open: '待处理',
  in_progress: '进行中',
  resolved: '已解决',
  verified: '已验证',
  closed: '已关闭',
};

export const SEVERITY_LABELS: Record<Bug['severity'], string> = {
  low: '低',
  normal: '中',
  high: '高',
  critical: '紧急',
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
