'use client';

import { createContext, createElement, useContext, type ReactNode } from 'react';
import { useVibeHubStore, type VibeHubStore } from './use-vibehub-store';

export type { VibeHubStore } from './use-vibehub-store';

const VibeHubContext = createContext<VibeHubStore | null>(null);

/**
 * 全站只实例化一次数据中枢（放在 (app)/layout）：当前项目、看板数据与 SSE 连接跨页共享。
 * 此前每个页面各自调用 hook，一换页项目就被重置、每页还各开一条 SSE（功能巡检 B1）。
 */
export function VibeHubProvider({ children }: { children: ReactNode }) {
  const store = useVibeHubStore();
  return createElement(VibeHubContext.Provider, { value: store }, children);
}

/** 页面与组件读取数据中枢的唯一入口 */
export function useVibeHub(): VibeHubStore {
  const store = useContext(VibeHubContext);
  if (!store) throw new Error('useVibeHub 必须在 VibeHubProvider 内使用');
  return store;
}
