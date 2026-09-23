'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type {
  Attachment,
  Bug,
  BugBoard,
  BugDetail,
  BugTemplate,
  Note,
  Project,
} from '@/lib/api-types';

const EMPTY_BOARD: BugBoard = { open: [], in_progress: [], resolved: [], verified: [], closed: [] };
const POLL_INTERVAL = 5000;

/**
 * 数据中枢（AGENTS.md 前端契约：页面只消费本 hook，不自 fetch）。
 * SSE 同进程即时推送 + 5s 轮询兜底（MCP 跨进程写入）。
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

export function useVibeHub(): VibeHubStore {
  const { accessToken } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [board, setBoard] = useState<BugBoard>(EMPTY_BOARD);
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteTags, setNoteTags] = useState<{ tag: string; count: number }[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [templates, setTemplates] = useState<BugTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [sseConnected, setSseConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projectIdRef = useRef<string | null>(null);
  projectIdRef.current = currentProjectId;

  const currentProject = projects.find((p) => p.id === currentProjectId) ?? null;

  const refreshBoard = useCallback(async () => {
    const pid = projectIdRef.current;
    if (!pid) return;
    try {
      setBoard(await api.getBoard(pid));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const refreshNotes = useCallback(async () => {
    const pid = projectIdRef.current;
    try {
      const [list, tags] = await Promise.all([
        api.listNotes({ projectId: pid ?? undefined }),
        api.listNoteTags(pid ?? undefined),
      ]);
      setNotes(list);
      setNoteTags(tags);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const refreshAttachments = useCallback(async () => {
    const pid = projectIdRef.current;
    try {
      setAttachments(await api.listAttachments({ projectId: pid ?? undefined }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const refreshTemplates = useCallback(async () => {
    try {
      setTemplates(await api.listTemplates());
    } catch {
      // 模板加载失败不阻塞看板
    }
  }, []);

  // 登录后加载项目
  useEffect(() => {
    if (!accessToken) return;
    (async () => {
      try {
        const list = await api.listProjects();
        setProjects(list);
        if (list.length > 0) setCurrentProjectId(list[0].id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [accessToken]);

  // 项目切换后加载数据
  useEffect(() => {
    if (!currentProjectId) return;
    void refreshBoard();
    void refreshNotes();
    void refreshAttachments();
    void refreshTemplates();
  }, [currentProjectId, refreshBoard, refreshNotes, refreshAttachments, refreshTemplates]);

  // SSE：同进程写入即时推送（token 走 query，EventSource 限制）
  useEffect(() => {
    if (!accessToken) return;
    const source = new EventSource(`/api/events?token=${encodeURIComponent(accessToken)}`);
    source.onopen = () => setSseConnected(true);
    source.onerror = () => setSseConnected(false);
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { type: string };
        if (data.type.startsWith('bug.') || data.type.startsWith('task.')) void refreshBoard();
        if (data.type.startsWith('note.')) void refreshNotes();
        if (data.type.startsWith('attachment.')) void refreshAttachments();
      } catch {
        // 心跳
      }
    };
    return () => source.close();
  }, [accessToken, refreshBoard, refreshNotes, refreshAttachments]);

  // 轮询兜底：MCP 跨进程写入（stdio 传输无法走进程内事件总线）
  useEffect(() => {
    if (!accessToken) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshBoard();
        void refreshNotes();
      }
    }, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [accessToken, refreshBoard, refreshNotes]);

  const selectProject = useCallback((projectId: string) => setCurrentProjectId(projectId), []);

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
    setCurrentProjectId(project.id);
    return project;
  }, []);

  const createBug = useCallback(async (input: Record<string, unknown>) => {
    const pid = projectIdRef.current;
    if (!pid) throw new Error('请先创建项目');
    const bug = await api.createBug({ ...input, project_id: pid });
    await refreshBoard();
    await refreshAttachments();
    return bug;
  }, [refreshBoard, refreshAttachments]);

  const moveBug = useCallback(async (bugId: string, status: Bug['status']) => {
    await api.updateBug(bugId, { status });
    await refreshBoard();
  }, [refreshBoard]);

  const updateBug = useCallback(async (bugId: string, patch: Record<string, unknown>) => {
    await api.updateBug(bugId, patch);
    await refreshBoard();
  }, [refreshBoard]);

  const deleteBug = useCallback(async (bugId: string) => {
    await api.deleteBug(bugId);
    await refreshBoard();
  }, [refreshBoard]);

  const batchBugs = useCallback(async (ids: string[], action: string, payload?: Record<string, unknown>) => {
    const result = await api.batchBugs({ ids, action, payload });
    await refreshBoard();
    return result;
  }, [refreshBoard]);

  const getBug = useCallback(async (bugId: string) => api.getBug(bugId), []);

  const addComment = useCallback(async (bugId: string, content: string) => {
    await api.addComment(bugId, content);
  }, []);

  const createNote = useCallback(async (content: string, tags?: string[]) => {
    const pid = projectIdRef.current;
    await api.createNote({ project_id: pid ?? null, content, tags });
    await refreshNotes();
  }, [refreshNotes]);

  const updateNote = useCallback(async (noteId: string, patch: Record<string, unknown>) => {
    await api.updateNote(noteId, patch);
    await refreshNotes();
  }, [refreshNotes]);

  const deleteNote = useCallback(async (noteId: string) => {
    await api.deleteNote(noteId);
    await refreshNotes();
  }, [refreshNotes]);

  const uploadAttachments = useCallback(async (files: File[]) => {
    const pid = projectIdRef.current;
    if (!pid) throw new Error('请先创建项目');
    const uploaded = await api.uploadFiles(pid, files);
    await refreshAttachments();
    return uploaded;
  }, [refreshAttachments]);

  const deleteAttachment = useCallback(async (attachmentId: string) => {
    await api.deleteAttachment(attachmentId);
    await refreshAttachments();
  }, [refreshAttachments]);

  return {
    projects, currentProject, board, notes, noteTags, attachments, templates,
    loading, sseConnected, error,
    selectProject, createProject, refreshProjects,
    refreshBoard, refreshNotes, refreshAttachments, refreshTemplates,
    createBug, moveBug, updateBug, deleteBug, batchBugs, getBug, addComment,
    createNote, updateNote, deleteNote, uploadAttachments, deleteAttachment,
  };
}
