'use client';

import { useState } from 'react';
import { FileArchive, FolderUp, Loader2, Upload } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { Project, SkillDetail, SkillUpload } from '@/lib/api-types';
import { arrangeSkillFiles, formatSize } from '@/lib/skill-files';

interface SkillUploadDialogProps {
  currentProject: Project;
  onClose: () => void;
  onUploaded: (skill: SkillDetail) => void;
}

/** 选好的内容：要么是一个 zip，要么是 SKILL.md + 附带文件 */
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

/** 从 <input type=file> 选中的文件整理出技能；选文件夹时带相对路径 */
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

/** 上传技能：选技能文件夹 / zip 包 / 若干文件（含 SKILL.md）；选择挂当前项目还是全团队通用 */
export function SkillUploadDialog({ currentProject, onClose, onUploaded }: SkillUploadDialogProps) {
  const toast = useToast();
  const [scope, setScope] = useState<'project' | 'global'>('project');
  const [picked, setPicked] = useState<Picked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      const res = await api.uploadSkill(await buildBody(picked, scope === 'global' ? null : currentProject.id));
      toast.success(res.action === 'created' ? `已上传技能 ${res.skill.name}` : `已覆盖同名技能 ${res.skill.name}`);
      onUploaded(res.skill);
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败');
    } finally {
      setBusy(false);
    }
  };

  const pickerCls = 'flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed border-[var(--border-strong)] px-3 py-4 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--brand)] hover:text-[var(--text-primary)]';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg" data-testid="skill-upload">
        <DialogHeader>
          <DialogTitle>上传技能</DialogTitle>
          <DialogDescription>技能就是 Claude Code 的 skill：一个 SKILL.md（开头写 name 和 description），可带脚本、参考文档等附带文件。同一范围里同名的技能会被覆盖。</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          <label className={pickerCls}>
            <FolderUp size={18} />
            选择技能文件夹
            <input type="file" multiple className="hidden" onChange={(e) => onPick(e.target.files)} {...({ webkitdirectory: '' } as Record<string, string>)} data-testid="skill-pick-folder" />
          </label>
          <label className={pickerCls}>
            <FileArchive size={18} />
            选择 zip 包或文件
            <input type="file" multiple accept=".zip,.md,text/*" className="hidden" onChange={(e) => onPick(e.target.files)} data-testid="skill-pick-files" />
          </label>
        </div>

        {picked && <p className="rounded-md bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-secondary)]" data-testid="skill-picked">已选：{describe(picked)}</p>}
        {error && <p className="whitespace-pre-wrap text-xs text-[var(--danger)]" data-testid="skill-upload-error">{error}</p>}

        <fieldset className="flex flex-wrap gap-4 text-xs text-[var(--text-secondary)]">
          <legend className="mb-1.5 text-xs font-medium text-[var(--text-tertiary)]">归属</legend>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input type="radio" name="skill-scope" checked={scope === 'project'} onChange={() => setScope('project')} />
            当前项目「{currentProject.name}」
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input type="radio" name="skill-scope" checked={scope === 'global'} onChange={() => setScope('global')} data-testid="skill-scope-global" />
            全团队通用
          </label>
        </fieldset>

        <div className="flex justify-end gap-2">
          <button className="vh-btn ghost" onClick={onClose}>取消</button>
          <button className="vh-btn" disabled={!picked || busy} onClick={() => void submit()} data-testid="skill-upload-submit">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            上传
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
