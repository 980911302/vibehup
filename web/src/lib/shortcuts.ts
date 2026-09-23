'use client';

import { useEffect, useRef } from 'react';

/**
 * 快捷键体系（UI 原则 §6.5 / 步骤 06 §6.5）。
 * 注册表集中定义（供 ? 帮助面板同源渲染），输入态自动放行，⌘ 系列始终捕获。
 * G 前缀序列：松开 G 后 800ms 内的下一键触发组合（G+B → /board）。
 */

export interface HotkeyDef {
  /** 组合键：'c' | 'mod+k' | 'g b'（空格分隔序列） */
  combo: string;
  description: string;
  handler: (e: KeyboardEvent) => void;
  /** 输入态（input/textarea/contentEditable）是否仍生效，默认 false */
  allowInInput?: boolean;
}

const SEQUENCE_WINDOW_MS = 800;

function isInputTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
}

function matchesCombo(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split(' ');
  const key = e.key.toLowerCase();
  const wantMod = parts.includes('mod');
  const baseKey = parts.find((p) => p !== 'mod');
  const hasMod = e.metaKey || e.ctrlKey;
  if (wantMod !== hasMod) return false;
  return baseKey === key || (baseKey === 'esc' && key === 'escape');
}

export function useHotkeys(defs: HotkeyDef[]): void {
  const defsRef = useRef(defs);
  defsRef.current = defs;
  const sequenceRef = useRef<{ prefix: string; at: number } | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const now = Date.now();
      const inInput = isInputTarget(e.target);
      // 过期的序列前缀
      if (sequenceRef.current && now - sequenceRef.current.at > SEQUENCE_WINDOW_MS) {
        sequenceRef.current = null;
      }

      for (const def of defsRef.current) {
        if (inInput && !def.allowInInput) continue;
        const parts = def.combo.toLowerCase().split(' ');

        // 序列组合（如 'g b'）
        if (parts.length > 1) {
          const [prefix, ...rest] = parts;
          if (sequenceRef.current?.prefix === prefix && rest.includes(e.key.toLowerCase())) {
            e.preventDefault();
            sequenceRef.current = null;
            def.handler(e);
            return;
          }
          if (e.key.toLowerCase() === prefix && rest.length > 0) {
            sequenceRef.current = { prefix, at: now };
          }
          continue;
        }

        // 单键组合
        if (matchesCombo(e, def.combo)) {
          e.preventDefault();
          def.handler(e);
          return;
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** 全局快捷键清单（? 帮助面板与 useHotkeys 同源） */
export const GLOBAL_HOTKEYS: { combo: string; description: string; group: string }[] = [
  { group: '全局', combo: 'c', description: '打开快速录入（新建缺陷）' },
  { group: '全局', combo: 'n', description: '新建随手记（随手记页）' },
  { group: '全局', combo: 'mod+k', description: '命令面板（搜索/导航/动作）' },
  { group: '全局', combo: '?', description: '快捷键帮助' },
  { group: '全局', combo: 'g b', description: '跳转看板' },
  { group: '全局', combo: 'g f', description: '跳转文件' },
  { group: '全局', combo: 'g n', description: '跳转随手记' },
  { group: '全局', combo: 'g t', description: '跳转任务' },
  { group: '全局', combo: 'g p', description: '跳转项目' },
  { group: '全局', combo: 'g k', description: '跳转 MCP 密钥' },
  { group: '全局', combo: 'g m', description: '跳转成员' },
  { group: '全局', combo: 'esc', description: '关闭浮层 → 清选择 → 清搜索（逐层）' },
  { group: '表单', combo: 'mod+enter', description: '提交表单' },
  { group: '列表', combo: 'j / ↓', description: '焦点下移' },
  { group: '列表', combo: 'k / ↑', description: '焦点上移' },
  { group: '列表', combo: 'enter', description: '打开焦点项' },
  { group: '列表', combo: 'x', description: '切换多选焦点项' },
  { group: '列表', combo: '/', description: '聚焦搜索框' },
];
