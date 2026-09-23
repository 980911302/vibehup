import pg from 'pg';
import { NOTIFY_CHANNEL } from '../core/events.js';
import { config } from '../config.js';

/**
 * SSE 共享 LISTEN 连接（卡片 F5）。
 *
 * 卡片 29 的实现是「每个 /api/events 请求各起一条 pg Client LISTEN」——每个浏览器标签页
 * 独占一条 PG 连接，标签多/重连频繁时连接数随人数线性增长。本模块把 LISTEN 收敛为
 * **进程内唯一连接**，所有 SSE 订阅者只在内存中注册回调：
 *
 * - 引用计数：有订阅者才建连接，全部退订后断开；
 * - 自愈：连接 error/end 后清态，下一位订阅者重新建连；
 * - 失败隔离：LISTEN 失败只丢加速（前端仍有 5s 轮询兜底），绝不抛给请求处理链；
 * - 每条通知独立 try-catch，单个订阅者抛错不影响其他订阅者。
 */

type Handler = (payload: string) => void;

interface ListenerState {
  client: pg.Client | null;
  connecting: Promise<void> | null;
  handlers: Set<Handler>;
  /** 测试观测：累计建连次数 */
  connections: number;
  /** 连接代次：detach 时自增，使进行中的异步建连结果作废（防竞态复活） */
  generation: number;
}

const state: ListenerState = { client: null, connecting: null, handlers: new Set(), connections: 0, generation: 0 };

function detachClient(): void {
  const client = state.client;
  state.client = null;
  state.connecting = null;
  state.generation += 1;
  if (client) {
    client.removeAllListeners();
    void client.end().catch(() => undefined);
  }
}

async function ensureConnected(): Promise<void> {
  if (state.client) return;
  if (state.connecting) return state.connecting;

  const generation = state.generation;
  const client = new pg.Client({ connectionString: config.databaseUrl });
  // pg Client 无 error 监听器会抛未处理异常炸进程（PG 重启场景必须挂）
  client.on('error', (err) => {
    console.warn(`[vibehub] SSE LISTEN 连接异常，将按需重连: ${err.message}`);
    if (state.client === client) detachClient();
  });
  client.on('end', () => {
    if (state.client === client) detachClient();
  });
  client.on('notification', (msg) => {
    if (msg.channel !== NOTIFY_CHANNEL || !msg.payload) return;
    for (const handler of state.handlers) {
      try {
        handler(msg.payload);
      } catch (err) {
        console.error('[vibehub] SSE 订阅者回调异常:', err);
      }
    }
  });

  state.connecting = (async () => {
    await client.connect();
    await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
    // 若在连接期间已被 detach（测试显式断开/连接已结束），丢弃这条已作废的连接
    if (state.generation !== generation) {
      void client.end().catch(() => undefined);
      return;
    }
    state.client = client;
    state.connections += 1;
  })();
  try {
    await state.connecting;
  } finally {
    state.connecting = null;
  }
}

/** 订阅通知；返回退订函数（退订后无订阅者则断开连接） */
export async function subscribe(handler: Handler): Promise<() => void> {
  state.handlers.add(handler);
  try {
    await ensureConnected();
  } catch (err) {
    // 失败不致命：SSE 连接照常建立，靠前端轮询兜底（req.log 由调用方记录）
    console.warn(`[vibehub] SSE LISTEN 失败，降级轮询兜底: ${err instanceof Error ? err.message : err}`);
  }
  return () => {
    state.handlers.delete(handler);
    if (state.handlers.size === 0) detachClient();
  };
}

/** 断开共享连接（无订阅者时自动调用；亦供测试与优雅退出使用） */
export async function stopSharedListener(): Promise<void> {
  state.handlers.clear();
  detachClient();
}

/** 观测/测试用状态快照 */
export function getState(): { connections: number; subscribers: number; channel: string; connected: boolean } {
  return {
    connections: state.connections,
    subscribers: state.handlers.size,
    channel: NOTIFY_CHANNEL,
    connected: state.client !== null,
  };
}

/** 仅测试：重置累计计数 */
export function __resetForTest(): void {
  state.connections = 0;
}
