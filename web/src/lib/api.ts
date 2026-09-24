/**
 * VibeHub API 客户端（AGENTS.md 前端契约：唯一数据入口）。HTTP 底座见 ./http。
 */
import type {
  ActivityItem,
  ApiKeyView,
  Attachment,
  Bug,
  BugBoard,
  BugComment,
  BugDetail,
  BugTemplate,
  KeyUsage,
  Note,
  Project,
  PublicUser,
  SavedView,
  SearchResults,
  Task,
  TextSlice,
  UserWithStats,
} from './api-types';
import { ApiError, BASE, currentAccessToken, parseError, rawRequest, request, setTokenAccessors } from './http';
import { taskApi, skillApi } from './api-more';

export { ApiError, setTokenAccessors };

export interface AuthResult {
  user: PublicUser;
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface MeResult {
  user: PublicUser;
  stats: { files_uploaded: number; active_keys: number };
}

export const api = {
  // ============ 认证 ============
  authConfig: () => rawRequest<{ registration_open: boolean }>('/auth/config', {}, null),
  register: (email: string, password: string, name: string) =>
    rawRequest<AuthResult>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name }) }, null),
  login: (email: string, password: string) =>
    rawRequest<AuthResult>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, null),
  logout: (refreshToken: string) =>
    rawRequest<void>('/auth/logout', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) }, null),
  me: () => request<MeResult>('/auth/me'),
  updateMe: (body: { name?: string }) => request<PublicUser>('/auth/me', { method: 'PATCH', body: JSON.stringify(body) }),
  changePassword: (oldPassword: string, newPassword: string) =>
    request<void>('/auth/me/password', {
      method: 'POST',
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    }),

  // ============ 项目 ============
  listProjects: (q?: string) => request<Project[]>(`/projects${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  createProject: (body: { name: string; slug?: string; description?: string }) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(body) }),
  updateProject: (id: string, body: Record<string, unknown>) =>
    request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),

  // ============ 缺陷 ============
  getBoard: (projectId: string) => request<BugBoard>(`/bugs/board/${projectId}`),
  listBugs: (params: { projectId?: string; status?: string; severity?: string; q?: string; page?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.projectId) qs.set('project_id', params.projectId);
    if (params.status) qs.set('status', params.status);
    if (params.severity) qs.set('severity', params.severity);
    if (params.q) qs.set('q', params.q);
    if (params.page) qs.set('page', String(params.page));
    return request<{ items: Bug[]; total: number; page: number; page_size: number }>(`/bugs?${qs.toString()}`);
  },
  getBug: (bugId: string) => request<BugDetail>(`/bugs/${bugId}`),
  createBug: (body: Record<string, unknown>) => request<Bug>('/bugs', { method: 'POST', body: JSON.stringify(body) }),
  updateBug: (bugId: string, body: Record<string, unknown>) =>
    request<Bug>(`/bugs/${bugId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteBug: (bugId: string) => request<void>(`/bugs/${bugId}`, { method: 'DELETE' }),
  batchBugs: (body: { ids: string[]; action: string; payload?: Record<string, unknown> }) =>
    request<{ updated: number; skipped: { id: string; reason: string }[] }>('/bugs/batch', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // 评论
  listComments: (bugId: string) => request<BugComment[]>(`/bugs/${bugId}/comments`),
  addComment: (bugId: string, content: string) =>
    request<{ id: string }>(`/bugs/${bugId}/comments`, { method: 'POST', body: JSON.stringify({ content }) }),

  // 模板
  listTemplates: () => request<BugTemplate[]>('/bugs/templates'),
  createTemplate: (body: { name: string; title_template: string; fields?: Record<string, unknown> }) =>
    request<BugTemplate>('/bugs/templates', { method: 'POST', body: JSON.stringify(body) }),
  updateTemplate: (id: string, body: Record<string, unknown>) =>
    request<BugTemplate>(`/bugs/templates/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTemplate: (id: string) => request<void>(`/bugs/templates/${id}`, { method: 'DELETE' }),

  // 视图
  listViews: (entity?: string) => request<SavedView[]>(`/bugs/views${entity ? `?entity=${entity}` : ''}`),
  createView: (body: Record<string, unknown>) => request<SavedView>('/bugs/views', { method: 'POST', body: JSON.stringify(body) }),
  updateView: (id: string, body: Record<string, unknown>) =>
    request<SavedView>(`/bugs/views/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteView: (id: string) => request<void>(`/bugs/views/${id}`, { method: 'DELETE' }),

  // ============ 任务 ============
  // 任务、技能（R80）：定义在 ./api-more，平铺进 api
  ...taskApi,
  ...skillApi,

  // ============ 便签 ============
  listNotes: (params: { projectId?: string | null; tag?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.projectId !== undefined) qs.set('project_id', params.projectId ?? '');
    if (params.tag) qs.set('tag', params.tag);
    return request<Note[]>(`/notes?${qs.toString()}`);
  },
  createNote: (body: { project_id?: string | null; content: string; tags?: string[] }) =>
    request<Note>('/notes', { method: 'POST', body: JSON.stringify(body) }),
  updateNote: (noteId: string, body: Record<string, unknown>) =>
    request<Note>(`/notes/${noteId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteNote: (noteId: string) => request<void>(`/notes/${noteId}`, { method: 'DELETE' }),
  listNoteTags: (projectId?: string | null) =>
    request<{ tag: string; count: number }[]>(`/notes/tags${projectId !== undefined ? `?project_id=${projectId ?? ''}` : ''}`),

  // ============ 附件 ============
  uploadFiles: async (projectId: string, files: File[]): Promise<Attachment[]> => {
    const form = new FormData();
    form.append('project_id', projectId);
    form.append('entity_type', 'general');
    for (const file of files) form.append('files', file);
    const token = currentAccessToken();
    const res = await fetch(`${BASE}/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) throw await parseError(res);
    const data = await res.json();
    return data.attachments as Attachment[];
  },
  /** 单文件上传（XHR，带进度回调；卡片 37：进度条与失败重试的基础） */
  uploadFile: (projectId: string, file: File, onProgress?: (percent: number) => void): Promise<Attachment> =>
    new Promise((resolve, reject) => {
      const token = currentAccessToken();
      const form = new FormData();
      form.append('project_id', projectId);
      form.append('entity_type', 'general');
      form.append('files', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/upload`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
      }
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText) as { attachments?: Attachment[]; error?: { message: string } };
          if (xhr.status >= 200 && xhr.status < 300 && data.attachments?.[0]) {
            onProgress?.(100);
            resolve(data.attachments[0]);
          } else {
            reject(new Error(data.error?.message ?? `上传失败（HTTP ${xhr.status}）`));
          }
        } catch {
          // 非 JSON 响应（代理错误页等）：人话提示服务异常
          reject(new Error(`服务暂时不可达（HTTP ${xhr.status}），请重试`));
        }
      };
      xhr.onerror = () => reject(new Error('网络错误，上传失败'));
      // 超时兜底：代理/服务端挂起不能无限等（MustNot：卡在 uploading 无反馈）
      xhr.timeout = 60_000;
      xhr.ontimeout = () => reject(new Error('上传超时，请重试'));
      xhr.send(form);
    }),

  listAttachments: (params: { projectId?: string; entityType?: string; entityId?: string; mine?: boolean; q?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.projectId) qs.set('project_id', params.projectId);
    if (params.entityType) qs.set('entity_type', params.entityType);
    if (params.entityId) qs.set('entity_id', params.entityId);
    if (params.mine) qs.set('mine', 'true');
    if (params.q) qs.set('q', params.q);
    return request<Attachment[]>(`/attachments?${qs.toString()}`);
  },
  deleteAttachment: (id: string) => request<void>(`/attachments/${id}`, { method: 'DELETE' }),
  attachmentUrl: (id: string) => `${BASE}/attachments/${id}/raw`,
  readText: (id: string, params: { offset?: number; limit?: number; grep?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.offset) qs.set('offset_line', String(params.offset));
    if (params.limit) qs.set('limit_lines', String(params.limit));
    if (params.grep) qs.set('grep_keyword', params.grep);
    return request<TextSlice>(`/attachments/${id}/text?${qs.toString()}`);
  },

  // ============ 密钥 ============
  listApiKeys: () => request<ApiKeyView[]>('/api-keys'),
  createApiKey: (body: { name: string; scopes?: string[]; rate_limit?: number; expires_in_days?: number | null }) =>
    request<{ key: string; warning: string; api_key: ApiKeyView }>('/api-keys', { method: 'POST', body: JSON.stringify(body) }),
  rotateApiKey: (id: string) =>
    request<{ key: string; view: ApiKeyView; previous_grace_until: string }>(`/api-keys/${id}/rotate`, { method: 'POST' }),
  revokeApiKey: (id: string) => request<void>(`/api-keys/${id}`, { method: 'DELETE' }),
  keyUsage: (id: string, days = 30) => request<KeyUsage>(`/api-keys/${id}/usage?days=${days}`),

  // ============ 成员 ============
  listUsers: (q?: string) => request<UserWithStats[]>(`/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  createUser: (body: { email: string; name: string; password?: string; role?: string }) =>
    request<{ user: PublicUser; one_time_password: string | null }>('/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (id: string, body: { role?: string; status?: string; name?: string }) =>
    request<PublicUser>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeUser: (id: string) => request<void>(`/users/${id}`, { method: 'DELETE' }),
  transferOwnership: (targetUserId: string) =>
    request<void>('/users/transfer-ownership', { method: 'POST', body: JSON.stringify({ target_user_id: targetUserId }) }),

  // ============ 系统设置 ============
  getSettings: () => request<Record<string, string>>('/system'),
  updateSettings: (body: Record<string, string>) =>
    request<Record<string, string>>('/system', { method: 'PATCH', body: JSON.stringify(body) }),

  // ============ AI 活动（卡片 36，全员可读） ============
  recentActivity: () => request<ActivityItem[]>('/activity/recent'),

  // ============ 搜索 ============
  search: (q: string) => request<SearchResults>(`/search?q=${encodeURIComponent(q)}`),

  // ============ CSV ============
  exportBugsUrl: (projectId: string) => `${BASE}/bugs/export?project_id=${projectId}`,
  importBugs: (projectId: string, csv: string) =>
    request<{ imported: number; results: { row: number; ok: boolean; reason?: string }[] }>('/bugs/import', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, csv }),
    }),
};

export type { Bug, BugBoard, Project, Note, Task, Attachment, PublicUser };
