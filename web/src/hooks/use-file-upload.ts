'use client';

import { useCallback, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { Attachment } from '@/lib/api-types';

/** 上传队列条目（卡片 37） */
export interface UploadItem {
  id: string;
  name: string;
  percent: number;
  status: 'uploading' | 'error' | 'done';
  error?: string;
  file: File;
}

let seq = 0;

/**
 * 文件上传队列（卡片 37）：逐文件 XHR 并行上传，实时进度；
 * 失败保留红框可单独重试，成功 1.5s 后自动淡出。
 */
export function useFileUpload(projectId: string) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const patch = useCallback((id: string, p: Partial<UploadItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)));
  }, []);

  const uploadOne = useCallback(
    async (item: UploadItem): Promise<Attachment | null> => {
      patch(item.id, { status: 'uploading', percent: 0, error: undefined });
      try {
        const att = await api.uploadFile(projectId, item.file, (percent) => patch(item.id, { percent }));
        patch(item.id, { status: 'done', percent: 100 });
        const timer = setTimeout(() => {
          setItems((prev) => prev.filter((it) => it.id !== item.id));
          timers.current.delete(item.id);
        }, 1500);
        timers.current.set(item.id, timer);
        return att;
      } catch (e) {
        patch(item.id, { status: 'error', error: e instanceof Error ? e.message : '上传失败' });
        return null;
      }
    },
    [projectId, patch],
  );

  const upload = useCallback(
    async (files: File[]): Promise<Attachment[]> => {
      const entries: UploadItem[] = files.map((file) => ({
        id: `up_${Date.now()}_${seq++}`,
        name: file.name,
        percent: 0,
        status: 'uploading',
        file,
      }));
      setItems((prev) => [...prev, ...entries]);
      const results = await Promise.all(entries.map((entry) => uploadOne(entry)));
      return results.filter((a): a is Attachment => a !== null);
    },
    [uploadOne],
  );

  const retry = useCallback(
    async (id: string) => {
      const item = items.find((it) => it.id === id);
      if (!item) return;
      await uploadOne(item);
    },
    [items, uploadOne],
  );

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  return { items, upload, retry, dismiss };
}
