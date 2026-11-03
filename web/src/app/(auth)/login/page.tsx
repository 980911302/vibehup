'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bug, Eye, EyeOff, KeyRound, Loader2, Sparkles, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api, ApiError } from '@/lib/api';
import { Feature } from '@/components/auth/Feature';
import { strengthOf } from '@/lib/password-strength';
import { cn } from '@/lib/utils';

const inputClass =
  'h-11 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-page)] px-3 text-base text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent)]';

/**
 * 登录 / 注册页。恒定纸白（Daylight）：数据密集的工作台之外，登录是一张安静的纸。
 * 不铺渐变、不做装饰动画；表单状态全部内联反馈。
 */
export default function AuthPage() {
  const { user, ready, login, register } = useAuth();
  const router = useRouter();
  const [redirectTo, setRedirectTo] = useState('/today');

  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && user) window.location.replace(redirectTo);
  }, [ready, user, redirectTo]);

  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get('redirect');
    if (r && r.startsWith('/')) setRedirectTo(r);
  }, []);

  useEffect(() => {
    api
      .authConfig()
      .then((c) => {
        setRegistrationOpen(c.registration_open);
        if (!c.registration_open) setTab('login');
      })
      .catch(() => undefined);
  }, []);

  const passwordStrength = strengthOf(password);

  async function onSubmit() {
    setError(null);
    if (!email.trim() || !password) {
      setError('请填写邮箱和密码');
      return;
    }
    if (tab === 'register') {
      if (!name.trim()) {
        setError('请填写名字');
        return;
      }
      if (passwordStrength.score < 2) {
        setError('密码至少 8 位，且同时包含字母和数字');
        return;
      }
      if (!agreed) {
        setError('请先勾选同意团队的使用约定');
        return;
      }
    }
    setSubmitting(true);
    try {
      if (tab === 'login') await login(email.trim(), password);
      else await register(email.trim(), password, name.trim());
      // 硬导航：认证状态更新与软导航同刻提交时会被批处理吞掉（R50/R59）
      window.location.replace(redirectTo);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '网络异常，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div data-theme="daylight" className="h-screen overflow-y-auto bg-[var(--bg-page)] text-[var(--text-primary)]">
      <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-sm font-semibold text-[var(--accent-contrast)]">
              V
            </span>
            <div>
              <p className="t-title-4">VibeHub</p>
              <p className="t-caption-5 text-[var(--text-tertiary)]">AI 同事的工作台</p>
            </div>
          </div>
          <p className="t-caption-5 hidden text-[var(--text-tertiary)] sm:block">自托管 · 团队版</p>
        </header>

        <main className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:py-16">
          {/* 左：一句话 + 三条事实 */}
          <section className="max-w-[680px]">
            <p className="t-caption-4 flex items-center gap-2 text-[var(--accent)]">
              <Sparkles size={14} /> 从记录系统，到行动系统
            </p>
            <h1 className="t-heading-3 mt-3 text-balance">
              人定义问题
              <br />
              AI 接单执行
              <br />
              人只做验收
            </h1>
            <p className="t-body-3 mt-5 max-w-[560px] text-[var(--text-secondary)]">
              VibeHub 把缺陷、任务与项目上下文放在同一个工作台里。AI 通过 MCP 读上下文、回填状态和证据，
              你只需要决定做什么、验收做得对不对。
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <Feature icon={Bug} title="截图即录" body="粘贴截图就成单，不打断排查。" />
              <Feature icon={Sparkles} title="AI 直接接手" body="看板显示谁在干、干了多久。" />
              <Feature icon={ShieldCheck} title="验收才闭环" body="待验收、打回原因、全程留痕。" />
            </div>

            <div className="mt-8 max-w-[560px] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-4">
              <p className="t-caption-4 flex items-center gap-2 text-[var(--text-secondary)]">
                <KeyRound size={14} /> 连接你的 AI 客户端
              </p>
              <pre className="t-mono mt-2 overflow-x-auto text-xs leading-5 text-[var(--text-tertiary)]">{`{
  "mcpServers": {
    "vibehub": {
      "url": "http://<服务器>:3210/mcp/sse",
      "headers": { "Authorization": "Bearer vhk_live_..." }
    }
  }
}`}</pre>
              <p className="t-caption-5 mt-2 text-[var(--text-tertiary)]">
                登录后在「设置 → 我的密钥」创建，每个客户端一把。
              </p>
            </div>
          </section>

          {/* 右：表单 */}
          <section className="w-full max-w-[440px] justify-self-end">
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-2)] sm:p-8">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 className="t-heading-5">{tab === 'login' ? '回到工作台' : '加入团队'}</h2>
                  <p className="t-caption-5 mt-1 text-[var(--text-tertiary)]">
                    {tab === 'login' ? '继续今天还没做完的事。' : '首个注册账号会自动成为团队拥有者。'}
                  </p>
                </div>
                {registrationOpen && (
                  <div className="vh-segmented shrink-0">
                    <button className={cn(tab === 'login' && 'active')} onClick={() => { setTab('login'); setError(null); }}>
                      登录
                    </button>
                    <button className={cn(tab === 'register' && 'active')} onClick={() => { setTab('register'); setError(null); }}>
                      注册
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-6 space-y-4">
                {tab === 'register' && (
                  <label className="block">
                    <span className="t-caption-4 text-[var(--text-secondary)]">名字</span>
                    <input
                      className={cn(inputClass, 'mt-1.5')}
                      type="text"
                      autoComplete="nickname"
                      placeholder="团队成员怎么称呼你"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void onSubmit()}
                    />
                  </label>
                )}

                <label className="block">
                  <span className="t-caption-4 text-[var(--text-secondary)]">邮箱</span>
                  <input
                    className={cn(inputClass, 'mt-1.5')}
                    type="email"
                    autoComplete="email"
                    placeholder="you@team.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void onSubmit()}
                  />
                </label>

                <div className="block">
                  <label htmlFor="auth-password" className="t-caption-4 text-[var(--text-secondary)]">密码</label>
                  <span className="relative mt-1.5 block">
                    <input
                      id="auth-password"
                      className={cn(inputClass, 'pr-11')}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                      placeholder={tab === 'register' ? '至少 8 位，含字母和数字' : '请输入密码'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void onSubmit()}
                    />
                    <button
                      type="button"
                      className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </span>
                  {tab === 'register' && (
                    <span className="mt-2 flex items-center gap-2">
                      <span className="flex gap-1">
                        {[0, 1, 2].map((i) => (
                          <span
                            key={i}
                            className={cn(
                              'h-1 w-8 rounded-full',
                              passwordStrength.score > i
                                ? passwordStrength.score === 2
                                  ? 'bg-[var(--ok)]'
                                  : 'bg-[var(--warn)]'
                                : 'bg-[var(--bg-elevated)]',
                            )}
                          />
                        ))}
                      </span>
                      <span className="t-caption-5 text-[var(--text-tertiary)]">{passwordStrength.text}</span>
                    </span>
                  )}
                </div>

                {tab === 'register' && (
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                    />
                    <span className="t-caption-5 text-[var(--text-tertiary)]">
                      注册即表示同意团队的使用约定；条款与数据政策由团队管理员维护。
                    </span>
                  </label>
                )}

                {error && (
                  <p className="t-caption-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-[var(--danger)]">
                    {error}
                  </p>
                )}

                <button className="vh-btn h-11 w-full" disabled={submitting} onClick={() => void onSubmit()}>
                  {submitting && <Loader2 size={16} className="animate-spin" />}
                  {tab === 'login' ? '登录' : '创建账号'}
                </button>

                {!registrationOpen && (
                  <p className="t-caption-5 rounded-lg bg-[var(--bg-elevated)] px-3 py-2 text-[var(--text-tertiary)]">
                    系统已关闭自助注册，请联系管理员创建账号。
                  </p>
                )}

                <p className="t-caption-5 text-center text-[var(--text-tertiary)]">
                  © 2026 VibeHub · 自托管团队版
                </p>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
