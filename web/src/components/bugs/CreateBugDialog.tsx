'use client';

import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Send, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useFileUpload } from '@/hooks/use-file-upload';
import { UploadProgressStrip } from '@/components/files/UploadProgressStrip';
import { BugFormExtras } from './BugFormExtras';
import { TsvImportPanel } from './TsvImportPanel';
import { isBulkPaste, parseTsvRows, type TsvRow } from '@/lib/tsv-import';
import type { Attachment, Bug, BugTemplate } from '@/lib/api-types';

interface CreateBugDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string | null;
  templates: BugTemplate[];
  pendingFiles: File[];
  onConsumePendingFiles: () => void;
  onSubmit: (input: Record<string, unknown>) => Promise<Bug>;
  /** 当前项目 ID（上传归属；卡片 37 起对话框自理上传进度） */
  projectId: string;
}

/**
 * 快速录入（设计文档第 5 节交互流程 + 卡片 50 Excel 式速录）：
 * Ctrl+V 粘贴截图 → 异步上传 → 缩略图预览 → ⌘+Enter 发送；
 * 轻量默认字段（标题必填即可发送）；表格粘贴（TSV 多行）→ 预览 → 批量创建。
 */
export function CreateBugDialog({
  open, onOpenChange, projectName, templates,
  pendingFiles, onConsumePendingFiles, onSubmit, projectId,
}: CreateBugDialogProps) {
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<Bug['severity']>('normal');
  const [assigneeId, setAssigneeId] = useState('');
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [steps, setSteps] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [importRows, setImportRows] = useState<TsvRow[]>([]);
  const [importing, setImporting] = useState(false);
  const uploadQ = useFileUpload(projectId);
  // 触屏设备无剪贴板粘贴：入口文案按指针能力区分（卡片 38）
  const [coarsePointer, setCoarsePointer] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    setCoarsePointer(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setCoarsePointer(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const uploading = uploadQ.items.some((i) => i.status === 'uploading');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => titleRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);
  // 打开时加载成员（指派下拉；失败静默降级）
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api.listUsers()
      .then((us) => {
        if (!cancelled) setMembers(us.filter((u) => u.status === 'active').map((u) => ({ id: u.id, name: u.name })));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [open]);

  // 外部（全局 Ctrl+V）注入的文件
  useEffect(() => {
    if (!open || pendingFiles.length === 0) return;
    void upload(pendingFiles);
    onConsumePendingFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pendingFiles]);

  async function upload(files: File[]) {
    setError(null);
    const uploaded = await uploadQ.upload(files);
    setAttachments((prev) => [...prev, ...uploaded]);
    titleRef.current?.focus();
  }

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    const fields = tpl.fields as { severity?: string; steps_to_reproduce?: string };
    if (fields.severity) setSeverity(fields.severity as Bug['severity']);
    if (fields.steps_to_reproduce && !steps) setSteps(fields.steps_to_reproduce);
  };

  // 粘贴分流（卡片 50）：文件 → 上传；表格文本 → 批量导入预览；单行文本 → 回填标题
  const onPasteText = (text: string) => {
    if (!text.trim()) return;
    if (isBulkPaste(text)) {
      setImportRows(parseTsvRows(text));
      return;
    }
    if (!title.trim()) setTitle(text.trim());
  };

  const runImport = async () => {
    const valid = importRows.filter((r) => !r.error);
    setImporting(true);
    let okCount = 0;
    const failures: string[] = [];
    for (const row of valid) {
      try {
        await onSubmit({
          title: row.title,
          severity: row.severity ?? severity,
          steps_to_reproduce: row.steps,
          assignee_id: assigneeId || null,
          ...(templateId ? { template_id: templateId } : {}),
        });
        okCount += 1;
      } catch (e) {
        failures.push(`${row.title}：${e instanceof Error ? e.message : '失败'}`);
      }
    }
    setImporting(false);
    setImportRows([]);
    if (failures.length > 0) {
      setError(`成功 ${okCount} 条，失败 ${failures.length} 条：${failures.join('；')}`);
    }
    if (okCount > 0) onOpenChange(false);
  };

  const submit = async () => {
    if (!title.trim()) {
      setError('请填写缺陷标题');
      titleRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        title: title.trim(),
        severity,
        assignee_id: assigneeId || null,
        steps_to_reproduce: steps.trim() || undefined,
        attachment_ids: attachments.map((a) => a.id),
        ...(templateId ? { template_id: templateId } : {}),
      });
      setTitle('');
      setSteps('');
      setSeverity('normal');
      setAssigneeId('');
      setTemplateId('');
      setAttachments([]);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const inImportMode = importRows.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImagePlus className="h-4 w-4 text-[var(--gold)]" />
            快速录入缺陷
          </DialogTitle>
          <p className="text-xs text-[var(--text-tertiary)]">
            当前项目：{projectName ?? '未选择'} · 粘贴截图 · ⌘+Enter 发送 · 支持从 Excel 复制多行粘贴
          </p>
        </DialogHeader>

        {inImportMode ? (
          <TsvImportPanel rows={importRows} importing={importing} onConfirm={() => void runImport()} onCancel={() => setImportRows([])} />
        ) : (
        <div className="space-y-3" onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.length) {
            e.preventDefault();
            void upload(files);
            return;
          }
          const text = e.clipboardData.getData('text/plain');
          if (text) {
            e.preventDefault();
            onPasteText(text);
          }
        }}>
          {/* 粘贴区 */}
          <div
            className="flex min-h-[92px] flex-wrap items-center gap-2 rounded-md border border-dashed border-[var(--border-strong)] p-2"
            data-testid="paste-dropzone"
          >
            {attachments.length === 0 && !uploading && (
              <div className="flex w-full flex-col items-center justify-center gap-2 px-2 py-3 text-xs text-[var(--text-tertiary)]">
                {coarsePointer ? (
                  <>
                    <span>点下方按钮选择截图或文件</span>
                    <label className="vh-btn cursor-pointer text-xs" data-testid="mobile-pick-file">
                      <ImagePlus size={14} />
                      选择截图/文件
                      <input
                        type="file"
                        multiple
                        accept="image/*,text/plain,.log,.json,.md,.txt"
                        className="hidden"
                        onChange={(e) => {
                          const files = Array.from(e.target.files ?? []);
                          if (files.length) void upload(files);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <span className="text-center">在此处 Ctrl+V 粘贴截图，或从 Excel 复制多行粘贴</span>
                  </>
                )}
              </div>
            )}
            {uploading && (
              <div className="flex w-full items-center justify-center gap-2 text-xs text-[var(--text-tertiary)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                上传中…
              </div>
            )}
            {attachments.map((a) => (
              <div key={a.id} className="group relative h-20 w-20 overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
                {a.file_type.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.public_url ?? ''} alt={a.file_name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center p-1 text-center text-[10px] text-[var(--text-tertiary)]">{a.file_name}</div>
                )}
                <button
                  className="absolute right-1 top-1 rounded bg-black/60 p-0.5 opacity-0 transition-opacity group-hover:opacity-100 cursor-pointer"
                  onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                >
                  <Trash2 className="h-3 w-3 text-white" />
                </button>
              </div>
            ))}
          </div>
          {uploadQ.items.length > 0 && (
            <div className="mt-1.5">
              <UploadProgressStrip items={uploadQ.items} onRetry={(id) => void uploadQ.retry(id)} onDismiss={uploadQ.dismiss} />
            </div>
          )}

          <input
            ref={titleRef}
            className="flex h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-3 text-sm outline-none transition-colors placeholder:text-[var(--text-tertiary)] focus:border-[var(--brand)]"
            placeholder="缺陷标题（两句核心描述即可，其他都能省）"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && submit()}
            data-testid="bug-title-input"
          />

          {/* 更多选项（卡片 50：默认轻量，复杂字段收进折叠区） */}
          <BugFormExtras
            steps={steps}
            onStepsChange={setSteps}
            severity={severity}
            onSeverityChange={setSeverity}
            assigneeId={assigneeId}
            onAssigneeChange={setAssigneeId}
            members={members}
            templateId={templateId}
            templates={templates}
            onTemplateChange={applyTemplate}
          />

          <div className="flex justify-end">
            <button className="vh-btn" disabled={submitting} onClick={submit} data-testid="bug-submit">
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              发送
              <span className="vh-kbd">⌘↵</span>
            </button>
          </div>

          {error && <p className="animate-[vh-shake_160ms_var(--ease)] text-xs text-[var(--danger)]">{error}</p>}
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
