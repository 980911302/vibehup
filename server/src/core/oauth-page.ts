import fs from 'node:fs';
import path from 'node:path';
import { oauthPageStyles } from './oauth-page-styles.js';

export interface OAuthPageData {
  nonce: string;
  scopes: string[];
  clientName: string;
  account?: string;
  error?: string;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Read links from the deployed frontend so OAuth uses the exact same design tokens. */
function frontendThemeLinks(): string {
  const roots = ['../web/out', 'web/out', 'web-dist'].map((p) => path.resolve(process.cwd(), p));
  const root = roots.find((p) => fs.existsSync(path.join(p, 'index.html')));
  if (!root) return '';
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  return [...html.matchAll(/<link\b[^>]*>/gi)].flatMap(([tag]) => {
    if (!/rel=["']stylesheet["']/.test(tag)) return [];
    const href = /href=["']([^"']+)["']/.exec(tag)?.[1];
    return href && /^\/_next\/static\/css\/[\w.-]+\.css$/.test(href)
      ? [`<link rel="stylesheet" href="${escapeHtml(href)}">`] : [];
  }).join('');
}

// Lucide line icon paths (ISC); inline SVG keeps this server-rendered page dependency-free.
const icons = {
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
  user: '<path d="M20 21v-2a7 7 0 0 0-14 0v2"/><circle cx="13" cy="7" r="4"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  folder: '<path d="M20 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z"/>',
  task: '<path d="m3 6 2 2 4-4M13 6h8M3 13h6m4 0h8M3 20h6m4 0h8"/>',
  bug: '<path d="M8 2l1.5 2M16 2l-1.5 2M3 9h4m10 0h4M3 15h4m10 0h4M5 4l3 3m8 0 3-3M5 20l3-3m8 0 3 3M12 8v12"/><rect x="7" y="4" width="10" height="16" rx="5"/>',
  note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
  file: '<path d="m21.4 11.6-9.2 9.2a6 6 0 0 1-8.5-8.5l10-10a4 4 0 0 1 5.7 5.7l-10 10a2 2 0 0 1-2.8-2.8l9.2-9.2"/>',
  skill: '<path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7ZM20 2v4m-2-2h4"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>',
};
type Icon = keyof typeof icons;
function icon(name: Icon, className = ''): string {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}

function permissions(scopes: string[]): string {
  const rows: Array<{ scope: string; readScope?: string; readDetail?: string; combinedDetail?: string; title: string; detail: string; icon: Icon }> = [
    { scope: 'context:read', title: '项目上下文', detail: '读取项目、缺陷、随手记及团队技能。', icon: 'folder' },
    { scope: 'task:write', readScope: 'task:read', title: '任务', readDetail: '查看任务列表、描述、标签及附件信息。', detail: '创建、修改、流转及删除任务。', combinedDetail: '查看、新建、编辑、流转和删除任务。', icon: 'task' },
    { scope: 'bug:write', title: '缺陷管理', detail: '新建缺陷、流转状态、评论及删除缺陷。', icon: 'bug' },
    { scope: 'note:write', title: '随手记管理', detail: '新建、编辑、置顶及删除随手记。', icon: 'note' },
    { scope: 'attachment:write', readScope: 'attachment:read', title: '文件', readDetail: '查看截图，读取文本和日志附件。', detail: '上传及删除项目中的附件。', combinedDetail: '查看截图与日志，上传和删除附件。', icon: 'file' },
    { scope: 'skill:write', title: '技能管理', detail: '上传、更新及删除团队技能。', icon: 'skill' },
  ];
  return rows.filter((row) => scopes.includes(row.scope) || (row.readScope && scopes.includes(row.readScope))).map((row) => {
    const write = row.scope.endsWith(':write') && scopes.includes(row.scope);
    const read = row.readScope && scopes.includes(row.readScope);
    const detail = read && write ? row.combinedDetail : `${read ? row.readDetail : ''}${scopes.includes(row.scope) ? row.detail : ''}`;
    return `<li class="permission"><span class="permission-icon">${icon(row.icon)}</span><div class="permission-copy"><div class="permission-title"><span>${row.title}</span><span class="badge ${write ? 'write' : ''}">${write ? read ? '读写' : '可修改' : '只读'}</span></div><p>${detail}</p></div></li>`;
  }).join('');
}

function loginForm(data: OAuthPageData): string {
  const app = escapeHtml(data.clientName);
  const error = data.error ? `<div class="error" id="auth-error" role="alert">${icon('alert')}<span>${escapeHtml(data.error)}</span></div>` : '';
  return `<section class="form-panel" aria-labelledby="form-title">
    <div class="connection"><span class="app-tile vibe">V</span>${icon('arrow')}<span class="app-tile">AI</span><span class="connection-name">正在连接到<strong>${app}</strong></span></div>
    <h2 id="form-title" class="form-title">登录并授权</h2><p class="form-subtitle">使用你的 VibeHub 账号，完成此次连接。<br>授权成功后将返回发起连接的应用。<a class="mobile-permissions" href="#permissions-title">查看此次申请的权限 ${icon('arrow')}</a></p>
    ${error}<form action="/oauth/authorize" method="post" id="auth-form">
      <input type="hidden" name="nonce" value="${escapeHtml(data.nonce)}">
      <div class="field"><label class="field-label" for="account">账号</label><div class="input-wrap">${icon('user', 'field-icon')}<input id="account" name="email" type="text" autocomplete="username" placeholder="输入你的账号或邮箱" value="${escapeHtml(data.account ?? '')}" required maxlength="320" ${data.error ? 'aria-describedby="auth-error" aria-invalid="true"' : ''}></div><p class="field-hint">使用管理员分配的登录账号即可。</p></div>
      <div class="field"><label class="field-label" for="password">密码</label><div class="input-wrap">${icon('lock', 'field-icon')}<input id="password" name="password" type="password" autocomplete="current-password" placeholder="输入 VibeHub 密码" required><button class="eye" id="password-toggle" type="button" aria-label="显示密码" aria-pressed="false">${icon('eye')}</button></div></div>
      <label class="consent"><input type="checkbox" name="approve" required><span>我已了解此次授权范围，同意将所列权限授予 <strong>${app}</strong>。</span></label>
      <div class="actions"><button class="button primary" type="submit" id="authorize-button">登录并授权 ${icon('arrow')}</button><button class="button" type="submit" name="action" value="deny" formnovalidate>取消</button></div>
    </form><p class="after-form">还没有账号？<strong>请联系你的 VibeHub 管理员</strong></p>
  </section>`;
}

const interactions = `
const password = document.getElementById('password');
const toggle = document.getElementById('password-toggle');
toggle.style.display = 'grid';
toggle.addEventListener('click', () => {
  const show = password.type === 'password';
  password.type = show ? 'text' : 'password';
  toggle.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
  toggle.setAttribute('aria-pressed', String(show));
});
document.getElementById('auth-form').addEventListener('submit', (event) => {
  if (event.submitter?.value === 'deny') return;
  const button = document.getElementById('authorize-button');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = '正在连接…';
});`;

export function renderOAuthPage(data: OAuthPageData): string {
  const write = data.scopes.some((s) => s.endsWith(':write'));
  return `<!doctype html><html lang="zh-CN" data-theme="daylight"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="referrer" content="no-referrer"><title>连接 VibeHub · 账号授权</title>
  ${frontendThemeLinks()}<style>${oauthPageStyles}</style></head><body class="vh-auth">
  <header class="topbar"><a class="brand" href="/" aria-label="VibeHub 首页">VibeHub<span class="brand-dot" aria-hidden="true"></span><span class="top-label">账户连接</span></a><span class="secure-label">${icon('shield')}安全连接</span></header>
  <main><div class="auth-card"><aside class="context" aria-labelledby="connection-title">
    <p class="eyebrow">让上下文连接起来</p><h1 id="connection-title">你的项目，<br>与 AI 同步。</h1><p class="intro">连接 ${escapeHtml(data.clientName)}，让任务、缺陷和研发上下文在同一个工作流中协作。</p>
    <div class="permission-heading"><h2 id="permissions-title">此次申请的权限</h2><span class="permission-count">${data.scopes.length} 项</span></div><ul class="permissions">${permissions(data.scopes)}</ul>
    <p class="access-note">${icon('shield')}<span>${write ? '本次包含创建、修改或删除数据的权限，请确认授权范围后继续。' : '本次仅申请读取权限，可访问上方列出的项目内容。'}</span></p>
  </aside>${loginForm(data)}</div><footer class="footer"><span>授权后，可随时在 VibeHub「密钥」中撤销。</span><span>${icon('lock')}由 VibeHub 处理账号验证</span></footer></main>
  <script>${interactions}</script></body></html>`;
}
