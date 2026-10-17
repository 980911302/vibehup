'use client';

import { useEffect, useMemo, useState } from 'react';
import { Copy, Plug, Terminal } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { ApiKeyView } from '@/lib/api-types';

/**
 * MCP 连接配置面板（R87 用户决定）。
 * 选一把密钥 → 后端解密取回明文（不落前端存储）→ 生成可直接粘贴的 IDE 配置与技能安装命令。
 */
export function McpConfigPanel({ open, keys, onClose }: { open: boolean; keys: ApiKeyView[]; onClose: () => void }) {
  const toast = useToast();
  const [keyId, setKeyId] = useState('');
  const [plain, setPlain] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState('');

  const usable = useMemo(() => keys.filter((k) => k.status === 'active' && k.can_reveal), [keys]);

  useEffect(() => {
    if (typeof window !== 'undefined') setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!open) return;
    // 默认选中第一把可用密钥
    const first = usable[0]?.id ?? '';
    setKeyId((cur) => cur || first);
  }, [open, usable]);

  useEffect(() => {
    if (!open || !keyId) {
      setPlain(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    api
      .revealApiKey(keyId)
      .then((r) => {
        if (!cancelled) setPlain(r.key);
      })
      .catch((e) => {
        if (!cancelled) {
          setPlain(null);
          toast.error(e instanceof Error ? e.message : '无法取回该密钥明文');
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, keyId]);

  if (!open) return null;

  const sseConfig = plain
    ? JSON.stringify(
        {
          mcpServers: {
            vibehub: {
              type: 'sse',
              url: `${origin}/mcp/sse`,
              headers: { Authorization: `Bearer ${plain}` },
            },
          },
        },
        null,
        2,
      )
    : '';
  const workUrl = `${origin}/mcp`;
  const workAuthorization = plain ? `Bearer ${plain}` : '';
  const installCmd = `curl -fsSL ${origin}/skills/install.sh | VIBEHUB_URL=${origin} bash`;

  const copy = (text: string, label: string) => {
    if (!text) return;
    void navigator.clipboard.writeText(text).then(
      () => toast.success(`已复制${label}`),
      () => toast.error('复制失败，请手动选中复制'),
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="vh-dialog w-[calc(100vw-2rem)] max-w-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        data-testid="mcp-config-panel"
      >
        <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
          <Plug size={15} className="text-[var(--brand)]" />
          <h3 className="text-sm font-semibold">连接 MCP 客户端</h3>
          <div className="flex-1" />
          <button className="vh-btn ghost h-7 text-xs" onClick={onClose}>关闭</button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div>
            <label className="mb-1 block text-xs text-[var(--text-tertiary)]">用哪把密钥连接</label>
            <select
              className="vh-input h-9 w-full text-sm"
              value={keyId}
              onChange={(e) => setKeyId(e.target.value)}
              data-testid="mcp-key-select"
            >
              {usable.length === 0 && <option value="">（没有可用密钥，请先创建）</option>}
              {usable.map((k) => (
                <option key={k.id} value={k.id}>{k.name} · {k.masked}</option>
              ))}
            </select>
            {busy && <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">正在取回密钥…</p>}
            {!busy && keyId && !plain && (
              <p className="mt-1 text-[11px] text-[var(--warn)]">该密钥明文不可恢复，请在列表里轮换生成新密钥。</p>
            )}
          </div>

          <div className="rounded-xl border border-[var(--border-subtle)] p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--text-primary)]">ChatGPT Work（MCP Events）</span>
              <button className="vh-btn ghost h-7 text-xs" disabled={!plain} onClick={() => copy(workUrl, ' Work MCP 地址')}>
                <Copy size={12} /> 复制地址
              </button>
            </div>
            <div className="space-y-2 font-mono text-[11px] text-[var(--text-secondary)]">
              <div className="break-all">URL: {workUrl}</div>
              <div className="break-all">Authorization: {workAuthorization || '（选择一把可用密钥后显示）'}</div>
            </div>
            <div className="mt-2 flex justify-end">
              <button className="vh-btn ghost h-7 text-xs" disabled={!plain} onClick={() => copy(workAuthorization, ' Bearer 密钥') }>
                <Copy size={12} /> 复制 Bearer 凭证
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
              在 Work 的自定义 MCP 连接中填写 URL 与 Bearer 凭证。远程服务需通过 HTTPS 提供；当前页面若是 HTTP 地址，请先配置 HTTPS 反向代理。
            </p>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-[var(--text-tertiary)]">Cursor / Windsurf / Claude Code 通用（SSE）</span>
              <button
                className="vh-btn ghost h-7 text-xs"
                disabled={!plain}
                onClick={() => copy(sseConfig, ' mcp.json')}
                data-testid="copy-mcp-config"
              >
                <Copy size={12} /> 复制
              </button>
            </div>
            <pre className="overflow-x-auto rounded-[10px] bg-[var(--bg-elevated)] p-3 font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]">
{sseConfig || '// 选择一把可用密钥后生成'}
            </pre>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1 text-xs text-[var(--text-tertiary)]">
                <Terminal size={12} /> 把「怎么用这些工具」装进 AI 的技能目录
              </span>
              <button className="vh-btn ghost h-7 text-xs" onClick={() => copy(installCmd, '安装命令')}>
                <Copy size={12} /> 复制
              </button>
            </div>
            <pre className="overflow-x-auto rounded-[10px] bg-[var(--bg-elevated)] p-3 font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]">
{installCmd}
            </pre>
          </div>

          <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            地址取当前页面所在来源（{origin}）。若队友走 ZeroTier，把域名换成虚拟内网 IP 即可；
            密钥明文只在本次请求中返回，不会写入浏览器存储。
          </p>
        </div>
      </div>
    </div>
  );
}
