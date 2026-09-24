'use client';

import { useSyncExternalStore } from 'react';

/**
 * 全页共用的分钟时钟：卡片上的「停了多久 / 是否卡住」随时间推进，
 * 看板上几十张卡片共用一个定时器，而不是每张卡片各开一个。
 */
const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 60_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useMinuteClock(): number {
  return useSyncExternalStore(subscribe, () => now, () => now);
}
