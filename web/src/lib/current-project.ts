/**
 * 当前项目（跨页共享 + 刷新后保留）：记在 localStorage，恢复时校验它仍在项目列表里。
 * 此前每个页面各自选「列表第一个」，在看板切了项目，一换页就被重置（功能巡检 B1）。
 */

export const CURRENT_PROJECT_KEY = 'vibehub_current_project';

/** 恢复顺序：记住的项目（仍存在且未归档）→ 第一个未归档项目 → 第一个项目 */
export function pickInitialProject(
  projects: { id: string; archived_at?: string | null }[],
  storedId: string | null,
): string | null {
  const stored = storedId ? projects.find((p) => p.id === storedId && !p.archived_at) : undefined;
  if (stored) return stored.id;
  return (projects.find((p) => !p.archived_at) ?? projects[0])?.id ?? null;
}

export function readStoredProject(): string | null {
  try {
    return localStorage.getItem(CURRENT_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function writeStoredProject(projectId: string): void {
  try {
    localStorage.setItem(CURRENT_PROJECT_KEY, projectId);
  } catch {
    // 隐私模式：只在本次会话内生效
  }
}
