import type { Skill, SkillDetail, SkillFileContent, SkillUpload, Task, TaskDetail } from './api-types';
import { request, requestBlob } from './http';

/** 任务与技能接口（R80，从 lib/api.ts 拆出；由 api 对象平铺导出，页面仍只用 api） */

export interface TaskInput {
  project_id: string;
  title: string;
  description?: string;
  priority?: string;
  status?: string;
  assignee_id?: string | null;
  labels?: string[];
}

export const taskApi = {
  listTasks: (projectId?: string, filters: { label?: string } = {}) => {
    const qs = new URLSearchParams();
    if (projectId) qs.set('project_id', projectId);
    if (filters.label) qs.set('label', filters.label);
    return request<Task[]>(`/tasks?${qs.toString()}`);
  },
  getTask: (taskId: string) => request<TaskDetail>(`/tasks/${taskId}`),
  createTask: (body: TaskInput) => request<Task>('/tasks', { method: 'POST', body: JSON.stringify(body) }),
  updateTask: (taskId: string, body: Record<string, unknown>) =>
    request<Task>(`/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTask: (taskId: string) => request<void>(`/tasks/${taskId}`, { method: 'DELETE' }),
};

export const skillApi = {
  listSkills: (projectId?: string) => request<Skill[]>(`/skills${projectId ? `?project_id=${projectId}` : ''}`),
  getSkill: (skillId: string) => request<SkillDetail>(`/skills/${skillId}`),
  getSkillFile: (skillId: string, path: string) =>
    request<SkillFileContent>(`/skills/${skillId}/file?path=${encodeURIComponent(path)}`),
  uploadSkill: (body: SkillUpload) =>
    request<{ action: 'created' | 'updated'; skill: SkillDetail }>('/skills', { method: 'POST', body: JSON.stringify(body) }),
  setSkillProject: (skillId: string, projectId: string | null) =>
    request<SkillDetail>(`/skills/${skillId}`, { method: 'PATCH', body: JSON.stringify({ project_id: projectId }) }),
  deleteSkill: (skillId: string) => request<void>(`/skills/${skillId}`, { method: 'DELETE' }),
  downloadSkill: (skillId: string) => requestBlob(`/skills/${skillId}/download`),
};
