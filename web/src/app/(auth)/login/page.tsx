'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, ClipboardList, Eye, EyeOff, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * 登录 / 注册页（卡片 15；《UI 主题风格规范》§6.5 印刷品规格）。
 * 恒定 Daylight 纸白：40px 淡网格 + 金色光标聚光 + 玻璃表单卡。
 */
export default function AuthPage() {
  const { user, ready, login, register } = useAuth();
  const router = useRouter();
  const [redirectTo, setRedirectTo] = useState('/board');

  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 已登录 → 进主界面（带 redirect 回跳；硬导航同因，见 onSubmit 注释）
  useEffect(() => {
    if (ready && user) window.location.replace(redirectTo);
  }, [ready, user, redirectTo]);

  // redirect 参数（守卫回跳）
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get('redirect');
    if (r && r.startsWith('/')) setRedirectTo(r);
  }, []);

  // 注册开关
  useEffect(() => {
    api.authConfig().then((c) => {
      setRegistrationOpen(c.registration_open);
      if (!c.registration_open) setTab('login');
    }).catch(() => undefined);
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
        setError('请先勾选同意服务条款与隐私政策');
        return;
      }
    }
    setSubmitting(true);
    try {
      if (tab === 'login') await login(email.trim(), password);
      else await register(email.trim(), password, name.trim());
      // 硬导航：认证状态更新与 router.replace 同刻提交时软导航会被吞（R50/R59 复现两次），
      // window.location.replace 确定性落地；静态导出生效下即普通路由跳转
      window.location.replace(redirectTo);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '网络异常，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-overlay">
      {/* 光标聚光（克制版：仅桌面端） */}
      <div className="cursor-spotlight" aria-hidden />

      <header className="login-topbar">
        <div className="login-brand">
          <span className="login-brand-name">VibeHub</span>
          <span className="login-brand-dot" />
        </div>
        <span className="login-brand-tag">研发上下文总线</span>
      </header>

      <main className="login-main">
        {/* 左：品牌介绍区 */}
        <section className="login-intro">
          <h1 className="login-serif">人类粘贴，AI 消费。</h1>
          <p className="login-sub">
            面向 AI Native 研发团队的双端同步研发上下文总线——
            测试粘贴截图即录缺陷，Cursor / Windsurf 通过 MCP 直读上下文并回填修复状态。
          </p>
          <div className="login-bento">
            <div className="login-bento-card">
              <span className="login-bento-icon"><ClipboardList size={18} strokeWidth={1.8} /></span>
              <b>截图即录</b>
              <p>Ctrl+V 粘贴即成单，两步完成，不为录入打断排查思路。</p>
            </div>
            <div className="login-bento-card">
              <span className="login-bento-icon"><Bot size={18} strokeWidth={1.8} /></span>
              <b>AI 直读</b>
              <p>26 个 MCP 工具：分片读日志、降采样读截图、下载团队技能，Token 经济学校形。</p>
            </div>
            <div className="login-bento-card">
              <span className="login-bento-icon"><RefreshCw size={18} strokeWidth={1.8} /></span>
              <b>双向同步</b>
              <p>AI 修复回填状态与 commit，看板实时归类，全程活动流留痕。</p>
            </div>
          </div>
          <div className="login-code">
            <div className="login-code-head">~/.cursor/mcp.json</div>
            <pre>{`{
  "mcpServers": {
    "vibehub": {
      "url": "http://<服务器IP>:3210/mcp/sse",
      "headers": { "Authorization": "Bearer vhk_live_xxx" }
    }
  }
}`}</pre>
          </div>
        </section>

        {/* 右：表单卡（玻璃 2.0） */}
        <section className="login-card-wrap">
          <div className="login-card">
            {registrationOpen && (
              <div className="login-tabs">
                <button
                  className={cn('login-tab', tab === 'login' && 'active')}
                  onClick={() => { setTab('login'); setError(null); }}
                >
                  登录
                </button>
                <button
                  className={cn('login-tab', tab === 'register' && 'active')}
                  onClick={() => { setTab('register'); setError(null); }}
                >
                  注册
                </button>
                <span className={cn('login-tab-slider', tab === 'register' && 'right')} />
              </div>
            )}

            <div className="login-field">
              <label>邮箱</label>
              <input
                type="email"
                autoComplete="email"
                placeholder="you@team.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
              />
            </div>

            {tab === 'register' && (
              <div className="login-field">
                <label>名字</label>
                <input
                  type="text"
                  autoComplete="nickname"
                  placeholder="团队成员怎么称呼你"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
                />
              </div>
            )}

            <div className="login-field">
              <label>密码</label>
              <div className="login-password">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                  placeholder={tab === 'register' ? '至少 8 位，含字母和数字' : '请输入密码'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
                />
                <button type="button" className="login-eye" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "隐藏密码" : "显示密码"}>
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {tab === 'register' && (
                <div className="login-strength">
                  <div className="login-strength-bars">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className={cn('login-strength-bar', passwordStrength.score > i && passwordStrength.cls)} />
                    ))}
                  </div>
                  <span className="login-strength-text">{passwordStrength.text}</span>
                </div>
              )}
            </div>

            {tab === 'register' && (
              <label className="login-agree">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                我已阅读并同意 <a href="#">服务条款</a> 与 <a href="#">隐私政策</a>
              </label>
            )}

            {error && <p className="login-error">{error}</p>}

            <button className="login-submit" disabled={submitting} onClick={onSubmit}>
              {submitting && <Loader2 className="login-spinner" />}
              {tab === 'login' ? '登 录' : '创建账号'}
            </button>

            {!registrationOpen && (
              <p className="login-closed">系统已关闭自助注册，请联系管理员创建账号</p>
            )}

            <p className="login-icp">首个注册的账号将自动成为团队 Owner · © 2026 VibeHub</p>
          </div>
        </section>
      </main>

      <style jsx global>{`
        .login-overlay {
          position: fixed; inset: 0; z-index: 100;
          background-color: #F7F3EC;
          background-image:
            linear-gradient(rgba(15, 23, 42, 0.045) 1px, transparent 1px),
            linear-gradient(90deg, rgba(15, 23, 42, 0.045) 1px, transparent 1px);
          background-size: 40px 40px, 40px 40px;
          display: flex; flex-direction: column;
          overflow-y: auto; color: #3A4250;
        }
        .cursor-spotlight {
          position: fixed; width: 560px; height: 560px; border-radius: 50%;
          background: radial-gradient(circle, hsla(46,100%,82%,.30) 0%, hsla(38,100%,70%,.20) 22%, hsla(28,100%,60%,.10) 45%, transparent 70%);
          pointer-events: none; opacity: 0; transform: translate(-50%, -50%);
          transition: opacity .5s ease; mix-blend-mode: screen; z-index: 0;
        }
        @media (hover: hover) { .cursor-spotlight { opacity: .5; } }
        .login-topbar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 20px 32px; position: relative; z-index: 1;
        }
        .login-brand { display: flex; align-items: baseline; gap: 6px; }
        .login-brand-name { font-family: "Noto Serif SC", "Source Han Serif SC", serif; font-size: 22px; font-weight: 700; color: #1F355A; letter-spacing: .02em; }
        .login-brand-dot { width: 8px; height: 8px; border-radius: 50%; background: linear-gradient(135deg, #E8C871, #B8924E); }
        .login-brand-tag { font-size: 12px; color: #9AA0A8; letter-spacing: .08em; }
        .login-main {
          flex: 1; display: grid; grid-template-columns: 1.15fr .85fr; gap: 48px;
          align-items: center; padding: 24px 48px 48px; position: relative; z-index: 1;
          max-width: 1280px; margin: 0 auto; width: 100%;
        }
        @media (max-width: 960px) { .login-main { grid-template-columns: 1fr; padding: 16px 20px 32px; } }
        .login-serif {
          font-family: "Noto Serif SC", "Source Han Serif SC", serif;
          font-size: 40px; line-height: 1.25; color: #1F355A; margin: 0 0 16px; font-weight: 700;
        }
        @media (max-width: 960px) { .login-serif { font-size: 30px; } }
        .login-sub { font-size: 15px; line-height: 1.8; color: #5B6577; margin: 0 0 28px; max-width: 34em; }
        .login-bento { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 28px; }
        @media (max-width: 640px) { .login-bento { grid-template-columns: 1fr; } }
        .login-bento-card {
          background: rgba(255,255,255,.92); backdrop-filter: blur(20px) saturate(1.4);
          border: .5px solid rgba(15,23,42,.08); border-radius: 14px; padding: 16px;
        }
        .login-bento-icon { font-size: 20px; }
        .login-bento-card b { display: block; margin: 8px 0 4px; font-size: 14px; color: #1F355A; }
        .login-bento-card p { margin: 0; font-size: 12px; line-height: 1.6; color: #86909C; }
        .login-code {
          background: #12161F; border-radius: 14px; overflow: hidden;
          box-shadow: 0 8px 24px rgba(2,6,16,.18); max-width: 34em;
        }
        .login-code-head {
          padding: 10px 16px; font-size: 11px; color: #6B7688;
          font-family: "JetBrains Mono", SFMono-Regular, Menlo, monospace;
          border-bottom: .5px solid rgba(255,255,255,.08);
        }
        .login-code pre {
          margin: 0; padding: 14px 16px; font-size: 11.5px; line-height: 1.7;
          font-family: "JetBrains Mono", SFMono-Regular, Menlo, monospace; color: #A8B3C4;
          overflow-x: auto;
        }
        .login-card-wrap { display: flex; justify-content: center; }
        .login-card {
          width: 100%; max-width: 400px; position: relative;
          background: rgba(255,255,255,.94); backdrop-filter: blur(20px) saturate(1.4);
          border: .5px solid rgba(15,23,42,.10); border-radius: 20px; padding: 32px 28px;
          box-shadow: 0 12px 32px rgba(15,23,42,.10), 0 2px 6px rgba(15,23,42,.06);
        }
        .login-tabs { position: relative; display: flex; gap: 24px; margin-bottom: 24px; }
        .login-tab {
          background: none; border: none; padding: 6px 2px; font-size: 16px; cursor: pointer;
          color: #9AA0A8; font-weight: 500; transition: color .18s cubic-bezier(.4,0,.2,1);
        }
        .login-tab.active { color: #1F355A; font-weight: 600; }
        .login-tab-slider {
          position: absolute; bottom: 0; left: 0; width: 32px; height: 2px; border-radius: 1px;
          background: #1F355A; transition: transform .22s cubic-bezier(.4,0,.2,1);
        }
        .login-tab-slider.right { transform: translateX(52px); }
        .login-field { margin-bottom: 16px; }
        .login-field label { display: block; font-size: 12px; color: #86909C; margin-bottom: 6px; }
        .login-field input[type="email"], .login-field input[type="text"], .login-field input[type="password"] {
          width: 100%; height: 40px; padding: 0 12px; font-size: 14px;
          border: .5px solid rgba(15,23,42,.16); border-radius: 10px; background: #fff;
          transition: border-color .18s, box-shadow .18s; outline: none; box-sizing: border-box;
        }
        .login-field input:focus { border-color: #1F355A; box-shadow: 0 0 0 3px rgba(31,53,90,.12); }
        .login-password { position: relative; }
        .login-eye {
          position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
          background: none; border: none; cursor: pointer; padding: 4px; display: flex; color: #86909C;
        }
        .login-strength { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
        .login-strength-bars { display: flex; gap: 4px; }
        .login-strength-bar {
          width: 28px; height: 4px; border-radius: 2px; background: #ECECEC; transition: background .18s;
        }
        .login-strength-bar.weak { background: #F2617A; }
        .login-strength-bar.medium { background: #F2A95C; }
        .login-strength-bar.strong { background: #3ECF8E; }
        .login-strength-text { font-size: 11px; color: #9AA0A8; }
        .login-agree { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; color: #86909C; line-height: 1.6; margin-bottom: 8px; }
        .login-agree a { color: #1F355A; }
        .login-error {
          font-size: 12px; color: #D64545; margin: 4px 0 8px;
          animation: vh-shake .16s cubic-bezier(.36,.07,.19,.97);
        }
        @keyframes vh-shake { 0%,100% { transform: none; } 25% { transform: translateX(-3px); } 75% { transform: translateX(3px); } }
        .login-submit {
          width: 100%; height: 44px; border: none; border-radius: 10px; cursor: pointer;
          background: #1F355A; color: #fff; font-size: 15px; font-weight: 600; letter-spacing: .1em;
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          transition: background .18s, transform .1s;
        }
        .login-submit:hover { background: #16294A; }
        .login-submit:active { transform: scale(.98); }
        .login-submit:disabled { opacity: .7; cursor: default; }
        .login-spinner { width: 16px; height: 16px; animation: login-spin .8s linear infinite; }
        @keyframes login-spin { to { transform: rotate(360deg); } }
        .login-closed { text-align: center; font-size: 12px; color: #9AA0A8; margin: 14px 0 0; }
        .login-icp { text-align: center; font-size: 11px; color: #B6BCC4; margin: 16px 0 0; }
      `}</style>
    </div>
  );
}

/** 密码强度：0 弱 / 1 中 / 2 强（≥8 位且字母数字混合） */
function strengthOf(password: string): { score: 0 | 1 | 2; text: string; cls: string } {
  if (!password) return { score: 0, text: '', cls: '' };
  let score = 0;
  if (password.length >= 8) score++;
  if (/[a-zA-Z]/.test(password) && /\d/.test(password)) score++;
  if (password.length >= 12) score++;
  const clamped = Math.min(score, 3) as 0 | 1 | 2;
  const map = {
    0: { score: 0 as const, text: '弱：至少 8 位含字母数字', cls: 'weak' },
    1: { score: 1 as const, text: '中：可以更复杂', cls: 'medium' },
    2: { score: 2 as const, text: '强', cls: 'strong' },
  };
  return map[clamped];
}
