'use client';

import { useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';

const inputClass =
  'h-10 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-page)] px-3 text-sm outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent)]';

function strength(p: string): number {
  let score = 0;
  if (p.length >= 8) score++;
  if (/[a-zA-Z]/.test(p) && /\d/.test(p)) score++;
  if (p.length >= 12) score++;
  return Math.min(score, 2);
}

/** 密码与安全：改密后其他设备需重新登录。 */
export function PasswordCard() {
  const toast = useToast();
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');

  const changePassword = async () => {
    try {
      await api.changePassword(oldPwd, newPwd);
      setOldPwd('');
      setNewPwd('');
      toast.success('密码已修改，其他设备需重新登录');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '修改失败');
    }
  };

  return (
    <section className="vh-card p-5">
      <h2 className="t-title-3 flex items-center gap-2">
        <LockKeyhole size={16} /> 密码与安全
      </h2>
      <p className="t-caption-5 mt-1 text-[var(--text-tertiary)]">至少 8 位，同时包含字母和数字。</p>
      <div className="mt-4 space-y-2">
        <input
          type="password"
          className={inputClass}
          placeholder="当前密码"
          value={oldPwd}
          onChange={(e) => setOldPwd(e.target.value)}
          autoComplete="current-password"
        />
        <input
          type="password"
          className={inputClass}
          placeholder="新密码"
          value={newPwd}
          onChange={(e) => setNewPwd(e.target.value)}
          autoComplete="new-password"
        />
        {newPwd && (
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={cn(
                    'h-1 w-8 rounded-full',
                    strength(newPwd) > i
                      ? strength(newPwd) === 2
                        ? 'bg-[var(--ok)]'
                        : 'bg-[var(--warn)]'
                      : 'bg-[var(--bg-elevated)]',
                  )}
                />
              ))}
            </div>
            <span className="t-caption-5 text-[var(--text-tertiary)]">{['弱', '中', '强'][strength(newPwd)]}</span>
          </div>
        )}
        <button className="vh-btn" disabled={!oldPwd || !newPwd} onClick={() => void changePassword()}>
          修改密码
        </button>
      </div>
    </section>
  );
}
