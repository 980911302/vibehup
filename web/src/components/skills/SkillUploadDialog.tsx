'use client';

import { useState } from 'react';
import { FileArchive, FolderUp, Loader2, Upload } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { Project, SkillDetail, SkillUpload } from '@/lib/api-types';
import { arrangeSkillFiles, formatSize } from '@/lib/skill-files';

interface SkillUploadDialogProps {
  currentProject: Project | null;
  mode?: 'project' | 'global';
  onClose: () => void;
  onUploaded: (skill: SkillDetail) => void;
}

type Picked =
  | { kind: 'zip'; file: File }
  | { kind: 'files'; skillMd: File; files: { path: string; file: File }[] };

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function buildBody(picked: Picked, projectId: string | null): Promise<SkillUpload> {
  if (picked.kind === 'zip') return { project_id: projectId, zip_base64: await toBase64(picked.file) };
  const files = await Promise.all(picked.files.map(async (f) => ({ path: f.path, content_base64: await toBase64(f.file) })));
  return { project_id: projectId, skill_md: await picked.skillMd.text(), files };
}

function arrange(list: FileList): Picked | string {
  const all = Array.from(list);
  if (all.length === 1 && all[0].name.toLowerCase().endsWith('.zip')) return { kind: 'zip', file: all[0] };
  const withPath = all.map((file) => Object.assign(file, { path: file.webkitRelativePath || file.name }));
  const arranged = arrangeSkillFiles(withPath);
  if (!arranged) return '没有找到 SKILL.md：技能文件夹里必须有一个 SKILL.md';
  return { kind: 'files', skillMd: arranged.skillMd, files: arranged.files };
}

function describe(picked: Picked): string {
  if (picked.kind === 'zip') return `${picked.file.name}（${formatSize(picked.file.size)}）`;
  const size = picked.files.reduce((n, f) => n + f.file.size, picked.skillMd.size);
  return `SKILL.md + ${picked.files.length} 个附带文件（共 ${formatSize(size)}）`;
}

/** 上传技能：在项目工作区内固定上传到当前项目；在全局设置内上传到团队通用技能库 */
export function SkillUploadDialog({ currentProject, mode = 'project', onClose, onUploaded }: SkillUploadDialogProps) {
  const toast = useToast();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const targetProjectId = mode === 'global' ? null : (currentProject?.id ?? null);

  const onPick = (list: FileList | null) => {
    if (!list?.length) return;
    const r = arrange(list);
    setPicked(typeof r === 'string' ? null : r);
    setError(typeof r === 'string' ? r : null);
  };

  const submit = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.uploadSkill(await buildBody(picked, targetProjectId));
      toast.success(res.action === 'created' ? `已上传技能 ${res.skill.name}` : `已覆盖同名技能 ${res.skill.name}`);
      onUploaded(res.skill);
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败');
    } finally {
      setBusy(false);
    }
  };

  const pickerCls =
    'flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed border-[var(--border-strong)] px-3 py-4 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--brand)] hover:text-[var(--text-primary)]';

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg" data-testid="skill-upload">
        <DialogHeader>
          <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
            <span className="rounded bg-[var(--bg-elevated)] px-2 py-0.5 font-medium text-[var(--text-secondary)]">
              {mode === 'global' ? '团队通用技能库' : `当前项目 · ${currentProject?.name ?? ''}`}
            </span>
          </div>
          <DialogTitle className="mt-1">{mode === 'global' ? '上传团队通用技能' : '上传本项目专属技能'}</DialogTitle>
          <DialogDescription>
            选择含 SKILL.md（含 name 与 description）的技能目录或 zip 包；同一范围内同名技能将自动覆盖更新。
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          <label className={pickerCls}>
            <FolderUp size={18} />
            选择技能文件夹
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => onPick(e.target.files)}
              {...({ webkitdirectory: '' } as Record<string, string>)}
              data-testid="skill-pick-folder"
            />
          </label>
          <label className={pickerCls}>
            <FileArchive size={18} />
            选择 zip 包或文件
            <input
              type="file"
              multiple
              accept=".zip,.md,text/*"
              className="hidden"
              onChange={(e) => onPick(e.target.files)}
              data-testid="skill-pick-files"
            />
          </label>
        </div>

        {picked && (
          <p className="rounded-md bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-secondary)]" data-testid="skill-picked">
            已选：{describe(picked)}
          </p>
        )}
        {error && (
          <p className="whitespace-pre-wrap text-xs text-[var(--danger)]" data-testid="skill-upload-error">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] pt-3">
          <button type="button" className="vh-btn ghost h-8 text-xs" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="vh-btn h-8 text-xs"
            disabled={!picked || busy}
            onClick={() => void submit()}
            data-testid="skill-upload-submit"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            上传
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
