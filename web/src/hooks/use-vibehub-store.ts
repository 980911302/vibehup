'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { pickInitialProject, readStoredProject, writeStoredProject } from '@/lib/current-project';
import { useLiveUpdates } from './vibehub-live';
import type { Attachment, Bug, BugBoard, BugDetail, BugTemplate, Note, Project } from '@/lib/api-types';

const EMPTY_BOARD: BugBoard = { open: [], in_progress: [], resolved: [], verifying: [], verified: [], closed: [] };

/**
 * 数据中枢（AGENTS.md 前端契约：页面只消费 hooks/use-vibehub.ts）。
 * 由 (app)/layout 的 VibeHubProvider 只实例化一次：当前项目、SSE 连接全站共享。
 */
export interface VibeHubStore {
  projects: Project[];
  currentProject: Project | null;
  board: BugBoard;
  notes: Note[];
  noteTags: { tag: string; count: number }[];
  attachments: Attachment[];
  templates: BugTemplate[];
  loading: boolean;
  sseConnected: boolean;
  error: string | null;
  /** 任务 / 技能有变化（SSE 或轮询）时递增，对应页面据此重新拉取 */
  taskRevision: number;
  skillRevision: number;
  selectProject: (projectId: string) => void;
  createProject: (name: string, slug?: string, description?: string) => Promise<Project>;
  refreshProjects: () => Promise<void>;
  refreshBoard: () => Promise<void>;
  refreshNotes: () => Promise<void>;
  refreshAttachments: () => Promise<void>;
  refreshTemplates: () => Promise<void>;
  createBug: (input: Record<string, unknown>) => Promise<Bug>;
  moveBug: (bugId: string, status: Bug['status']) => Promise<void>;
  updateBug: (bugId: string, patch: Record<string, unknown>) => Promise<void>;
  deleteBug: (bugId: string) => Promise<void>;
  batchBugs: (ids: string[], action: string, payload?: Record<string, unknown>) => Promise<{ updated: number; skipped: { id: string; reason: string }[] }>;
  getBug: (bugId: string) => Promise<BugDetail>;
  addComment: (bugId: string, content: string) => Promise<void>;
  createNote: (content: string, tags?: string[]) => Promise<void>;
  updateNote: (noteId: string, patch: Record<string, unknown>) => Promise<void>;
  deleteNote: (noteId: string) => Promise<void>;
  uploadAttachments: (files: File[]) => Promise<Attachment[]>;
  deleteAttachment: (attachmentId: string) => Promise<void>;
}

type Setter<T> = (v: T) => void;

/** 项目列表 + 当前项目（跨页共享、刷新后保留） */
function useProjects(accessToken: string | null, setError: Setter<string | null>) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    (async () => {
      try {
        const list = await api.listProjects();
        setProjects(list);
        setCurrentProjectId((cur) => cur ?? pickInitialProject(list, readStoredProject()));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [accessToken, setError]);

  const selectProject = useCallback((projectId: string) => {
    setCurrentProjectId(projectId);
    writeStoredProject(projectId);
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await api.listProjects());
    } catch {
      // 忽略：列表刷新失败保留旧数据
    }
  }, []);

  const createProject = useCallback(async (name: string, slug?: string, description?: string) => {
    const project = await api.createProject({ name, slug, description });
    setProjects((prev) => [project, ...prev]);
    selectProject(project.id);
    return project;
  }, [selectProject]);

  return { projects, currentProjectId, loading, selectProject, refreshProjects, createProject };
}

/** 当前项目下的数据：看板 / 便签 / 附件 / 模板 */
function useProjectData(projectIdRef: React.MutableRefObject<string | null>, setError: Setter<string | null>) {
  const [board, setBoard] = useState<BugBoard>(EMPTY_BOARD);
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteTags, setNoteTags] = useState<{ tag: string; count: number }[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [templates, setTemplates] = useState<BugTemplate[]>([]);
  const fail = useCallback((e: unknown) => setError(e instanceof Error ? e.message : String(e)), [setError]);

  const refreshBoard = useCallback(async () => {
    const pid = projectIdRef.current;
    if (!pid) return;
    try {
      setBoard(await api.getBoard(pid));
      setError(null);
    } catch (e) {
      fail(e);
    }
  }, [projectIdRef, setError, fail]);

  const refreshNotes = useCallback(async () => {
    const pid = projectIdRef.current ?? undefined;
    try {
      const [list, tags] = await Promise.all([api.listNotes({ projectId: pid }), api.listNoteTags(pid)]);
      setNotes(list);
      setNoteTags(tags);
    } catch (e) {
      fail(e);
    }
  }, [projectIdRef, fail]);

  const refreshAttachments = useCallback(async () => {
    try {
      setAttachments(await api.listAttachments({ projectId: projectIdRef.current ?? undefined }));
    } catch (e) {
      fail(e);
    }
  }, [projectIdRef, fail]);

  const refreshTemplates = useCallback(async () => {
    try {
      setTemplates(await api.listTemplates());
    } catch {
      // 模板加载失败不阻塞看板
    }
  }, []);

  return { board, notes, noteTags, attachments, templates, refreshBoard, refreshNotes, refreshAttachments, refreshTemplates };
}

type Data = ReturnType<typeof useProjectData>;

/** 写操作：成功后刷新对应数据 */
function useActions(projectIdRef: React.MutableRefObject<string | null>, d: Data) {
  const { refreshBoard, refreshNotes, refreshAttachments } = d;
  // 刷新函数引用稳定，动作随之稳定（与旧版 useCallback 行为一致）
  return useMemo(() => buildActions(projectIdRef, refreshBoard, refreshNotes, refreshAttachments), [
    projectIdRef, refreshBoard, refreshNotes, refreshAttachments,
  ]);
}

function buildActions(
  projectIdRef: React.MutableRefObject<string | null>,
  refreshBoard: () => Promise<void>,
  refreshNotes: () => Promise<void>,
  refreshAttachments: () => Promise<void>,
) {
  const requireProject = () => {
    const pid = projectIdRef.current;
    if (!pid) throw new Error('请先创建项目');
    return pid;
  };
  const after = <A extends unknown[]>(fn: (...a: A) => Promise<unknown>, refresh: () => Promise<void>) =>
    async (...a: A) => {
      await fn(...a);
      await refresh();
    };

  return {
    createBug: async (input: Record<string, unknown>) => {
      const bug = await api.createBug({ ...input, project_id: requireProject() });
      await refreshBoard();
      await refreshAttachments();
      return bug;
    },
    moveBug: after((bugId: string, status: Bug['status']) => api.updateBug(bugId, { status }), refreshBoard),
    updateBug: after((bugId: string, patch: Record<string, unknown>) => api.updateBug(bugId, patch), refreshBoard),
    deleteBug: after((bugId: string) => api.deleteBug(bugId), refreshBoard),
    batchBugs: async (ids: string[], action: string, payload?: Record<string, unknown>) => {
      const result = await api.batchBugs({ ids, action, payload });
      await refreshBoard();
      return result;
    },
    getBug: (bugId: string) => api.getBug(bugId),
    addComment: async (bugId: string, content: string) => {
      await api.addComment(bugId, content);
    },
    createNote: after((content: string, tags?: string[]) => api.createNote({ project_id: projectIdRef.current ?? null, content, tags }), refreshNotes),
    updateNote: after((noteId: string, patch: Record<string, unknown>) => api.updateNote(noteId, patch), refreshNotes),
    deleteNote: after((noteId: string) => api.deleteNote(noteId), refreshNotes),
    uploadAttachments: async (files: File[]) => {
      const uploaded = await api.uploadFiles(requireProject(), files);
      await refreshAttachments();
      return uploaded;
    },
    deleteAttachment: after((attachmentId: string) => api.deleteAttachment(attachmentId), refreshAttachments),
  };
}

export function useVibeHubStore(): VibeHubStore {
  const { accessToken } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [taskRevision, setTaskRevision] = useState(0);
  const [skillRevision, setSkillRevision] = useState(0);
  const p = useProjects(accessToken, setError);
  const projectIdRef = useRef<string | null>(null);
  projectIdRef.current = p.currentProjectId;
  const d = useProjectData(projectIdRef, setError);
  const actions = useActions(projectIdRef, d);

  useEffect(() => {
    if (!p.currentProjectId) return;
    void d.refreshBoard();
    void d.refreshNotes();
    void d.refreshAttachments();
    void d.refreshTemplates();
    // 仅在切换项目时全量加载（刷新函数引用稳定）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.currentProjectId]);

  const sseConnected = useLiveUpdates(accessToken, {
    onEvent: (type) => {
      if (type.startsWith('bug.')) void d.refreshBoard();
      if (type.startsWith('task.')) setTaskRevision((n) => n + 1);
      if (type.startsWith('skill.')) setSkillRevision((n) => n + 1);
      if (type.startsWith('note.')) void d.refreshNotes();
      if (type.startsWith('attachment.')) void d.refreshAttachments();
    },
    onPoll: () => {
      void d.refreshBoard();
      void d.refreshNotes();
      setTaskRevision((n) => n + 1);
    },
  });

  const currentProject = p.projects.find((x) => x.id === p.currentProjectId) ?? null;
  return {
    projects: p.projects, currentProject, loading: p.loading, sseConnected, error, taskRevision, skillRevision,
    selectProject: p.selectProject, createProject: p.createProject, refreshProjects: p.refreshProjects,
    board: d.board, notes: d.notes, noteTags: d.noteTags, attachments: d.attachments, templates: d.templates,
    refreshBoard: d.refreshBoard, refreshNotes: d.refreshNotes, refreshAttachments: d.refreshAttachments, refreshTemplates: d.refreshTemplates,
    ...actions,
  };
}
