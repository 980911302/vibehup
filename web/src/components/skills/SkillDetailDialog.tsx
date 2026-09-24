'use client';

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Download, FileText, Loader2, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { Project, SkillDetail, SkillFileContent } from '@/lib/api-types';
import { formatSize, stripFrontmatter } from '@/lib/skill-files';

interface SkillDetailDialogProps {
  skillId: string;
  canEdit: boolean;
  projects: Project[];
  onClose: () => void;
  /** 修改归属或删除后通知列表刷新 */
  onChanged: () => void;
}

async function saveBlob(blob: Blob, fileName: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 技能详情：描述、SKILL.md 正文、附带文件查看；下载 zip、调整归属、删除 */
export function SkillDetailDialog({ skillId, canEdit, projects, onClose, onChanged }: SkillDetailDialogProps) {
  const toast = useToast();
  const [skill, setSkill] = useState<SkillDetail | null>(null);
  const [openFile, setOpenFile] = useState<SkillFileContent | null>(null);

  useEffect(() => {
    api.getSkill(skillId).then(setSkill).catch((e) => {
      toast.error(e instanceof Error ? e.message : '技能加载失败');
      onClose();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillId]);

  const download = async () => {
    try {
      const { blob, fileName } = await api.downloadSkill(skillId);
      await saveBlob(blob, fileName ?? `${skill?.name ?? 'skill'}.zip`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '下载失败');
    }
  };

  const viewFile = async (path: string) => {
    try {
      setOpenFile(await api.getSkillFile(skillId, path));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '文件读取失败');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl" data-testid="skill-detail">
        {!skill ? (
          <div className="flex items-center justify-center py-10 text-[var(--text-tertiary)]"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-mono">{skill.name}</DialogTitle>
              <DialogDescription>{skill.description}</DialogDescription>
            </DialogHeader>
            <p className="rounded-md bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-tertiary)]">
              IDE 里的 AI 通过 MCP 使用：<code className="text-[var(--text-secondary)]">list_skills</code> 查看、
              <code className="text-[var(--text-secondary)]">download_skill name=&quot;{skill.name}&quot;</code> 下载到 .claude/skills/{skill.name}/
            </p>
            <div className="grid max-h-[52vh] grid-cols-1 gap-3 overflow-hidden md:grid-cols-[230px_1fr]">
              <FileList skill={skill} active={openFile?.path ?? 'SKILL.md'} onSelect={(p) => (p === 'SKILL.md' ? setOpenFile(null) : void viewFile(p))} />
              <div className="min-w-0 overflow-y-auto rounded-md border border-[var(--border-subtle)] p-3" data-testid="skill-content">
                {openFile ? <FileView file={openFile} /> : (
                  <div className="vh-note-prose"><ReactMarkdown remarkPlugins={[remarkGfm]}>{stripFrontmatter(skill.content)}</ReactMarkdown></div>
                )}
              </div>
            </div>
            <SkillFooter skill={skill} canEdit={canEdit} projects={projects} onDownload={download} onChanged={(s) => {
              if (s) setSkill(s);
              onChanged();
              if (!s) onClose();
            }} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FileList({ skill, active, onSelect }: { skill: SkillDetail; active: string; onSelect: (path: string) => void }) {
  const entries = [{ path: 'SKILL.md', size: new Blob([skill.content]).size }, ...skill.files];
  return (
    <ul className="space-y-0.5 overflow-y-auto text-xs" data-testid="skill-files">
      {entries.map((f) => (
        <li key={f.path}>
          <button
            type="button"
            className={`flex w-full cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-left ${active === f.path ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'}`}
            onClick={() => onSelect(f.path)}
          >
            <FileText size={12} className="shrink-0" />
            <span className="flex-1 truncate font-mono" title={f.path}>{f.path}</span>
            <span className="text-[10px] text-[var(--text-tertiary)]">{formatSize(f.size)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function FileView({ file }: { file: SkillFileContent }) {
  if (!file.is_text) return <p className="text-xs text-[var(--text-tertiary)]">二进制文件（{formatSize(file.size)}），下载 zip 后查看</p>;
  return <pre className="whitespace-pre-wrap break-words font-mono text-xs text-[var(--text-secondary)]">{file.content}</pre>;
}

interface FooterProps {
  skill: SkillDetail;
  canEdit: boolean;
  projects: Project[];
  onDownload: () => Promise<void>;
  /** 传新详情 = 已修改；传 null = 已删除 */
  onChanged: (skill: SkillDetail | null) => void;
}

function SkillFooter({ skill, canEdit, projects, onDownload, onChanged }: FooterProps) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const move = async (value: string) => {
    try {
      onChanged(await api.setSkillProject(skill.id, value || null));
      toast.success(value ? '已改为挂在该项目下' : '已改为全团队通用');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '修改失败');
    }
  };
  const remove = async () => {
    try {
      await api.deleteSkill(skill.id);
      toast.success(`已删除技能 ${skill.name}`);
      onChanged(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
      <button className="vh-btn h-8 text-xs" onClick={() => void onDownload()} data-testid="skill-download"><Download size={13} />下载 zip</button>
      {canEdit && (
        <select className="h-8 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-2 text-xs outline-none" value={skill.project_id ?? ''} onChange={(e) => void move(e.target.value)} title="归属" data-testid="skill-scope-select">
          <option value="">全团队通用</option>
          {projects.map((p) => <option key={p.id} value={p.id}>项目：{p.name}</option>)}
        </select>
      )}
      <div className="flex-1" />
      {canEdit && (confirming ? (
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          删除后无法恢复，确定删除？
          <button className="vh-btn h-8 bg-[var(--danger)] text-xs" onClick={() => void remove()} data-testid="skill-delete-confirm">确认删除</button>
          <button className="vh-btn ghost h-8 text-xs" onClick={() => setConfirming(false)}>取消</button>
        </div>
      ) : (
        <button className="vh-btn ghost h-8 text-xs text-[var(--danger)]" onClick={() => setConfirming(true)} data-testid="skill-delete"><Trash2 size={13} />删除</button>
      ))}
    </div>
  );
}
