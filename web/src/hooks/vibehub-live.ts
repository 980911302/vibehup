'use client';

import { useEffect, useRef, useState } from 'react';
import { shouldSkipPoll } from '@/lib/sse-poll';

const POLL_INTERVAL = 5000;

/**
 * 实时更新：SSE 同进程即时推送 + 5s 轮询兜底（MCP 跨进程写入）。
 * R78：SSE 有效（已连通且最近有活动）时跳过本轮轮询；按「最近活动」判定，因为事件源半开时 onerror 不一定触发。
 * 回调走 ref，调用方不必保证引用稳定，也不会因此重建连接。
 */
export function useLiveUpdates(
  accessToken: string | null,
  handlers: { onEvent: (type: string) => void; onPoll: () => void },
): boolean {
  const [sseConnected, setSseConnected] = useState(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const connectedRef = useRef(false);
  const lastEventAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    const source = new EventSource(`/api/events?token=${encodeURIComponent(accessToken)}`);
    source.onopen = () => {
      connectedRef.current = true;
      lastEventAtRef.current = Date.now();
      setSseConnected(true);
    };
    source.onerror = () => {
      connectedRef.current = false;
      setSseConnected(false);
    };
    source.onmessage = (event) => {
      lastEventAtRef.current = Date.now();
      try {
        const data = JSON.parse(event.data) as { type?: string };
        if (data.type) handlersRef.current.onEvent(data.type);
      } catch {
        // 心跳
      }
    };
    return () => {
      source.close();
      connectedRef.current = false;
    };
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const skip = shouldSkipPoll({ sseConnected: connectedRef.current, lastEventAt: lastEventAtRef.current, now: Date.now() });
      if (!skip) handlersRef.current.onPoll();
    }, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [accessToken]);

  return sseConnected;
}
