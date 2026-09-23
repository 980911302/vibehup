'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, KeyRound, Loader2, RotateCw, ShieldAlert, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { ApiKeyView } from '@/lib/api-types';

const SCOPE_TOOLS: Record<string, string[]> = {
  'context:read': ['get_project_context', 'list_bugs', 'get_bug_detail', 'list_notes', 'search', 'list_tasks'],
  'attachment:read': ['read_attachment_text', 'inspect_image_asset'],
  'attachment:write': ['upload_attachment'],
  'bug:write': ['update_bug_status', 'create_bug', 'add_bug_comment'],
  'note:write': ['append_scratchpad'],
  'task:read': ['list_tasks'],
  'task:write': ['update_task'],
  admin: ['purge_trash'],
};

/** 创建密钥向导（步骤 07 §7.5：三步，第 3 步一次性明文） */
export function CreateKeyWizard({
  open, onOpenChange, onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['context:read']);
  const [expiresInDays, setExpiresInDays] = useState<number | null>(90);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ key: string; view: ApiKeyView } | null>(null);
  const [copied, setCopied] = useState<'key' | 'config' | null>(null);

  useEffect(() => {
    if (open) {
      setStep(1);
      setName('');
      setScopes(['context:read']);
      setExpiresInDays(90);
      setResult(null);
      setCopied(null);
    }
  }, [open]);

  const toggleScope = (s: string) => {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const r = await api.createApiKey({ name: name.trim(), scopes, expires_in_days: expiresInDays });
      setResult({ key: r.key, view: r.api_key });
      setStep(3);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const mcpConfig = useMemo(() => {
    if (!result) return '';
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:3210';
    return JSON.stringify(
      {
        mcpServers: {
          vibehub: {
            url: `${base}/mcp/sse`,
            headers: { Authorization: `Bearer ${result.key}` },
          },
        },
      },
      null,
      2,
    );
  }, [result]);

  const copy = async (text: string, which: 'key' | 'config') => {
    await navigator.clipboard.writeText(text);
    setCopied(which);
    toast.success(which === 'key' ? '密钥已复制' : 'MCP 配置已复制');
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => onOpenChange(false)}>
      <div className="w-[520px] rounded-[20px] border border-[var(--border-strong)] bg-[var(--bg-panel)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="key-wizard">
        {/* 步骤指示器 */}
        <div className="mb-5 flex items-center gap-2">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex flex-1 items-center gap-2">
              <span className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
                step >= s ? 'bg-[var(--brand)] text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]',
              )}>{s}</span>
              {s < 3 && <div className={cn('h-px flex-1', step > s ? 'bg-[var(--brand)]' : 'bg-[var(--border-subtle)]')} />}
            </div>
          ))}
        </div>

        {step === 1 && (
          <>
            <h3 className="mb-1 text-base font-semibold">名称</h3>
            <p className="mb-4 text-xs text-[var(--text-tertiary)]">给密钥起个名字，方便在用量审计中识别（如 cursor-main）</p>
            <input
              autoFocus
              className="mb-4 h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-3 text-sm outline-none focus:border-[var(--brand)]"
              placeholder="密钥名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="flex justify-end">
              <button className="vh-btn" disabled={!name.trim()} onClick={() => setStep(2)}>下一步</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h3 className="mb-1 text-base font-semibold">权限范围（Scopes）</h3>
            <p className="mb-4 text-xs text-[var(--text-tertiary)]">最小权限原则：默认仅读取上下文，写操作需显式授予</p>
            <div className="mb-4 space-y-2">
              {Object.entries(SCOPE_TOOLS).map(([scope, tools]) => (
                <label key={scope} className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[var(--border-subtle)] p-2.5 hover:bg-[var(--bg-elevated)]">
                  <input type="checkbox" className="mt-0.5" checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} />
                  <div>
                    <p className="text-[13px] font-medium text-[var(--text-primary)]">{scope}</p>
                    <p className="text-[11px] text-[var(--text-tertiary)]">{tools.join(' · ')}</p>
                  </div>
                </label>
              ))}
            </div>
            <div className="mb-4 flex items-center gap-3 text-xs">
              <span className="text-[var(--text-tertiary)]">有效期</span>
              {[30, 90, null].map((d) => (
                <button
                  key={String(d)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 transition-colors cursor-pointer',
                    expiresInDays === d ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]' : 'border-[var(--border-strong)] text-[var(--text-tertiary)]',
                  )}
                  onClick={() => setExpiresInDays(d)}
                >
                  {d === null ? '永久' : `${d} 天`}
                </button>
              ))}
            </div>
            <div className="flex justify-between">
              <button className="vh-btn ghost" onClick={() => setStep(1)}>上一步</button>
              <button className="vh-btn" disabled={scopes.length === 0 || submitting} onClick={submit}>
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                创建密钥
              </button>
            </div>
          </>
        )}

        {step === 3 && result && (
          <>
            <h3 className="mb-1 text-base font-semibold">密钥已创建</h3>
            <p className="mb-3 text-xs text-[var(--danger)]">请立即复制保存——关闭此窗口后不可再查看，遗失只能轮换。</p>
            <div className="mb-4 rounded-[14px] border-2 border-[var(--gold)] bg-[var(--gold-bg)] p-3">
              <code className="block break-all font-mono text-[13px] text-[var(--gold-bright)]">{result.key}</code>
              <button className="mt-2 flex items-center gap-1 text-xs text-[var(--gold)] cursor-pointer" onClick={() => void copy(result.key, 'key')}>
                {copied === 'key' ? <Check size={12} /> : <Copy size={12} />}
                {copied === 'key' ? '已复制' : '复制密钥'}
              </button>
            </div>

            <p className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">MCP 配置（添加到 ~/.cursor/mcp.json）</p>
            <div className="relative mb-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-page)] p-3">
              <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]">{mcpConfig}</pre>
              <button className="absolute right-2 top-2 flex items-center gap-1 rounded-md border border-[var(--border-strong)] px-2 py-1 text-[11px] text-[var(--text-secondary)] cursor-pointer hover:bg-[var(--bg-elevated)]" onClick={() => void copy(mcpConfig, 'config')}>
                {copied === 'config' ? <Check size={11} /> : <Copy size={11} />}
                复制
              </button>
            </div>

            <div className="flex justify-end">
              <button className="vh-btn" onClick={() => { onCreated(); onOpenChange(false); }}>完成</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 密钥用量图表（近 30 天按日调用） */
export function KeyUsageChart({ keyId }: { keyId: string }) {
  const [usage, setUsage] = useState<{ total: number; points: { day: string; calls: number }[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.keyUsage(keyId, 30);
        if (!cancelled) setUsage(data);
      } catch {
        // 忽略
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [keyId]);

  if (loading) {
    return <div className="flex h-32 items-center justify-center text-[var(--text-tertiary)]"><Loader2 className="h-4 w-4 animate-spin" /></div>;
  }
  if (!usage || usage.points.length === 0) {
    return <p className="py-8 text-center text-xs text-[var(--text-tertiary)]">近 30 天暂无调用记录</p>;
  }

  const max = Math.max(...usage.points.map((p) => p.calls), 1);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-[var(--text-primary)]">{usage.total}</span>
        <span className="text-xs text-[var(--text-tertiary)]">近 30 天总调用</span>
      </div>
      <div className="flex h-24 items-end gap-1" data-testid="usage-chart">
        {usage.points.map((p) => (
          <div key={p.day} className="group relative flex flex-1 flex-col items-center">
            <div
              className="w-full rounded-t bg-[var(--gold)]/70 transition-all hover:bg-[var(--gold)]"
              style={{ height: `${Math.max(2, (p.calls / max) * 100)}%` }}
              title={`${p.day}: ${p.calls} 次`}
            />
            <span className="mt-1 hidden text-[9px] text-[var(--text-tertiary)] group-hover:block">{p.day.slice(5)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export { SCOPE_TOOLS };
