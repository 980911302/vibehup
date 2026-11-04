'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, FolderPlus, KeyRound, Link2, PartyPopper } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useVibeHub } from '@/hooks/use-vibehub';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'vibehub_onboarded';

/** 三步首启向导（卡片 33）：建项目（slug 人话解释）→ 创建 MCP 密钥引导 → 邀请成员 */
export function OnboardingWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const store = useVibeHub();
  const toast = useToast();
  const router = useRouter();

  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugDirty, setSlugDirty] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  const hasProjects = store.projects.length > 0;

  // slug 自动建议：名称的小写连字符形式（AI 靠它匹配仓库，允许手改）
  useEffect(() => {
    if (slugDirty) return;
    const suggestion = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '');
    setSlug(suggestion);
  }, [name, slugDirty]);

  const inviteLink = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/login`;
  }, []);

  const finish = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // 隐私模式：不阻断
    }
    onOpenChange(false);
  };

  const createProject = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await store.createProject(name.trim(), slug.trim() || undefined);
      setStep(2);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '创建失败，请调整 slug 后重试');
    } finally {
      setCreating(false);
    }
  };

  const steps = [
    { n: 1, label: '建项目' },
    { n: 2, label: '接 AI' },
    { n: 3, label: '邀队友' },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : finish())}>
      <DialogContent className="max-w-lg" data-testid="onboarding-wizard">
        <DialogHeader>
          <DialogTitle>欢迎使用 VibeHub</DialogTitle>
          <DialogDescription>三步完成初始设置，之后随时可以在顶部导航找到这些功能</DialogDescription>
        </DialogHeader>

        {/* 步骤指示 */}
        <div className="mb-2 flex items-center gap-2" data-testid="onboarding-steps">
          {steps.map((s, i) => (
            <div key={s.n} className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold',
                    step >= s.n ? 'bg-[var(--gold-bg)] text-[var(--gold)]' : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]',
                  )}
                >
                  {step > s.n ? <Check size={11} /> : s.n}
                </span>
                <span className={cn('text-xs', step >= s.n ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]')}>{s.label}</span>
              </div>
              {i < steps.length - 1 && <span className="h-px w-8 bg-[var(--border-subtle)]" />}
            </div>
          ))}
        </div>

        {/* 第一步：建项目 */}
        {step === 1 && (
          <div className="space-y-3">
            {hasProjects ? (
              <>
                <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                  你已经创建了 {store.projects.length} 个项目，这一步可以直接跳过。
                </p>
                <div className="flex justify-end">
                  <button className="vh-btn" onClick={() => setStep(2)} data-testid="onboarding-skip-project">
                    下一步
                  </button>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">项目名称</label>
                  <input
                    className="h-9 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-2.5 text-sm outline-none focus:border-[var(--brand)]"
                    placeholder="例如：订单中心"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    data-testid="onboarding-project-name"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">项目标识（slug）</label>
                  <input
                    className="h-9 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-2.5 font-mono text-xs outline-none focus:border-[var(--brand)]"
                    placeholder="order-center"
                    value={slug}
                    onChange={(e) => {
                      setSlugDirty(true);
                      setSlug(e.target.value);
                    }}
                    data-testid="onboarding-project-slug"
                  />
                  <p className="mt-1 text-xs leading-relaxed text-[var(--text-tertiary)]">
                    这是给 AI 用的项目代号：IDE 里的 Agent 靠它找到对应上下文，一般填你的代码仓库名或目录名。
                  </p>
                </div>
                <div className="flex justify-end">
                  <button
                    className="vh-btn"
                    onClick={() => void createProject()}
                    disabled={creating || !name.trim()}
                    data-testid="onboarding-create-project"
                  >
                    <FolderPlus size={14} />
                    {creating ? '创建中…' : '创建并继续'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* 第二步：创建 MCP 密钥 */}
        {step === 2 && (
          <div className="space-y-3">
            <div className="rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
              <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                <KeyRound size={14} className="text-[var(--gold)]" />
                让 Cursor / Windsurf 直连你的项目上下文
              </div>
              <p className="text-xs leading-relaxed text-[var(--text-tertiary)]">
                MCP 密钥是 AI 读取缺陷、便签与附件的凭证。创建时只填名称，权限自动继承你的角色，不需要再选 scope。
              </p>
            </div>
            <div className="flex items-center justify-between">
              <button
                className="text-xs text-[var(--text-tertiary)] underline-offset-2 hover:underline"
                onClick={() => setStep(3)}
                data-testid="onboarding-skip-key"
              >
                稍后再说
              </button>
              <button
                className="vh-btn"
                onClick={() => {
                  finish();
                  router.push('/keys');
                }}
                data-testid="onboarding-goto-keys"
              >
                去创建密钥
              </button>
            </div>
          </div>
        )}

        {/* 第三步：邀请成员 */}
        {step === 3 && (
          <div className="space-y-3">
            <div className="rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
              <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                <Link2 size={14} className="text-[var(--gold)]" />
                把注册链接发给队友
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-md bg-[var(--bg-page)] px-2 py-1.5 text-xs text-[var(--text-secondary)]">{inviteLink}</code>
                <button
                  className="vh-btn ghost"
                  onClick={() => {
                    void navigator.clipboard.writeText(inviteLink).then(() => {
                      setCopied(true);
                      toast.success('链接已复制');
                      setTimeout(() => setCopied(false), 2000);
                    });
                  }}
                  data-testid="onboarding-copy-link"
                >
                  <Copy size={13} />
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-[var(--text-tertiary)]">第一位注册的成员会成为 Owner；管理员可在成员页调整角色。</p>
            </div>
            <div className="flex justify-end">
              <button className="vh-btn" onClick={finish} data-testid="onboarding-finish">
                <PartyPopper size={14} />
                进入今日
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
