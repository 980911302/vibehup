# 统计页 `/stats` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一个只读统计页 `/stats`：今天产出多少、还剩多少（含未验证）、现在谁在做什么、按密钥归集、最近 14 天趋势。

**Architecture:** 后端新增一个只读聚合接口 `GET /api/stats`，在 service 层用少量 Prisma 查询把项目下全部缺陷/任务拉出来，纯函数在内存里算出「今天」「还剩」「活跃列表」「按经手人」「趋势」五个分区，一次性返回；不新增表、不改任何写路径。前端新增 `/stats` 页面，复用全站已有的数据中枢（`useVibeHub`）与设计 token，图表沿用项目里已有的 flex/div 柱状图写法（`KeyUsageChart` 同款），不引入新依赖。

**Tech Stack:** Fastify + Prisma（后端，沿用现有 service/route 分层）；Next.js App Router + React 19（前端，沿用现有 hooks/api 分层）；Vitest（单测）+ Playwright（E2E）。

## Global Constraints

- 契约优先级：`vibehub/AGENTS.md` > 步骤计划文档 > 规范细则；本功能规格已写入 `docs/计划/07-功能页面规格.md` §7.16（R85，用户定向解冻），本计划严格按该节实现，任何偏离需现场登记 `docs/计划/PROGRESS.md` §4。
- 后端分层单向：`routes → services → core`；routes 禁止直连 Prisma。
- API 响应 snake_case；错误体 `{ error: { code, message } }`，message 人话。
- 后端所有新文件用 ESM 相对导入且带 `.js` 后缀（如 `from './stale.js'`），与仓库现状一致。
- 前端契约（AGENTS.md §6）：颜色/圆角/阴影一律用 CSS 变量 token，组件内禁止裸 HEX；单文件 ≤300 行、单函数 ≤50 行；只动 `transform`/`opacity` 做动效；页面只经 `hooks/use-vibehub.ts` 消费数据中枢，不得各页各开一条 SSE。
- 每个 bugfix/功能先写失败测试再写实现（TDD）；后端测试库固定连 `postgresql://postgres:test@127.0.0.1:55432/postgres`（`bash server/scripts/test-db.sh` 起）。
- 声称「通过」前必须当场跑验证命令并贴输出。
- 「谁」= 经手人 = 最近一次改状态的人：AI 为 MCP 密钥名，网页操作为用户名；不按指派人统计。
- 「今天」= 北京时间（UTC+8，无夏令时）自然日 `[00:00, 次日 00:00)`；容器/开发机时钟均为 UTC，日界线必须在代码里显式按 UTC+8 换算，不能依赖宿主机时区。

---

## 背景速查（写计划时在真实数据上验证过，实现时无需重新调研）

- `services/stale.ts` 已有 `isStale(status, since, now)` 与 `STALE_AFTER_MS`（`verifying` 2h、`in_progress`/`doing` 24h，其余状态无阈值即恒 `false`）——本功能直接复用，不新增阈值文件。
- `services/bug-flow.ts` 的 `BUG_TRANSITIONS.verified` 不再允许到 `closed`（R83 规则）。这意味着：**只要 `Bug.statusChangedAt` 非空且当前 `status === 'closed'`，这次关闭必然不是从 `verified` 来的**（新规则下这条转移已被禁止），可以直接判定为「不修/重复」关闭，完全不需要再看历史评论。只有 `statusChangedAt` 为空（R83 迁移前的老数据）时才需要回退到解析 `bug_comments` 里最后一条「状态变更：A → B」的 A。真实库里当前 11 个 `closed` 的缺陷全部是这种老数据（`statusChangedAt` 全空），已用于设计验证。
- `Task` 没有类似 `bug_comments` 的活动流表（schema 里只有 `BugComment`，没有 `TaskComment`），所以任务的完成时间/经手人老数据只能回退到 `updatedAt` / `null`（「未记录」），不需要解析任何文本。
- 前端已有 `lib/stale.ts` 导出的 `formatSpan(ms)`（"12 分钟"/"3 小时"/"2 天"）与 `useMinuteClock()`（全页共用的分钟级时钟）——本功能的「停了多久」文案直接复用这两个函数；**不要**改动 `lib/stale.ts` 里的 `STALE_AFTER_MS`/`isHandlingStatus`/`handlingOf`/`HandlingLine`（它们只覆盖「正在处理」的 3 个状态，被 `BugCard`/`TaskCard` 等既有卡片直接使用；改了会让「已解决」「待验证」列的卡片上突然冒出经手人行，是本功能之外的副作用）。统计页「现在谁在做什么」区块里连「已解决/待验证」都要显示，因此用一个新的、本功能专属的小组件渲染，不复用 `HandlingLine`。
- 数据中枢 `hooks/use-vibehub-store.ts` 已有 `taskRevision`/`skillRevision` 计数器模式：SSE 收到 `task.*`/`skill.*` 事件或轮询兜底时自增，页面 `useEffect(() => { void load() }, [load, store.taskRevision])` 据此重新拉取。本功能新增同款 `statsRevision`，在 `bug.*`/`task.*` 事件与轮询兜底时自增。
- `web/src/app/(app)/tasks/page.tsx` 的数据加载写法（`useCallback` + `useEffect` 依赖 `store.taskRevision`）是本功能页面数据加载的直接模板。
- Bug 卡片可通过 `router.push('/board')` 跳转但**没有** URL 深链到具体某条缺陷（看板页不读 `?bug=`）；Task 卡片**有**深链（`tasks/page.tsx` 用 `useSearchParams().get('task')` 打开详情）。因此本功能里点缺陷行只能跳到看板（不预选中该卡片），点任务行可以精确跳到该任务详情（`/tasks?task=<id>`）——这是既有限制，不在本计划范围内新增看板深链。
- `server/scripts/acceptance.sh` **不会**跑前端单测；前端纯函数测试要单独跑 `cd server && npx vitest run --root ../web`（AGENTS.md §6 已登记的约定）。

---

### Task 1: Beijing 时区日界线（纯函数）

**Files:**
- Create: `server/src/services/stats-time.ts`
- Test: `server/src/services/stats-time.test.ts`

**Interfaces:**
- Produces:
  - `export const BEIJING_OFFSET_MS: number`（= `8 * 3600_000`）
  - `export interface DayBounds { start: Date; end: Date; dateStr: string }`
  - `export function beijingDayBounds(instant: Date): DayBounds` —— `instant` 所在的北京自然日 `[start, end)`（均为 UTC 瞬时 `Date`），`dateStr` 形如 `"2026-09-25"`。
  - `export function beijingTrendDays(now: Date, days: number): DayBounds[]` —— 以 `now` 所在北京日为最后一天，往前数 `days` 天（含今天），**旧→新**排列，每项复用 `beijingDayBounds` 的返回形状。

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/services/stats-time.test.ts
import { describe, it, expect } from 'vitest';
import { beijingDayBounds, beijingTrendDays, BEIJING_OFFSET_MS } from './stats-time.js';

describe('beijingDayBounds', () => {
  it('UTC 16:00 = 北京次日 00:00：跨过日界线', () => {
    // 2026-09-24T16:00:00Z = 2026-09-25T00:00:00+08:00（北京刚进入 25 号）
    const r = beijingDayBounds(new Date('2026-09-24T16:00:00.000Z'));
    expect(r.dateStr).toBe('2026-09-25');
    expect(r.start.toISOString()).toBe('2026-09-24T16:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-09-25T16:00:00.000Z');
  });

  it('UTC 15:59:59.999 仍算北京当天（还没跨过日界线）', () => {
    const r = beijingDayBounds(new Date('2026-09-24T15:59:59.999Z'));
    expect(r.dateStr).toBe('2026-09-24');
  });

  it('端点包含关系：start 落在区间内，end 不落在区间内（半开区间）', () => {
    const now = new Date('2026-09-25T03:00:00.000Z');
    const r = beijingDayBounds(now);
    expect(r.start.getTime() <= now.getTime()).toBe(true);
    expect(now.getTime() < r.end.getTime()).toBe(true);
    expect(r.end.getTime() - r.start.getTime()).toBe(86_400_000);
  });

  it('偏移量恒为 8 小时', () => {
    expect(BEIJING_OFFSET_MS).toBe(8 * 3600_000);
  });
});

describe('beijingTrendDays', () => {
  it('返回 days 条，旧→新，最后一条是 now 所在的北京日', () => {
    const now = new Date('2026-09-25T03:00:00.000Z'); // 北京 2026-09-25 11:00
    const days = beijingTrendDays(now, 14);
    expect(days).toHaveLength(14);
    expect(days[13].dateStr).toBe('2026-09-25');
    expect(days[0].dateStr).toBe('2026-09-12'); // 25 号往前数 13 天
  });

  it('相邻两天首尾相接（end[i] === start[i+1]）', () => {
    const days = beijingTrendDays(new Date('2026-09-25T03:00:00.000Z'), 5);
    for (let i = 0; i < days.length - 1; i++) {
      expect(days[i].end.getTime()).toBe(days[i + 1].start.getTime());
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && TEST_DATABASE_URL='postgresql://postgres:test@127.0.0.1:55432/postgres' npx vitest run src/services/stats-time.test.ts`
Expected: FAIL — `Cannot find module './stats-time.js'` 或 `stats-time.js` 内无导出。

- [ ] **Step 3: Write minimal implementation**

```typescript
// server/src/services/stats-time.ts
/**
 * 北京时区（UTC+8，无夏令时）自然日边界计算（R85 统计页）。
 * 容器/开发机时钟均为 UTC，「今天」必须显式按 +8 换算，不能依赖宿主机时区设置。
 */

export const BEIJING_OFFSET_MS = 8 * 3600_000;

export interface DayBounds {
  /** 该北京自然日的起点（UTC 瞬时） */
  start: Date;
  /** 该北京自然日的终点（不含，UTC 瞬时） */
  end: Date;
  /** 北京日期字符串，如 "2026-09-25" */
  dateStr: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** instant 所在的北京自然日 [00:00, 次日 00:00) */
export function beijingDayBounds(instant: Date): DayBounds {
  const shifted = new Date(instant.getTime() + BEIJING_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  const startMs = Date.UTC(y, m, day) - BEIJING_OFFSET_MS;
  return {
    start: new Date(startMs),
    end: new Date(startMs + 86_400_000),
    dateStr: `${y}-${pad2(m + 1)}-${pad2(day)}`,
  };
}

/** 以 now 所在北京日为最后一天，往前数 days 天（含今天），旧→新排列 */
export function beijingTrendDays(now: Date, days: number): DayBounds[] {
  const today = beijingDayBounds(now);
  const out: DayBounds[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const startMs = today.start.getTime() - i * 86_400_000;
    out.push(beijingDayBounds(new Date(startMs + 1))); // +1ms 确保仍落在目标日内，避免浮点/边界误差
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && TEST_DATABASE_URL='postgresql://postgres:test@127.0.0.1:55432/postgres' npx vitest run src/services/stats-time.test.ts`
Expected: PASS，6 个用例全绿。

- [ ] **Step 5: Commit**

```bash
cd /Users/zhanglinlin/Downloads/工作区/vibehub
git add server/src/services/stats-time.ts server/src/services/stats-time.test.ts
git commit -m "feat(stats): 北京时区日界线纯函数 + 单测"
```

---

### Task 2: 老数据状态变更评论解析（纯函数）

**Files:**
- Create: `server/src/services/stats-legacy.ts`
- Test: `server/src/services/stats-legacy.test.ts`

**Interfaces:**
- Consumes: `BUG_STATUSES`、`BUG_STATUS_LABELS`（来自 `./bug-flow.js`，已存在：`BUG_STATUSES: readonly BugStatus[]`，`BUG_STATUS_LABELS: Record<BugStatus, string>`）
- Produces:
  - `export interface ParsedStatusChange { from: string; to: string }`
  - `export function parseStatusChangeComment(content: string): ParsedStatusChange | null` —— 只解析 `bug_comments.content` 的**第一行**，兼容英文状态码（`open → in_progress`）与中文文案（`待处理 → 进行中`）两种历史格式；无法识别时返回 `null`。返回的 `from`/`to` 统一是**状态码**（如 `'verified'`），不是中文。

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/services/stats-legacy.test.ts
import { describe, it, expect } from 'vitest';
import { parseStatusChangeComment } from './stats-legacy.js';

describe('parseStatusChangeComment', () => {
  it('解析中文文案格式（当前格式）', () => {
    expect(parseStatusChangeComment('状态变更：已验证 → 已关闭')).toEqual({ from: 'verified', to: 'closed' });
  });

  it('解析英文状态码格式（更老的历史数据）', () => {
    expect(parseStatusChangeComment('状态变更：open → in_progress')).toEqual({ from: 'open', to: 'in_progress' });
  });

  it('只看第一行：后续行（重开原因/修复说明/commit）不影响解析', () => {
    const content = '状态变更：验证中 → 已验证\n修复说明：已在测试环境复验通过\ncommit: abc1234';
    expect(parseStatusChangeComment(content)).toEqual({ from: 'verifying', to: 'verified' });
  });

  it('非状态变更评论返回 null', () => {
    expect(parseStatusChangeComment('AI：已定位到 NPE，需要确认期望行为')).toBeNull();
  });

  it('格式对但状态名无法识别时返回 null（防脏数据把假状态当真）', () => {
    expect(parseStatusChangeComment('状态变更：不存在的状态 → 也不存在')).toBeNull();
  });

  it('六种缺陷状态的中英文名都能识别', () => {
    const pairs: [string, string][] = [
      ['open', '待处理'], ['in_progress', '进行中'], ['resolved', '已解决'],
      ['verifying', '验证中'], ['verified', '已验证'], ['closed', '已关闭'],
    ];
    for (const [code, label] of pairs) {
      expect(parseStatusChangeComment(`状态变更：${code} → ${code}`)).toEqual({ from: code, to: code });
      expect(parseStatusChangeComment(`状态变更：${label} → ${label}`)).toEqual({ from: code, to: code });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && TEST_DATABASE_URL='postgresql://postgres:test@127.0.0.1:55432/postgres' npx vitest run src/services/stats-legacy.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: Write minimal implementation**

```typescript
// server/src/services/stats-legacy.ts
import { BUG_STATUSES, BUG_STATUS_LABELS, type BugStatus } from './bug-flow.js';

/**
 * 解析 R83 之前（无 statusChangedAt 列）的老缺陷「状态变更」评论（R85 统计页兜底用）。
 * 评论首行格式固定为「状态变更：A → B」（services/bugs.ts 写入），A/B 历史上出现过
 * 英文状态码（早期）与中文文案（bugStatusLabel 上线后）两种写法，这里都要认得。
 */

export interface ParsedStatusChange {
  from: BugStatus;
  to: BugStatus;
}

/** 状态码/中文文案 → 状态码 的反查表，两种写法都收进去 */
const STATUS_BY_TEXT: Record<string, BugStatus> = {};
for (const s of BUG_STATUSES) {
  STATUS_BY_TEXT[s] = s;
  STATUS_BY_TEXT[BUG_STATUS_LABELS[s]] = s;
}

const FIRST_LINE_RE = /^状态变更：(.+?) → (.+)$/;

export function parseStatusChangeComment(content: string): ParsedStatusChange | null {
  const firstLine = content.split('\n')[0]?.trim() ?? '';
  const m = FIRST_LINE_RE.exec(firstLine);
  if (!m) return null;
  const from = STATUS_BY_TEXT[m[1].trim()];
  const to = STATUS_BY_TEXT[m[2].trim()];
  if (!from || !to) return null;
  return { from, to };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && TEST_DATABASE_URL='postgresql://postgres:test@127.0.0.1:55432/postgres' npx vitest run src/services/stats-legacy.test.ts`
Expected: PASS，6 个用例全绿（第 6 个用例内部有 12 个断言）。

- [ ] **Step 5: Commit**

```bash
cd /Users/zhanglinlin/Downloads/工作区/vibehub
git add server/src/services/stats-legacy.ts server/src/services/stats-legacy.test.ts
git commit -m "feat(stats): 老数据状态变更评论解析（中英文兼容）+ 单测"
```

---

### Task 3: 缺陷/任务「完成结果」判定（纯函数）

**Files:**
- Create: `server/src/services/stats.ts`（本任务只写纯函数部分；Task 4 在同一文件追加 DB 编排部分）
- Test: `server/src/services/stats.test.ts`（本任务只写纯函数用例；Task 4 追加集成用例）

**Interfaces:**
- Consumes:
  - `ParsedStatusChange`（`./stats-legacy.js`）
  - `StatusActor`（`./stale.js`，已存在：`{ type: 'user'|'ai'; id?: string|null; name?: string|null }`——本任务用它的 `type`/`name` 语义，不直接依赖该接口类型本身）
- Produces（供 Task 4 与路由消费）：
  - `export interface ActorRef { type: 'user' | 'ai'; name: string }`
  - `export interface BugOutcome { kind: 'fixed' | 'closed_unfixed'; at: Date; actor: ActorRef | null }`
  - `export interface TaskOutcome { at: Date; actor: ActorRef | null }`
  - `export interface LegacyLookup { from: string; at: Date; actor: ActorRef | null }`（Task 4 从 `bug_comments` 查出来后传入）
  - `export function resolveBugOutcome(bug: { status: string; statusChangedAt: Date | null; statusActorType: string | null; statusActorName: string | null; updatedAt: Date }, legacy: LegacyLookup | null): BugOutcome | null` —— 只对 `status` 为 `verified`/`closed` 的缺陷返回非 null；其余状态返回 `null`（还没到终态）。
  - `export function resolveTaskOutcome(task: { status: string; statusChangedAt: Date | null; statusActorType: string | null; statusActorName: string | null; updatedAt: Date }): TaskOutcome | null` —— 只对 `status === 'done'` 返回非 null。

**判定逻辑（写进函数注释，供 Task 4 的调用方理解）：**
- `verified`：无条件算 `fixed`（进入 verified 本身就是修复完成，不用看是从哪来的）。
- `closed` 且 `statusChangedAt` 非空：当前状态机下 `verified → closed`已被禁止（R83），能查到 `statusChangedAt` 说明是新规则产生的关闭，**必然**不是从 verified 来的 → `closed_unfixed`。
- `closed` 且 `statusChangedAt` 为空：回退到 `legacy`（调用方从最后一条「状态变更」评论解析出的 `from`）；`from === 'verified'` → `fixed`（老流程的「验证完关闭」），否则 → `closed_unfixed`。
- `legacy` 也拿不到（连评论都没有的远古数据）：`closed_unfixed`，`at = updatedAt`，`actor = null`。

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/services/stats.test.ts
import { describe, it, expect } from 'vitest';
import { resolveBugOutcome, resolveTaskOutcome } from './stats.js';

const NOW = new Date('2026-09-25T04:00:00.000Z');

describe('resolveBugOutcome', () => {
  it('verified 且有 statusChangedAt：fixed，用该时间与经手人', () => {
    const r = resolveBugOutcome(
      { status: 'verified', statusChangedAt: NOW, statusActorType: 'ai', statusActorName: 'zhanglinlin-trial', updatedAt: NOW },
      null,
    );
    expect(r).toEqual({ kind: 'fixed', at: NOW, actor: { type: 'ai', name: 'zhanglinlin-trial' } });
  });

  it('closed 且有 statusChangedAt：直接判 closed_unfixed（R83 起 verified 不能直接关闭，无需看来源）', () => {
    const r = resolveBugOutcome(
      { status: 'closed', statusChangedAt: NOW, statusActorType: 'user', statusActorName: '张三', updatedAt: NOW },
      null,
    );
    expect(r).toEqual({ kind: 'closed_unfixed', at: NOW, actor: { type: 'user', name: '张三' } });
  });

  it('verified 且无 statusChangedAt：回退用 legacy 的时间与经手人', () => {
    const legacyAt = new Date('2026-09-20T10:00:00.000Z');
    const r = resolveBugOutcome(
      { status: 'verified', statusChangedAt: null, statusActorType: null, statusActorName: null, updatedAt: NOW },
      { from: 'verifying', at: legacyAt, actor: { type: 'ai', name: 'old-key' } },
    );
    expect(r).toEqual({ kind: 'fixed', at: legacyAt, actor: { type: 'ai', name: 'old-key' } });
  });

  it('closed 且无 statusChangedAt，legacy.from = verified：老流程「验证完关闭」算 fixed', () => {
    const legacyAt = new Date('2026-09-20T10:00:00.000Z');
    const r = resolveBugOutcome(
      { status: 'closed', statusChangedAt: null, statusActorType: null, statusActorName: null, updatedAt: NOW },
      { from: 'verified', at: legacyAt, actor: { type: 'ai', name: 'zhanglinlin-trial' } },
    );
    expect(r).toEqual({ kind: 'fixed', at: legacyAt, actor: { type: 'ai', name: 'zhanglinlin-trial' } });
  });

  it('closed 且无 statusChangedAt，legacy.from ≠ verified：closed_unfixed（不修/重复）', () => {
    const legacyAt = new Date('2026-09-20T10:00:00.000Z');
    const r = resolveBugOutcome(
      { status: 'closed', statusChangedAt: null, statusActorType: null, statusActorName: null, updatedAt: NOW },
      { from: 'open', at: legacyAt, actor: { type: 'user', name: '李四' } },
    );
    expect(r).toEqual({ kind: 'closed_unfixed', at: legacyAt, actor: { type: 'user', name: '李四' } });
  });

  it('closed 且无 statusChangedAt、无 legacy（连评论都没有的远古数据）：closed_unfixed，用 updatedAt，经手人 null', () => {
    const r = resolveBugOutcome(
      { status: 'closed', statusChangedAt: null, statusActorType: null, statusActorName: null, updatedAt: NOW },
      null,
    );
    expect(r).toEqual({ kind: 'closed_unfixed', at: NOW, actor: null });
  });

  it('statusActorType 有值但 statusActorName 为空字符串：actor.name 兜底空串（不是 null）', () => {
    const r = resolveBugOutcome(
      { status: 'verified', statusChangedAt: NOW, statusActorType: 'ai', statusActorName: null, updatedAt: NOW },
      null,
    );
    expect(r?.actor).toEqual({ type: 'ai', name: '' });
  });

  it.each(['open', 'in_progress', 'resolved', 'verifying'])('%s 状态还没到终态，返回 null', (status) => {
    expect(resolveBugOutcome({ status, statusChangedAt: null, statusActorType: null, statusActorName: null, updatedAt: NOW }, null)).toBeNull();
  });
});

describe('resolveTaskOutcome', () => {
  it('done 且有 statusChangedAt：用该时间与经手人', () => {
    const r = resolveTaskOutcome({ status: 'done', statusChangedAt: NOW, statusActorType: 'ai', statusActorName: 'zhanglinlin-trial', updatedAt: NOW });
    expect(r).toEqual({ at: NOW, actor: { type: 'ai', name: 'zhanglinlin-trial' } });
  });

  it('done 且无 statusChangedAt：回退 updatedAt，经手人 null（任务没有活动流可查，未记录）', () => {
    const r = resolveTaskOutcome({ status: 'done', statusChangedAt: null, statusActorType: null, statusActorName: null, updatedAt: NOW });
    expect(r).toEqual({ at: NOW, actor: null });
  });

  it.each(['todo', 'doing', 'review', 'verifying', 'cancelled'])('%s 状态不是「已完成」，返回 null', (status) => {
    expect(resolveTaskOutcome({ status, statusChangedAt: null, statusActorType: null, statusActorName: null, updatedAt: NOW })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && TEST_DATABASE_URL='postgresql://postgres:test@127.0.0.1:55432/postgres' npx vitest run src/services/stats.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: Write minimal implementation**

```typescript
// server/src/services/stats.ts
/**
 * 统计页聚合（R85，docs/计划/07 §7.16）。
 * 「今天」按北京时间自然日；缺陷修复完成 = verified，或老流程 verified→closed；
 * 任务完成 = done。全部只读，不改任何写路径、不新增表。
 */

export interface ActorRef {
  type: 'user' | 'ai';
  name: string;
}

export interface BugOutcome {
  kind: 'fixed' | 'closed_unfixed';
  at: Date;
  actor: ActorRef | null;
}

export interface TaskOutcome {
  at: Date;
  actor: ActorRef | null;
}

/** 从最后一条「状态变更」评论解析出的兜底信息（无 statusChangedAt 的老数据才需要） */
export interface LegacyLookup {
  /** 转移前的状态码（如 'verified'） */
  from: string;
  at: Date;
  actor: ActorRef | null;
}

interface StatusFields {
  status: string;
  statusChangedAt: Date | null;
  statusActorType: string | null;
  statusActorName: string | null;
  updatedAt: Date;
}

function currentActor(row: StatusFields): ActorRef | null {
  return row.statusActorType ? { type: row.statusActorType as 'user' | 'ai', name: row.statusActorName ?? '' } : null;
}

/**
 * 缺陷是否「有结果」了，以及结果是什么。只对 verified / closed 判定；其余状态返回 null。
 * closed 且 statusChangedAt 非空时不必回看来源：R83 起 verified→closed 已被状态机禁止，
 * 能有 statusChangedAt 就说明是新规则下产生的关闭，必然不是从 verified 来的。
 */
export function resolveBugOutcome(bug: StatusFields, legacy: LegacyLookup | null): BugOutcome | null {
  if (bug.status === 'verified') {
    if (bug.statusChangedAt) return { kind: 'fixed', at: bug.statusChangedAt, actor: currentActor(bug) };
    return { kind: 'fixed', at: legacy?.at ?? bug.updatedAt, actor: legacy?.actor ?? null };
  }
  if (bug.status === 'closed') {
    if (bug.statusChangedAt) return { kind: 'closed_unfixed', at: bug.statusChangedAt, actor: currentActor(bug) };
    if (legacy) return { kind: legacy.from === 'verified' ? 'fixed' : 'closed_unfixed', at: legacy.at, actor: legacy.actor };
    return { kind: 'closed_unfixed', at: bug.updatedAt, actor: null };
  }
  return null;
}

/** 任务是否已完成（status === done）；没有活动流可查，老数据回退 updatedAt、经手人记未知（null） */
export function resolveTaskOutcome(task: StatusFields): TaskOutcome | null {
  if (task.status !== 'done') return null;
  if (task.statusChangedAt) return { at: task.statusChangedAt, actor: currentActor(task) };
  return { at: task.updatedAt, actor: null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && TEST_DATABASE_URL='postgresql://postgres:test@127.0.0.1:55432/postgres' npx vitest run src/services/stats.test.ts`
Expected: PASS，全部用例（含两个 `it.each`）绿。

- [ ] **Step 5: Commit**

```bash
cd /Users/zhanglinlin/Downloads/工作区/vibehub
git add server/src/services/stats.ts server/src/services/stats.test.ts
git commit -m "feat(stats): 缺陷/任务完成结果判定纯函数 + 单测"
```

---

### Task 4: `getStats()` 编排（真连 DB 的聚合查询）

**Files:**
- Modify: `server/src/services/stats.ts`（在 Task 3 基础上追加）
- Modify: `server/src/services/stats.test.ts`（追加集成用例）

**Interfaces:**
- Consumes:
  - `prisma`（`../core/prisma.js`）
  - `NotFoundError`（`../core/errors.js`）
  - `isStale`（`./stale.js`，签名 `isStale(status: string, since: Date|null|undefined, now?: Date): boolean`）
  - `parseStatusChangeComment`（`./stats-legacy.js`）
  - `beijingDayBounds`、`beijingTrendDays`（`./stats-time.js`）
  - `resolveBugOutcome`、`resolveTaskOutcome`、`ActorRef`、`BugOutcome`、`TaskOutcome`、`LegacyLookup`（本文件 Task 3 已定义）
- Produces（供 Task 5 路由层消费）：
  - `export interface StatsScope { projectId: string | null }`
  - `export interface StatsResult { scope: {...}; today: {...}; remaining: {...}; active: [...]; by_actor: [...]; trend: [...] }`（完整字段见下方实现）
  - `export async function getStats(scope: StatsScope, now?: Date): Promise<StatsResult>`

**关键设计点（避免实现时想岔）：**
- 只拉一次 `bugs`/`tasks`（按 `projectId` 过滤或不过滤），全部计算在内存里做，不写多条聚合 SQL——数据量小（单机部署），且这样每条规则都能单独写单测。
- 老评论只为「`statusChangedAt` 为空且状态是 verified/closed」的缺陷去查，其余缺陷不产生这条查询，避免全表扫 `bug_comments`。
- `by_actor` 的行只在真的要给某个 actor 加计数时才创建（`Map.get(key) ?? 新建`），所以「全为 0 的不列」是自然结果，不需要额外过滤步骤。
- 「现在谁在做什么」（`active`）与「按密钥·手上」（`by_actor.in_hand_*`）状态集合**不同**：`active` 包含 resolved/review（等别人接手，也要显示），`by_actor.in_hand_*` 不包含它们（不算在这个人「手上」）。这是规格里明确写的区分，不是疏漏。

- [ ] **Step 1: Write the failing test（追加到 stats.test.ts 末尾）**

先把 `stats.test.ts` 顶部（Task 3 写的）这一行：

```typescript
import { describe, it, expect } from 'vitest';
```

改成：

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
```

再在它下面新增：

```typescript
import { prisma } from '../core/prisma.js';
import { resetDb } from '../test-helpers.js';
import { getStats } from './stats.js';
```

然后在文件末尾（Task 3 的两个 `describe` 块之后）追加下面这段——直接用顶部已导入的 `describe`/`it`/`expect`/`beforeEach`，不用再单独 import 一次：

```typescript
// 追加到 server/src/services/stats.test.ts 末尾

const T = (iso: string) => new Date(iso);

async function makeProject(id: string, name: string) {
  return prisma.project.create({ data: { id, name, slug: `${id}-slug` } });
}

async function makeBug(over: Partial<{
  id: string; projectId: string; title: string; status: string;
  statusChangedAt: Date | null; statusActorType: string | null; statusActorName: string | null;
  createdAt: Date; updatedAt: Date;
}>) {
  return prisma.bug.create({
    data: {
      id: over.id!, projectId: over.projectId!, title: over.title ?? '测试缺陷',
      status: over.status ?? 'open',
      statusChangedAt: over.statusChangedAt ?? null,
      statusActorType: over.statusActorType ?? null,
      statusActorName: over.statusActorName ?? null,
      createdAt: over.createdAt ?? new Date(),
      updatedAt: over.updatedAt ?? new Date(),
    },
  });
}

async function makeTask(over: Partial<{
  id: string; projectId: string; title: string; status: string;
  statusChangedAt: Date | null; statusActorType: string | null; statusActorName: string | null;
  createdAt: Date; updatedAt: Date;
}>) {
  return prisma.task.create({
    data: {
      id: over.id!, projectId: over.projectId!, title: over.title ?? '测试任务',
      status: over.status ?? 'todo',
      statusChangedAt: over.statusChangedAt ?? null,
      statusActorType: over.statusActorType ?? null,
      statusActorName: over.statusActorName ?? null,
      createdAt: over.createdAt ?? new Date(),
      updatedAt: over.updatedAt ?? new Date(),
    },
  });
}

describe('getStats（集成，真连测试库）', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('今天修复完成 / 完成任务 / 新增：按北京日界线精确计数', async () => {
    const p = await makeProject('prj_s1', '统计项目');
    const now = T('2026-09-25T04:00:00.000Z'); // 北京 2026-09-25 12:00
    // 今天 00:00 北京 = 2026-09-24T16:00:00Z；今天验证完成的缺陷
    await makeBug({ id: 'bug_s1', projectId: p.id, status: 'verified', statusChangedAt: T('2026-09-24T16:00:00.000Z'), statusActorType: 'ai', statusActorName: 'zhanglinlin-trial' });
    // 昨天（日界线前 1ms）验证完成的缺陷：不算今天
    await makeBug({ id: 'bug_s2', projectId: p.id, status: 'verified', statusChangedAt: T('2026-09-24T15:59:59.999Z'), statusActorType: 'ai', statusActorName: 'k' });
    // 今天不修关闭的缺陷
    await makeBug({ id: 'bug_s3', projectId: p.id, status: 'closed', statusChangedAt: T('2026-09-25T01:00:00.000Z'), statusActorType: 'user', statusActorName: '王五' });
    // 今天新建的缺陷（还 open）
    await makeBug({ id: 'bug_s4', projectId: p.id, status: 'open', createdAt: T('2026-09-25T00:00:00.000Z') });
    // 今天完成的任务
    await makeTask({ id: 'tsk_s1', projectId: p.id, status: 'done', statusChangedAt: T('2026-09-25T02:00:00.000Z'), statusActorType: 'ai', statusActorName: 'zhanglinlin-trial' });
    // 今天新建的任务
    await makeTask({ id: 'tsk_s2', projectId: p.id, status: 'todo', createdAt: T('2026-09-25T03:00:00.000Z') });

    const r = await getStats({ projectId: p.id }, now);
    expect(r.scope).toEqual({ project_id: p.id, today: '2026-09-25', timezone: 'Asia/Shanghai', days: 14 });
    expect(r.today).toEqual({ bugs_fixed: 1, bugs_closed_unfixed: 1, tasks_done: 1, bugs_created: 2, tasks_created: 2 });
  });

  it('还剩多少：三个桶分类正确，cancelled 任务不计入任何剩余桶', async () => {
    const p = await makeProject('prj_s2', '剩余项目');
    await makeBug({ id: 'bug_r1', projectId: p.id, status: 'open' });
    await makeBug({ id: 'bug_r2', projectId: p.id, status: 'in_progress' });
    await makeBug({ id: 'bug_r3', projectId: p.id, status: 'resolved' });
    await makeBug({ id: 'bug_r4', projectId: p.id, status: 'verifying' });
    await makeTask({ id: 'tsk_r1', projectId: p.id, status: 'todo' });
    await makeTask({ id: 'tsk_r2', projectId: p.id, status: 'doing' });
    await makeTask({ id: 'tsk_r3', projectId: p.id, status: 'review' });
    await makeTask({ id: 'tsk_r4', projectId: p.id, status: 'verifying' });
    await makeTask({ id: 'tsk_r5', projectId: p.id, status: 'cancelled' });

    const r = await getStats({ projectId: p.id }, new Date());
    expect(r.remaining).toEqual({
      bugs: { unresolved: 2, unverified: 2 },
      tasks: { todo: 1, doing: 1, unverified: 2 },
    });
  });

  it('active：只含处理中/等验证的条目，排序为「卡住的在前，其余按停留时长降序」', async () => {
    const p = await makeProject('prj_s3', '活跃项目');
    const now = T('2026-09-25T10:00:00.000Z');
    // 进行中，卡了 30 小时（超 24h 阈值）
    await makeBug({ id: 'bug_a1', projectId: p.id, title: '卡住的缺陷', status: 'in_progress', statusChangedAt: T('2026-09-24T04:00:00.000Z'), statusActorType: 'ai', statusActorName: 'k1' });
    // 进行中，才 1 小时
    await makeBug({ id: 'bug_a2', projectId: p.id, title: '刚开始的缺陷', status: 'in_progress', statusChangedAt: T('2026-09-25T09:00:00.000Z'), statusActorType: 'ai', statusActorName: 'k1' });
    // 已解决（等验证），停了 5 小时——待验证类无阈值，不该标 stale
    await makeBug({ id: 'bug_a3', projectId: p.id, title: '等验证的缺陷', status: 'resolved', statusChangedAt: T('2026-09-25T05:00:00.000Z'), statusActorType: 'user', statusActorName: '甲' });
    // 已验证：不在 active 里
    await makeBug({ id: 'bug_a4', projectId: p.id, title: '已验证不显示', status: 'verified', statusChangedAt: now });
    // 已取消任务：不在 active 里
    await makeTask({ id: 'tsk_a1', projectId: p.id, title: '已取消不显示', status: 'cancelled', statusChangedAt: now });

    const r = await getStats({ projectId: p.id }, now);
    expect(r.active.map((a) => a.title)).toEqual(['卡住的缺陷', '等验证的缺陷', '刚开始的缺陷']);
    expect(r.active.find((a) => a.title === '卡住的缺陷')?.stale).toBe(true);
    expect(r.active.find((a) => a.title === '等验证的缺陷')?.stale).toBe(false);
    expect(r.active.find((a) => a.title === '刚开始的缺陷')?.stale).toBe(false);
  });

  it('by_actor：手上不含 resolved/review，今天完成数按人归集，全 0 的不出现', async () => {
    const p = await makeProject('prj_s4', '经手人项目');
    const now = T('2026-09-25T10:00:00.000Z');
    await makeBug({ id: 'bug_b1', projectId: p.id, status: 'in_progress', statusChangedAt: now, statusActorType: 'ai', statusActorName: 'zhanglinlin-trial' });
    // resolved：不计入 in_hand_bugs（虽然出现在 active 里）
    await makeBug({ id: 'bug_b2', projectId: p.id, status: 'resolved', statusChangedAt: now, statusActorType: 'ai', statusActorName: 'zhanglinlin-trial' });
    await makeBug({ id: 'bug_b3', projectId: p.id, status: 'verified', statusChangedAt: now, statusActorType: 'ai', statusActorName: 'zhanglinlin-trial' });
    await makeTask({ id: 'tsk_b1', projectId: p.id, status: 'doing', statusChangedAt: now, statusActorType: 'ai', statusActorName: 'zhanglinlin-trial' });
    // 另一个人，只完成了一个任务
    await makeTask({ id: 'tsk_b2', projectId: p.id, status: 'done', statusChangedAt: now, statusActorType: 'user', statusActorName: '赵六' });

    const r = await getStats({ projectId: p.id }, now);
    const byName = new Map(r.by_actor.map((a) => [a.name, a]));
    expect(byName.get('zhanglinlin-trial')).toEqual({ type: 'ai', name: 'zhanglinlin-trial', in_hand_bugs: 1, in_hand_tasks: 1, fixed_today: 1, done_today: 0 });
    expect(byName.get('赵六')).toEqual({ type: 'user', name: '赵六', in_hand_bugs: 0, in_hand_tasks: 0, fixed_today: 0, done_today: 1 });
    expect(r.by_actor).toHaveLength(2); // 没有全 0 的第三行
  });

  it('trend：14 条，旧→新，最后一条含今天新算出的完成数', async () => {
    const p = await makeProject('prj_s5', '趋势项目');
    const now = T('2026-09-25T10:00:00.000Z');
    await makeBug({ id: 'bug_t1', projectId: p.id, status: 'verified', statusChangedAt: now });
    await makeTask({ id: 'tsk_t1', projectId: p.id, status: 'done', statusChangedAt: now });

    const r = await getStats({ projectId: p.id }, now);
    expect(r.trend).toHaveLength(14);
    expect(r.trend[13]).toEqual({ date: '2026-09-25', bugs_fixed: 1, tasks_done: 1 });
    expect(r.trend[0].date).toBe('2026-09-12');
    expect(r.trend[0]).toEqual({ date: '2026-09-12', bugs_fixed: 0, tasks_done: 0 });
  });

  it('项目范围：projectId=null 聚合全部项目；指定 projectId 只看该项目', async () => {
    const p1 = await makeProject('prj_s6a', '项目甲');
    const p2 = await makeProject('prj_s6b', '项目乙');
    const now = T('2026-09-25T10:00:00.000Z');
    await makeBug({ id: 'bug_c1', projectId: p1.id, status: 'verified', statusChangedAt: now });
    await makeBug({ id: 'bug_c2', projectId: p2.id, status: 'verified', statusChangedAt: now });

    const all = await getStats({ projectId: null }, now);
    expect(all.today.bugs_fixed).toBe(2);
    expect(all.scope.project_id).toBeNull();

    const onlyP1 = await getStats({ projectId: p1.id }, now);
    expect(onlyP1.today.bugs_fixed).toBe(1);
    expect(onlyP1.scope.project_id).toBe(p1.id);
  });

  it('老数据兜底：statusChangedAt 为空的 closed 缺陷，靠最后一条状态变更评论判定 fixed/closed_unfixed', async () => {
    const p = await makeProject('prj_s7', '老数据项目');
    const now = T('2026-09-25T10:00:00.000Z');
    const fixedBug = await makeBug({ id: 'bug_l1', projectId: p.id, status: 'closed', statusChangedAt: null, updatedAt: now });
    await prisma.bugComment.create({
      data: { id: 'bc_l1', bugId: fixedBug.id, authorType: 'ai', authorId: null, content: '状态变更：已验证 → 已关闭', createdAt: T('2026-09-25T02:00:00.000Z') },
    });
    const unfixedBug = await makeBug({ id: 'bug_l2', projectId: p.id, status: 'closed', statusChangedAt: null, updatedAt: now });
    await prisma.bugComment.create({
      data: { id: 'bc_l2', bugId: unfixedBug.id, authorType: 'user', authorId: null, content: '状态变更：待处理 → 已关闭', createdAt: T('2026-09-25T03:00:00.000Z') },
    });

    const r = await getStats({ projectId: p.id }, now);
    expect(r.today.bugs_fixed).toBe(1);
    expect(r.today.bugs_closed_unfixed).toBe(1);
  });

  it('老数据经手人：AI 评论的 authorId 是密钥 id，能查到就用密钥名，密钥已不存在则经手人为 null', async () => {
    const p = await makeProject('prj_s8', '密钥回溯项目');
    const now = T('2026-09-25T10:00:00.000Z');
    const key = await prisma.apiKey.create({ data: { id: 'key_l1', name: 'old-cursor-key', keyPrefix: 'vhk_test_old1', keyHash: 'h', salt: 's' } });
    const bugWithKey = await makeBug({ id: 'bug_l3', projectId: p.id, status: 'verified', statusChangedAt: null, updatedAt: now });
    await prisma.bugComment.create({ data: { id: 'bc_l3', bugId: bugWithKey.id, authorType: 'ai', authorId: key.id, content: '状态变更：验证中 → 已验证', createdAt: now } });
    const bugDanglingKey = await makeBug({ id: 'bug_l4', projectId: p.id, status: 'verified', statusChangedAt: null, updatedAt: now });
    await prisma.bugComment.create({ data: { id: 'bc_l4', bugId: bugDanglingKey.id, authorType: 'ai', authorId: 'key_deleted_long_ago', content: '状态变更：验证中 → 已验证', createdAt: now } });

    const r = await getStats({ projectId: p.id }, now);
    // verified 不在 active 里，改从 by_actor 断言
    expect(r.by_actor.find((a) => a.name === 'old-cursor-key')?.fixed_today).toBe(1);
    // 找不到密钥名的那条不会污染任何 by_actor 行（actor=null 不计入任何人）
    expect(r.by_actor.every((a) => a.name !== 'key_deleted_long_ago')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && TEST_DATABASE_URL='postgresql://postgres:test@127.0.0.1:55432/postgres' npx vitest run src/services/stats.test.ts`
Expected: FAIL — `getStats is not a function`（Task 3 只导出了两个 resolve 函数）。

- [ ] **Step 3: Write minimal implementation（追加到 stats.ts 末尾，并在文件顶部补 import）**

在文件顶部 import 区新增：

```typescript
import { prisma } from '../core/prisma.js';
import { parseStatusChangeComment } from './stats-legacy.js';
import { beijingDayBounds, beijingTrendDays } from './stats-time.js';
import { isStale } from './stale.js';
```

在 Task 3 已写的 `resolveTaskOutcome` 函数之后追加：

```typescript
export interface StatsScope {
  /** null = 全部项目 */
  projectId: string | null;
}

interface ActiveItem {
  kind: 'bug' | 'task';
  id: string;
  title: string;
  status: string;
  project_id: string;
  actor: ActorRef | null;
  since: string;
  stale: boolean;
}

interface ByActorRow {
  type: 'user' | 'ai';
  name: string;
  in_hand_bugs: number;
  in_hand_tasks: number;
  fixed_today: number;
  done_today: number;
}

export interface StatsResult {
  scope: { project_id: string | null; today: string; timezone: string; days: number };
  today: { bugs_fixed: number; bugs_closed_unfixed: number; tasks_done: number; bugs_created: number; tasks_created: number };
  remaining: {
    bugs: { unresolved: number; unverified: number };
    tasks: { todo: number; doing: number; unverified: number };
  };
  active: ActiveItem[];
  by_actor: ByActorRow[];
  trend: { date: string; bugs_fixed: number; tasks_done: number }[];
}

const TREND_DAYS = 14;
/** 「手上」不含 resolved/review（等别人接手，不算在这个人手上）；active 列表包含它们 */
const BUG_ACTIVE_STATUSES = ['in_progress', 'resolved', 'verifying'];
const BUG_IN_HAND_STATUSES = ['in_progress', 'verifying'];
const TASK_ACTIVE_STATUSES = ['doing', 'review', 'verifying'];
const TASK_IN_HAND_STATUSES = ['doing', 'verifying'];

function inRange(at: Date, start: Date, end: Date): boolean {
  return at.getTime() >= start.getTime() && at.getTime() < end.getTime();
}

function actorKey(actor: ActorRef): string {
  return `${actor.type}::${actor.name}`;
}

function getOrCreateActorRow(map: Map<string, ByActorRow>, actor: ActorRef): ByActorRow {
  const key = actorKey(actor);
  let row = map.get(key);
  if (!row) {
    row = { type: actor.type, name: actor.name, in_hand_bugs: 0, in_hand_tasks: 0, fixed_today: 0, done_today: 0 };
    map.set(key, row);
  }
  return row;
}

export async function getStats(scope: StatsScope, now: Date = new Date()): Promise<StatsResult> {
  const where = scope.projectId ? { projectId: scope.projectId } : {};
  const [bugs, tasks] = await Promise.all([
    prisma.bug.findMany({
      where,
      select: { id: true, projectId: true, title: true, status: true, statusChangedAt: true, statusActorType: true, statusActorName: true, createdAt: true, updatedAt: true },
    }),
    prisma.task.findMany({
      where,
      select: { id: true, projectId: true, title: true, status: true, statusChangedAt: true, statusActorType: true, statusActorName: true, createdAt: true, updatedAt: true },
    }),
  ]);

  // 老数据兜底：只为「无 statusChangedAt 且已到终态」的缺陷查评论，避免全表扫描
  const legacyBugIds = bugs.filter((b) => !b.statusChangedAt && (b.status === 'verified' || b.status === 'closed')).map((b) => b.id);
  const legacyLookupByBugId = await buildLegacyLookup(legacyBugIds);

  const bugOutcomes = new Map(bugs.map((b) => [b.id, resolveBugOutcome(b, legacyLookupByBugId.get(b.id) ?? null)]));
  const taskOutcomes = new Map(tasks.map((t) => [t.id, resolveTaskOutcome(t)]));

  const todayBounds = beijingDayBounds(now);

  // ── 今天 ──
  let bugsFixed = 0, bugsClosedUnfixed = 0, tasksDone = 0;
  for (const outcome of bugOutcomes.values()) {
    if (!outcome || !inRange(outcome.at, todayBounds.start, todayBounds.end)) continue;
    if (outcome.kind === 'fixed') bugsFixed++; else bugsClosedUnfixed++;
  }
  for (const outcome of taskOutcomes.values()) {
    if (outcome && inRange(outcome.at, todayBounds.start, todayBounds.end)) tasksDone++;
  }
  const bugsCreated = bugs.filter((b) => inRange(b.createdAt, todayBounds.start, todayBounds.end)).length;
  const tasksCreated = tasks.filter((t) => inRange(t.createdAt, todayBounds.start, todayBounds.end)).length;

  // ── 还剩多少 ──
  const remaining = {
    bugs: {
      unresolved: bugs.filter((b) => b.status === 'open' || b.status === 'in_progress').length,
      unverified: bugs.filter((b) => b.status === 'resolved' || b.status === 'verifying').length,
    },
    tasks: {
      todo: tasks.filter((t) => t.status === 'todo').length,
      doing: tasks.filter((t) => t.status === 'doing').length,
      unverified: tasks.filter((t) => t.status === 'review' || t.status === 'verifying').length,
    },
  };

  // ── 现在谁在做什么 ──
  const active: ActiveItem[] = [];
  for (const b of bugs) {
    if (!BUG_ACTIVE_STATUSES.includes(b.status)) continue;
    const since = b.statusChangedAt ?? legacyLookupByBugId.get(b.id)?.at ?? b.updatedAt;
    const actor = b.statusActorType ? { type: b.statusActorType as 'user' | 'ai', name: b.statusActorName ?? '' } : legacyLookupByBugId.get(b.id)?.actor ?? null;
    active.push({ kind: 'bug', id: b.id, title: b.title, status: b.status, project_id: b.projectId, actor, since: since.toISOString(), stale: isStale(b.status, since, now) });
  }
  for (const t of tasks) {
    if (!TASK_ACTIVE_STATUSES.includes(t.status)) continue;
    const since = t.statusChangedAt ?? t.updatedAt;
    const actor = t.statusActorType ? { type: t.statusActorType as 'user' | 'ai', name: t.statusActorName ?? '' } : null;
    active.push({ kind: 'task', id: t.id, title: t.title, status: t.status, project_id: t.projectId, actor, since: since.toISOString(), stale: isStale(t.status, since, now) });
  }
  active.sort((a, b) => (Number(b.stale) - Number(a.stale)) || (new Date(a.since).getTime() - new Date(b.since).getTime()));

  // ── 按密钥 ──
  const byActor = new Map<string, ByActorRow>();
  for (const b of bugs) {
    if (!BUG_IN_HAND_STATUSES.includes(b.status) || !b.statusActorType) continue;
    getOrCreateActorRow(byActor, { type: b.statusActorType as 'user' | 'ai', name: b.statusActorName ?? '' }).in_hand_bugs++;
  }
  for (const t of tasks) {
    if (!TASK_IN_HAND_STATUSES.includes(t.status) || !t.statusActorType) continue;
    getOrCreateActorRow(byActor, { type: t.statusActorType as 'user' | 'ai', name: t.statusActorName ?? '' }).in_hand_tasks++;
  }
  for (const outcome of bugOutcomes.values()) {
    if (!outcome || outcome.kind !== 'fixed' || !outcome.actor || !inRange(outcome.at, todayBounds.start, todayBounds.end)) continue;
    getOrCreateActorRow(byActor, outcome.actor).fixed_today++;
  }
  for (const outcome of taskOutcomes.values()) {
    if (!outcome || !outcome.actor || !inRange(outcome.at, todayBounds.start, todayBounds.end)) continue;
    getOrCreateActorRow(byActor, outcome.actor).done_today++;
  }

  // ── 最近 14 天趋势 ──
  const trendDays = beijingTrendDays(now, TREND_DAYS);
  const trend = trendDays.map((d) => {
    let bugsFixedDay = 0, tasksDoneDay = 0;
    for (const outcome of bugOutcomes.values()) if (outcome?.kind === 'fixed' && inRange(outcome.at, d.start, d.end)) bugsFixedDay++;
    for (const outcome of taskOutcomes.values()) if (outcome && inRange(outcome.at, d.start, d.end)) tasksDoneDay++;
    return { date: d.dateStr, bugs_fixed: bugsFixedDay, tasks_done: tasksDoneDay };
  });

  return {
    scope: { project_id: scope.projectId, today: todayBounds.dateStr, timezone: 'Asia/Shanghai', days: TREND_DAYS },
    today: { bugs_fixed: bugsFixed, bugs_closed_unfixed: bugsClosedUnfixed, tasks_done: tasksDone, bugs_created: bugsCreated, tasks_created: tasksCreated },
    remaining,
    active,
    by_actor: [...byActor.values()],
    trend,
  };
}

/** 批量查「最后一条状态变更评论」+ 批量解析作者名，避免逐条 N+1 查询 */
async function buildLegacyLookup(bugIds: string[]): Promise<Map<string, LegacyLookup>> {
  const out = new Map<string, LegacyLookup>();
  if (bugIds.length === 0) return out;

  const comments = await prisma.bugComment.findMany({
    where: { bugId: { in: bugIds }, content: { startsWith: '状态变更：' } },
    orderBy: [{ bugId: 'asc' }, { createdAt: 'desc' }],
  });
  // 按 bugId 升序 + createdAt 降序排列后，每个 bugId 分组里第一条就是最新一条
  const lastCommentByBugId = new Map<string, (typeof comments)[number]>();
  for (const c of comments) if (!lastCommentByBugId.has(c.bugId)) lastCommentByBugId.set(c.bugId, c);

  const aiAuthorIds = [...new Set([...lastCommentByBugId.values()].filter((c) => c.authorType === 'ai' && c.authorId).map((c) => c.authorId!))];
  const userAuthorIds = [...new Set([...lastCommentByBugId.values()].filter((c) => c.authorType === 'user' && c.authorId).map((c) => c.authorId!))];
  const [keys, users] = await Promise.all([
    aiAuthorIds.length ? prisma.apiKey.findMany({ where: { id: { in: aiAuthorIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    userAuthorIds.length ? prisma.user.findMany({ where: { id: { in: userAuthorIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const nameByKeyId = new Map(keys.map((k) => [k.id, k.name]));
  const nameByUserId = new Map(users.map((u) => [u.id, u.name]));

  for (const [bugId, comment] of lastCommentByBugId) {
    const parsed = parseStatusChangeComment(comment.content);
    if (!parsed) continue;
    const name = comment.authorType === 'ai'
      ? (comment.authorId ? nameByKeyId.get(comment.authorId) ?? null : null)
      : (comment.authorId ? nameByUserId.get(comment.authorId) ?? null : null);
    out.set(bugId, {
      from: parsed.from,
      at: comment.createdAt,
      actor: name ? { type: comment.authorType as 'user' | 'ai', name } : null,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && TEST_DATABASE_URL='postgresql://postgres:test@127.0.0.1:55432/postgres' npx vitest run src/services/stats.test.ts`
Expected: PASS，Task 3 的纯函数用例 + 本任务的 9 个集成用例全绿。

若某个断言失败，先看是不是「今天 00:00 北京」算错了（真实值应为 `2026-09-24T16:00:00.000Z`），或 `active` 排序比较器写反——这两处最容易出小错，不要改测试去迁就实现。

- [ ] **Step 5: Commit**

```bash
cd /Users/zhanglinlin/Downloads/工作区/vibehub
git add server/src/services/stats.ts server/src/services/stats.test.ts
git commit -m "feat(stats): getStats 聚合编排（今天/剩余/活跃/按密钥/趋势）+ 集成测试"
```

---

### Task 5: `GET /api/stats` 路由

**Files:**
- Create: `server/src/routes/stats.ts`
- Create: `server/src/routes/stats.test.ts`
- Modify: `server/src/index.ts`

**Interfaces:**
- Consumes:
  - `getStats`、`StatsResult`（`../services/stats.js`）
  - `getProject`（`../services/projects.js`，已存在，未知 id 抛 `NotFoundError` → 全局错误处理器已把它转成 404）
- Produces: `export const statsRoutes: FastifyPluginAsync`

**路由行为**：`GET /api/stats?project_id=<id>|all`（缺省同 `all`）；任何登录用户可读（不加 `requireRole`，与 `taskRoutes` 的 GET 列表一致）；`project_id` 既不是 `all` 也不是空，就先 `getProject()` 校验存在性（顺带把 404 交给已有错误处理器，不用自己写 404 分支）。

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/routes/stats.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../index.js';
import { resetDb, authHeaders } from '../test-helpers.js';

let app: FastifyInstance;

beforeEach(async () => {
  await resetDb();
  app = await buildServer();
  await app.ready();
});

describe('GET /api/stats', () => {
  it('未登录 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats' });
    expect(res.statusCode).toBe(401);
  });

  it('viewer（只读成员）也能读（统计不是写操作）', async () => {
    const ownerHeaders = await authHeaders(app, 'owner-v2@t.com');
    const viewerEmail = 'viewer-v@t.com';
    const created = await app.inject({ method: 'POST', url: '/api/users', headers: ownerHeaders, payload: { email: viewerEmail, name: 'V', role: 'viewer' } });
    expect(created.statusCode, JSON.stringify(created.json())).toBe(201);
    const body = created.json() as { one_time_password?: string; user?: { one_time_password?: string } };
    const onePwd = body.one_time_password ?? body.user?.one_time_password;
    const viewerLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: viewerEmail, password: onePwd } });
    expect(viewerLogin.statusCode, JSON.stringify(viewerLogin.json())).toBe(200);
    const viewerHeaders = { authorization: `Bearer ${viewerLogin.json().access_token}` };

    const res = await app.inject({ method: 'GET', url: '/api/stats', headers: viewerHeaders });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('today');
  });

  it('缺省（不传 project_id）= 全部项目：scope.project_id 为 null', async () => {
    const headers = await authHeaders(app, 'owner-a@t.com');
    const res = await app.inject({ method: 'GET', url: '/api/stats', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().scope.project_id).toBeNull();
  });

  it('project_id=all 与缺省等价', async () => {
    const headers = await authHeaders(app, 'owner-b@t.com');
    const res = await app.inject({ method: 'GET', url: '/api/stats?project_id=all', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().scope.project_id).toBeNull();
  });

  it('project_id 指定已存在的项目：scope.project_id 回显该 id', async () => {
    const headers = await authHeaders(app, 'owner-c@t.com');
    const proj = await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { name: 'P' } });
    const pid = proj.json().id as string;
    const res = await app.inject({ method: 'GET', url: `/api/stats?project_id=${pid}`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().scope.project_id).toBe(pid);
  });

  it('project_id 指定不存在的项目 → 404', async () => {
    const headers = await authHeaders(app, 'owner-d@t.com');
    const res = await app.inject({ method: 'GET', url: '/api/stats?project_id=prj_does_not_exist', headers });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('响应形状完整（五个分区都在）', async () => {
    const headers = await authHeaders(app, 'owner-e@t.com');
    const res = await app.inject({ method: 'GET', url: '/api/stats', headers });
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['active', 'by_actor', 'remaining', 'scope', 'today', 'trend']);
    expect(body.trend).toHaveLength(14);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && TEST_DATABASE_URL='postgresql://postgres:test@127.0.0.1:55432/postgres' npx vitest run src/routes/stats.test.ts`
Expected: FAIL — 模块不存在（`routes/stats.ts` 还没创建）。

- [ ] **Step 3: Write minimal implementation**

```typescript
// server/src/routes/stats.ts
import type { FastifyPluginAsync } from 'fastify';
import { getStats } from '../services/stats.js';
import { getProject } from '../services/projects.js';

/**
 * GET /api/stats?project_id=<id>|all —— 统计页聚合（R85）。
 * 只读、不改任何写路径；任何登录用户可读（含 viewer）。
 */
export const statsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request) => {
    const { project_id: rawProjectId } = request.query as { project_id?: string };
    let projectId: string | null = null;
    if (rawProjectId && rawProjectId !== 'all') {
      await getProject(rawProjectId); // 未知项目在这里抛 NotFoundError → 全局错误处理器转 404
      projectId = rawProjectId;
    }
    return getStats({ projectId });
  });
};
```

在 `server/src/index.ts` 的 import 区，`import { systemRoutes } from './routes/system.js';` 下方新增：

```typescript
import { statsRoutes } from './routes/stats.js';
```

在 `guarded` 数组里，`[systemRoutes, '/api/system'],` 这一行之后新增：

```typescript
    [statsRoutes, '/api/stats'],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && TEST_DATABASE_URL='postgresql://postgres:test@127.0.0.1:55432/postgres' npx vitest run src/routes/stats.test.ts`
Expected: PASS，7 个用例全绿。

Run: `cd server && npx tsc --noEmit`
Expected: 0 错误。

- [ ] **Step 5: Commit**

```bash
cd /Users/zhanglinlin/Downloads/工作区/vibehub
git add server/src/routes/stats.ts server/src/routes/stats.test.ts server/src/index.ts
git commit -m "feat(stats): GET /api/stats 路由 + 注册 + 接口测试"
```

---

### Task 6: 前端数据层——类型、纯函数、API 客户端方法

**Files:**
- Create: `web/src/lib/stats-types.ts`
- Create: `web/src/lib/stats-view.ts`
- Create: `web/src/lib/stats-view.test.ts`
- Modify: `web/src/lib/api.ts`

**Interfaces:**
- Produces（供 Task 9/10/11 消费）：
  - `web/src/lib/stats-types.ts`：`StatsActorRef`、`StatsToday`、`StatsRemaining`、`StatsActiveItem`、`StatsByActor`、`StatsTrendPoint`、`StatsResponse`
  - `web/src/lib/stats-view.ts`：
    - `export function sortByActorActivity(rows: StatsByActor[]): StatsByActor[]` —— 按「手上未结 + 今天完成」总量降序（API 不保证顺序），打平按名字排序保证结果稳定。
    - `export function scopeParam(projectId: string | null): string` —— `projectId ?? 'all'`。
  - `web/src/lib/api.ts`：`api.stats(params: { projectId: string | null }): Promise<StatsResponse>` —— 内部用 `scopeParam` 拼查询串，**不重复写一遍 `?? 'all'`**。

**顺序很重要**：`stats-types.ts` 先建（`stats-view.ts` 要用它的 `StatsByActor` 类型）；`stats-view.ts` 第二（`api.ts` 要用它的 `scopeParam`）；`api.ts` 最后改。三者放一个任务里做完，避免中间态出现「改了 api.ts 但 scopeParam 还不存在」这种半吊子提交。

- [ ] **Step 1: Create the types file**

```typescript
// web/src/lib/stats-types.ts
/** GET /api/stats 响应类型（R85 统计页，见 docs/计划/07 §7.16） */

export interface StatsActorRef {
  type: 'user' | 'ai';
  name: string;
}

export interface StatsToday {
  bugs_fixed: number;
  bugs_closed_unfixed: number;
  tasks_done: number;
  bugs_created: number;
  tasks_created: number;
}

export interface StatsRemaining {
  bugs: { unresolved: number; unverified: number };
  tasks: { todo: number; doing: number; unverified: number };
}

export interface StatsActiveItem {
  kind: 'bug' | 'task';
  id: string;
  title: string;
  status: string;
  project_id: string;
  actor: StatsActorRef | null;
  since: string;
  stale: boolean;
}

export interface StatsByActor {
  type: 'user' | 'ai';
  name: string;
  in_hand_bugs: number;
  in_hand_tasks: number;
  fixed_today: number;
  done_today: number;
}

export interface StatsTrendPoint {
  date: string;
  bugs_fixed: number;
  tasks_done: number;
}

export interface StatsResponse {
  scope: { project_id: string | null; today: string; timezone: string; days: number };
  today: StatsToday;
  remaining: StatsRemaining;
  active: StatsActiveItem[];
  by_actor: StatsByActor[];
  trend: StatsTrendPoint[];
}
```

- [ ] **Step 2: Write the failing test for the pure helpers**

```typescript
// web/src/lib/stats-view.test.ts
import { describe, it, expect } from 'vitest';
import { sortByActorActivity, scopeParam } from './stats-view';
import type { StatsByActor } from './stats-types';

function row(over: Partial<StatsByActor>): StatsByActor {
  return { type: 'ai', name: 'x', in_hand_bugs: 0, in_hand_tasks: 0, fixed_today: 0, done_today: 0, ...over };
}

describe('sortByActorActivity', () => {
  it('按总活跃度（手上 + 今天完成）降序', () => {
    const rows = [
      row({ name: 'A', in_hand_bugs: 1 }), // 总量 1
      row({ name: 'B', in_hand_bugs: 2, done_today: 3 }), // 总量 5
      row({ name: 'C', fixed_today: 1 }), // 总量 1
    ];
    const sorted = sortByActorActivity(rows);
    expect(sorted[0].name).toBe('B');
  });

  it('总量相同时按名字排序，结果稳定', () => {
    const rows = [row({ name: '赵六', in_hand_bugs: 1 }), row({ name: '甲', in_hand_bugs: 1 })];
    expect(sortByActorActivity(rows).map((r) => r.name)).toEqual(['甲', '赵六']);
  });

  it('不修改原数组（纯函数）', () => {
    const rows = [row({ name: 'A' }), row({ name: 'B', in_hand_bugs: 1 })];
    const original = [...rows];
    sortByActorActivity(rows);
    expect(rows).toEqual(original);
  });

  it('空数组返回空数组', () => {
    expect(sortByActorActivity([])).toEqual([]);
  });
});

describe('scopeParam', () => {
  it('null 映射为 "all"', () => {
    expect(scopeParam(null)).toBe('all');
  });

  it('有项目 id 时原样透传', () => {
    expect(scopeParam('prj_123')).toBe('prj_123');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && npx vitest run --root ../web src/lib/stats-view.test.ts`
Expected: FAIL — `./stats-view` 模块不存在。

- [ ] **Step 4: Write the pure helpers implementation**

```typescript
// web/src/lib/stats-view.ts
import type { StatsByActor } from './stats-types';

/** 手上未结 + 今天完成 的总量，用来给「按密钥」表排序（API 不保证顺序） */
function activityScore(row: StatsByActor): number {
  return row.in_hand_bugs + row.in_hand_tasks + row.fixed_today + row.done_today;
}

/** 活跃度降序；打平按名字排序，结果稳定 */
export function sortByActorActivity(rows: StatsByActor[]): StatsByActor[] {
  return [...rows].sort((a, b) => activityScore(b) - activityScore(a) || a.name.localeCompare(b.name));
}

/** api.stats 的 project_id 查询参数：null（全部项目）映射为 'all' */
export function scopeParam(projectId: string | null): string {
  return projectId ?? 'all';
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run --root ../web src/lib/stats-view.test.ts`
Expected: PASS，6 个用例全绿。

- [ ] **Step 6: Wire the API client method**

在 `web/src/lib/api.ts` 顶部 import 区，`import { taskApi, skillApi } from './api-more';` 下方新增：

```typescript
import type { StatsResponse } from './stats-types';
import { scopeParam } from './stats-view';
```

在 `api` 对象内、`// ============ AI 活动（卡片 36，全员可读） ============` 这一段上方新增：

```typescript
  // ============ 统计（R85，全员可读） ============
  stats: (params: { projectId: string | null }) => request<StatsResponse>(`/stats?project_id=${scopeParam(params.projectId)}`),

```

- [ ] **Step 7: Verify**

Run: `cd web && npx tsc --noEmit`
Expected: 0 错误。

- [ ] **Step 8: Commit**

```bash
cd /Users/zhanglinlin/Downloads/工作区/vibehub
git add web/src/lib/stats-types.ts web/src/lib/stats-view.ts web/src/lib/stats-view.test.ts web/src/lib/api.ts
git commit -m "feat(stats): 前端 StatsResponse 类型 + 按密钥排序/scope 纯函数 + api.stats() 客户端方法"
```

---

### Task 7: 数据中枢新增 `statsRevision`

**Files:**
- Modify: `web/src/hooks/use-vibehub-store.ts`

**Interfaces:**
- Produces: `VibeHubStore.statsRevision: number`（与既有 `taskRevision`/`skillRevision` 同款——`bug.*`/`task.*` 事件或轮询兜底时自增，供 Task 11 的统计页 `useEffect` 依赖）

**为什么没有单测**：这个 hooks 文件在仓库里目前没有任何独立单测（`web/src/hooks/` 下没有 `*.test.ts`），全站的验证方式是 E2E；`statsRevision` 会在 Task 12 的 E2E 用例里被间接验证（缺陷/任务状态变化后统计页数字确实刷新）。本任务只用 `tsc` 把关。

- [ ] **Step 1: Modify the store**

在 `web/src/hooks/use-vibehub-store.ts` 的 `VibeHubStore` 接口里，`skillRevision: number;` 下方新增一行：

```typescript
  /** 缺陷/任务有变化（SSE 或轮询）时递增，统计页据此重新拉取 */
  statsRevision: number;
```

在 `useVibeHubStore()` 函数体内，`const [skillRevision, setSkillRevision] = useState(0);` 下方新增：

```typescript
  const [statsRevision, setStatsRevision] = useState(0);
```

在 `useLiveUpdates` 的 `onEvent` 回调里，找到：

```typescript
    onEvent: (type) => {
      if (type.startsWith('bug.')) void d.refreshBoard();
      if (type.startsWith('task.')) setTaskRevision((n) => n + 1);
      if (type.startsWith('skill.')) setSkillRevision((n) => n + 1);
      if (type.startsWith('note.')) void d.refreshNotes();
      if (type.startsWith('attachment.')) void d.refreshAttachments();
    },
```

改成：

```typescript
    onEvent: (type) => {
      if (type.startsWith('bug.')) { void d.refreshBoard(); setStatsRevision((n) => n + 1); }
      if (type.startsWith('task.')) { setTaskRevision((n) => n + 1); setStatsRevision((n) => n + 1); }
      if (type.startsWith('skill.')) setSkillRevision((n) => n + 1);
      if (type.startsWith('note.')) void d.refreshNotes();
      if (type.startsWith('attachment.')) void d.refreshAttachments();
    },
```

在同一个 `useLiveUpdates` 调用的 `onPoll` 回调里，找到：

```typescript
    onPoll: () => {
      void d.refreshBoard();
      void d.refreshNotes();
      setTaskRevision((n) => n + 1);
    },
```

改成：

```typescript
    onPoll: () => {
      void d.refreshBoard();
      void d.refreshNotes();
      setTaskRevision((n) => n + 1);
      setStatsRevision((n) => n + 1);
    },
```

最后在函数末尾的返回对象里，找到：

```typescript
    projects: p.projects, currentProject, loading: p.loading, sseConnected, error, taskRevision, skillRevision,
```

改成：

```typescript
    projects: p.projects, currentProject, loading: p.loading, sseConnected, error, taskRevision, skillRevision, statsRevision,
```

- [ ] **Step 2: Verify**

Run: `cd web && npx tsc --noEmit`
Expected: 0 错误（`VibeHubStore` 接口新增字段与返回对象新增字段一一对应，缺一个 tsc 就会报 `Property 'statsRevision' is missing`）。

- [ ] **Step 3: Commit**

```bash
cd /Users/zhanglinlin/Downloads/工作区/vibehub
git add web/src/hooks/use-vibehub-store.ts
git commit -m "feat(stats): 数据中枢新增 statsRevision（缺陷/任务变化时递增）"
```

---

### Task 8: 侧栏入口 + 全局快捷键

**Files:**
- Modify: `web/src/components/layout/Sidebar.tsx`
- Modify: `web/src/app/(app)/layout.tsx`

**Interfaces:** 无新接口，纯配置项新增。

- [ ] **Step 1: Add the nav item**

在 `web/src/components/layout/Sidebar.tsx` 顶部 lucide-react 的 import 列表里加入 `BarChart3`：

```typescript
import {
  BarChart3,
  ChevronDown,
  Lock,
  FolderKanban,
  Image as ImageIcon,
  KeyRound,
  ListChecks,
  Puzzle,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  StickyNote,
  Users,
} from 'lucide-react';
```

在 `NAV_ITEMS` 数组里，`{ href: '/skills', ... }` 那一行之后、`{ href: '/projects', ... }` 之前插入：

```typescript
  { href: '/stats', label: '统计', icon: BarChart3, combo: 'G D', group: 'primary' },
```

- [ ] **Step 2: Add the global hotkey**

在 `web/src/app/(app)/layout.tsx` 的 `useHotkeys([...])` 数组里，`{ combo: 'g s', description: '技能', handler: () => router.push('/skills') },` 之后新增：

```typescript
    { combo: 'g d', description: '统计', handler: () => router.push('/stats') },
```

- [ ] **Step 3: Verify**

Run: `cd web && npx tsc --noEmit`
Expected: 0 错误。

- [ ] **Step 4: Commit**

```bash
cd /Users/zhanglinlin/Downloads/工作区/vibehub
git add web/src/components/layout/Sidebar.tsx "web/src/app/(app)/layout.tsx"
git commit -m "feat(stats): 侧栏「统计」入口 + G D 快捷键"
```

---

### Task 9: `StatsActiveList` 组件（现在谁在做什么）

**Files:**
- Create: `web/src/components/stats/StatsActiveList.tsx`

**Interfaces:**
- Consumes:
  - `StatsActiveItem`（`@/lib/stats-types`）
  - `formatSpan`（`@/lib/stale`，已存在：`(ms: number) => string`）
  - `useMinuteClock`（`@/hooks/use-minute-clock`，已存在：`() => number`）
  - `BUG_STATUS_LABELS`（`@/lib/api-types`，已存在）
  - `TASK_STATUS_LABELS`（`@/lib/task-flow`，已存在）
- Produces: `export function StatsActiveList({ items, onOpen }: { items: StatsActiveItem[]; onOpen: (item: StatsActiveItem) => void }): JSX.Element`

**不用 `HandlingLine`**：`HandlingLine` 内部调用 `lib/stale.ts` 的 `handlingOf()`，只认 `verifying`/`in_progress`/`doing` 三个状态；`active` 列表里还要显示 `resolved`/`review`（无 stale 阈值但仍要显示「谁 · 多久」），所以这里直接用 API 已经算好的 `since`/`stale` 字段渲染，只借用 `formatSpan` 做时长文案、`useMinuteClock` 让文案跟着分钟跳，不碰 `lib/stale.ts` 本身。

- [ ] **Step 1: Write the component**

```tsx
// web/src/components/stats/StatsActiveList.tsx
'use client';

import { AlertTriangle, Sparkles, User } from 'lucide-react';
import { formatSpan } from '@/lib/stale';
import { useMinuteClock } from '@/hooks/use-minute-clock';
import { BUG_STATUS_LABELS } from '@/lib/api-types';
import { TASK_STATUS_LABELS, type TaskStatus } from '@/lib/task-flow';
import type { StatsActiveItem } from '@/lib/stats-types';
import type { BugStatus } from '@/lib/bug-flow';

function statusLabel(item: StatsActiveItem): string {
  return item.kind === 'bug' ? BUG_STATUS_LABELS[item.status as BugStatus] ?? item.status : TASK_STATUS_LABELS[item.status as TaskStatus] ?? item.status;
}

/** 统计页「现在谁在做什么」一行：标题 + 状态 + 经手人 + 停留时长；卡住的标红 */
function ActiveRow({ item, now, onOpen }: { item: StatsActiveItem; now: number; onOpen: (item: StatsActiveItem) => void }) {
  const elapsed = now - new Date(item.since).getTime();
  const span = formatSpan(elapsed);
  const Icon = item.stale ? AlertTriangle : item.actor?.type === 'ai' ? Sparkles : User;
  const who = item.actor ? item.actor.name : '未记录';
  return (
    <button
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-[var(--bg-elevated)] cursor-pointer"
      onClick={() => onOpen(item)}
      data-testid="stats-active-row"
      data-stale={item.stale ? 'true' : 'false'}
    >
      <span className={`rounded px-1.5 py-0.5 text-[10px] shrink-0 ${item.stale ? 'bg-[var(--danger)]/15 text-[var(--danger)]' : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]'}`}>
        {statusLabel(item)}
      </span>
      <span className="flex-1 truncate text-[var(--text-primary)]">{item.title}</span>
      <span className={`flex shrink-0 items-center gap-1 whitespace-nowrap ${item.stale ? 'text-[var(--danger)]' : 'text-[var(--text-tertiary)]'}`}>
        <Icon size={11} />
        {who} · {item.stale ? `已停留 ${span}` : span}
      </span>
    </button>
  );
}

export function StatsActiveList({ items, onOpen }: { items: StatsActiveItem[]; onOpen: (item: StatsActiveItem) => void }) {
  const now = useMinuteClock();
  if (items.length === 0) {
    return <p className="py-6 text-center text-xs text-[var(--text-tertiary)]">现在没有正在处理或等验证的条目</p>;
  }
  return (
    <div className="space-y-0.5" data-testid="stats-active-list">
      {items.map((item) => (
        <ActiveRow key={`${item.kind}-${item.id}`} item={item} now={now} onOpen={onOpen} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `cd web && npx tsc --noEmit`
Expected: 0 错误。此刻组件还没被任何页面引用，`tsc` 只检查类型正确性；渲染验证留到 Task 11 装配进页面后一起做。

- [ ] **Step 3: Commit**

```bash
cd /Users/zhanglinlin/Downloads/工作区/vibehub
git add web/src/components/stats/StatsActiveList.tsx
git commit -m "feat(stats): StatsActiveList 组件（现在谁在做什么）"
```

---

### Task 10: `StatsTrendChart` 组件（14 天趋势）

**Files:**
- Create: `web/src/components/stats/StatsTrendChart.tsx`

**Interfaces:**
- Consumes: `StatsTrendPoint`（`@/lib/stats-types`）
- Produces: `export function StatsTrendChart({ points }: { points: StatsTrendPoint[] }): JSX.Element`

**沿用 `KeyUsageChart` 的 flex/div 柱状图写法**（`web/src/components/keys/KeyWizard.tsx:198-244`），双系列版本：每天两根并排的柱子（金色=修复完成的缺陷，蓝色=完成的任务），不引入 SVG 或任何图表库。

- [ ] **Step 1: Write the component**

```tsx
// web/src/components/stats/StatsTrendChart.tsx
'use client';

import type { StatsTrendPoint } from '@/lib/stats-types';

/**
 * 最近 14 天趋势：每天两根并排柱子（缺陷修复完成 / 任务完成）。
 * 与 KeyUsageChart（keys 页）同款 flex/div 高度柱状图写法，不引新依赖。
 */
export function StatsTrendChart({ points }: { points: StatsTrendPoint[] }) {
  const max = Math.max(...points.map((p) => Math.max(p.bugs_fixed, p.tasks_done)), 1);
  const hasAny = points.some((p) => p.bugs_fixed > 0 || p.tasks_done > 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-[10px] text-[var(--text-tertiary)]">
        <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm bg-[var(--gold)]" />缺陷修复完成</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm bg-[var(--brand)]" />任务完成</span>
      </div>
      {!hasAny && <p className="py-6 text-center text-xs text-[var(--text-tertiary)]">最近 14 天还没有完成记录</p>}
      <div className="flex h-28 items-end gap-1.5" data-testid="stats-trend-chart">
        {points.map((p) => (
          <div key={p.date} className="group relative flex flex-1 flex-col items-center gap-0.5">
            <div className="flex h-full w-full items-end gap-0.5">
              <div
                className="flex-1 rounded-t bg-[var(--gold)]/70 transition-all hover:bg-[var(--gold)]"
                style={{ height: `${Math.max(2, (p.bugs_fixed / max) * 100)}%` }}
                title={`${p.date}：修复 ${p.bugs_fixed} 个缺陷`}
              />
              <div
                className="flex-1 rounded-t bg-[var(--brand)]/70 transition-all hover:bg-[var(--brand)]"
                style={{ height: `${Math.max(2, (p.tasks_done / max) * 100)}%` }}
                title={`${p.date}：完成 ${p.tasks_done} 个任务`}
              />
            </div>
            <span className="hidden text-[9px] text-[var(--text-tertiary)] group-hover:block">{p.date.slice(5)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `cd web && npx tsc --noEmit`
Expected: 0 错误。

- [ ] **Step 3: Commit**

```bash
cd /Users/zhanglinlin/Downloads/工作区/vibehub
git add web/src/components/stats/StatsTrendChart.tsx
git commit -m "feat(stats): StatsTrendChart 组件（14 天双系列柱状图）"
```

---

### Task 11: 统计页 `/stats`（装配）

**Files:**
- Create: `web/src/app/(app)/stats/page.tsx`

**Interfaces:**
- Consumes: 前面全部任务的产出——`api.stats`、`sortByActorActivity`（Task 6）、`store.statsRevision`（Task 7）、`StatsActiveList`（Task 9）、`StatsTrendChart`（Task 10）、`CurrentProjectSwitcher`（`@/components/layout/CurrentProjectSwitcher`，已存在）、`useVibeHub`（`@/hooks/use-vibehub`）、`useToast`（`@/lib/toast`）。

**行为**：
- 页头：`CurrentProjectSwitcher` + 「当前项目 / 全部项目」分段切换（默认「当前项目」，纯本地 state，不持久化）+ 手动刷新按钮。
- 「今天」四个数字 tile（今天修复完成的缺陷 / 今天完成的任务 / 今天新增缺陷 / 今天新增任务）+ 小字「另有 N 个不修/重复关闭」。
- 「还剩多少」两组 tile（缺陷：未解决/未验证；任务：待办/进行中/未验收）。
- 「现在谁在做什么」：`StatsActiveList`，点缺陷行跳看板（先切当前项目），点任务行跳 `/tasks?task=<id>`（同样先切当前项目）。
- 「按密钥」表格：`sortByActorActivity` 排过序的 `by_actor`。
- 「最近 14 天」：`StatsTrendChart`。
- 数据加载：`store.statsRevision` 变化即重取；页面可见时每 30s 轮询一次；手动刷新按钮。

**注意**：本页只用 `api.stats({ projectId })` 传原始的 `projectId`（`string | null`），不需要自己再调 `scopeParam`——查询串的拼接已经封在 `api.stats` 内部（Task 6 Step 6），页面这层不重复处理。

- [ ] **Step 1: Write the page**

```tsx
// web/src/app/(app)/stats/page.tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, RefreshCw } from 'lucide-react';
import { useVibeHub } from '@/hooks/use-vibehub';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { sortByActorActivity } from '@/lib/stats-view';
import { CurrentProjectSwitcher } from '@/components/layout/CurrentProjectSwitcher';
import { StatsActiveList } from '@/components/stats/StatsActiveList';
import { StatsTrendChart } from '@/components/stats/StatsTrendChart';
import type { StatsActiveItem, StatsResponse } from '@/lib/stats-types';

type Scope = 'current' | 'all';
const POLL_INTERVAL_MS = 30_000;

/** 统计页（R85，docs/计划/07 §7.16）：今天产出、还剩多少、现在谁在做什么、按密钥、14 天趋势 */
export default function StatsPage() {
  const store = useVibeHub();
  const toast = useToast();
  const router = useRouter();
  const [scope, setScope] = useState<Scope>('current');
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const projectId = scope === 'current' ? store.currentProject?.id ?? null : null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.stats({ projectId }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载统计失败');
    } finally {
      setLoading(false);
    }
  }, [projectId, toast]);

  useEffect(() => {
    void load();
  }, [load, store.statsRevision]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const openActiveItem = (item: StatsActiveItem) => {
    if (item.project_id !== store.currentProject?.id) store.selectProject(item.project_id);
    router.push(item.kind === 'bug' ? '/board' : `/tasks?task=${item.id}`);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* 页头 */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-2.5">
        <CurrentProjectSwitcher />
        <div className="flex gap-1 rounded-lg bg-[var(--bg-elevated)] p-0.5">
          {(['current', 'all'] as const).map((s) => (
            <button
              key={s}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                scope === s ? 'bg-[var(--bg-page)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-tertiary)]'
              }`}
              onClick={() => setScope(s)}
              data-testid={`stats-scope-${s}`}
            >
              {s === 'current' ? '当前项目' : '全部项目'}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {data && <span className="text-[11px] text-[var(--text-tertiary)]">{data.scope.today}</span>}
        <button className="vh-btn ghost h-8 text-xs" onClick={() => void load()} title="刷新" data-testid="stats-refresh">
          <RefreshCw size={13} className={loading ? 'animate-spin' : undefined} />
        </button>
      </div>

      <div className="flex-1 space-y-5 p-4">
        {!data ? (
          <p className="py-10 text-center text-xs text-[var(--text-tertiary)]">加载中…</p>
        ) : (
          <>
            {/* 今天 */}
            <section>
              <h2 className="mb-2 text-xs font-medium text-[var(--text-tertiary)]">今天</h2>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Tile label="修复完成的缺陷" value={data.today.bugs_fixed} accent="var(--ok)" />
                <Tile label="完成的任务" value={data.today.tasks_done} accent="var(--ok)" />
                <Tile label="新增缺陷" value={data.today.bugs_created} />
                <Tile label="新增任务" value={data.today.tasks_created} />
              </div>
              {data.today.bugs_closed_unfixed > 0 && (
                <p className="mt-1.5 text-[11px] text-[var(--text-tertiary)]">另有 {data.today.bugs_closed_unfixed} 个缺陷今天按「不修 / 重复」关闭</p>
              )}
            </section>

            {/* 还剩多少 */}
            <section>
              <h2 className="mb-2 text-xs font-medium text-[var(--text-tertiary)]">还剩多少</h2>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Tile label="缺陷·未解决" value={data.remaining.bugs.unresolved} />
                <Tile label="缺陷·未验证" value={data.remaining.bugs.unverified} accent="var(--warn)" />
                <Tile label="任务·待办" value={data.remaining.tasks.todo} />
                <Tile label="任务·进行中" value={data.remaining.tasks.doing} />
                <Tile label="任务·未验收" value={data.remaining.tasks.unverified} accent="var(--warn)" />
              </div>
            </section>

            {/* 现在谁在做什么 */}
            <section>
              <h2 className="mb-2 text-xs font-medium text-[var(--text-tertiary)]">现在谁在做什么</h2>
              <div className="rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-card)] p-1.5">
                <StatsActiveList items={data.active} onOpen={openActiveItem} />
              </div>
            </section>

            {/* 按密钥 */}
            <section>
              <h2 className="mb-2 text-xs font-medium text-[var(--text-tertiary)]">按密钥</h2>
              {data.by_actor.length === 0 ? (
                <p className="py-4 text-center text-xs text-[var(--text-tertiary)]">还没有可归集的经手记录</p>
              ) : (
                <table className="w-full text-xs" data-testid="stats-by-actor-table">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-left text-[10px] text-[var(--text-tertiary)]">
                      <th className="pb-1.5 pl-1 font-medium">经手人</th>
                      <th className="pb-1.5 font-medium">手上缺陷</th>
                      <th className="pb-1.5 font-medium">手上任务</th>
                      <th className="pb-1.5 font-medium">今天修复</th>
                      <th className="pb-1.5 font-medium">今天完成</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortByActorActivity(data.by_actor).map((row) => (
                      <tr key={`${row.type}-${row.name}`} className="border-b border-[var(--border-subtle)]/50">
                        <td className="py-1.5 pl-1 font-medium text-[var(--text-primary)]">
                          {row.name}
                          {row.type === 'ai' && <span className="ml-1.5 rounded bg-[var(--brand-soft)] px-1 py-0.5 text-[9px] text-[var(--brand)]">AI</span>}
                        </td>
                        <td className="py-1.5">{row.in_hand_bugs}</td>
                        <td className="py-1.5">{row.in_hand_tasks}</td>
                        <td className="py-1.5">{row.fixed_today}</td>
                        <td className="py-1.5">{row.done_today}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* 趋势 */}
            <section>
              <h2 className="mb-2 text-xs font-medium text-[var(--text-tertiary)]">最近 14 天</h2>
              <div className="rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                <StatsTrendChart points={data.trend} />
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3.5 py-2.5">
      <p className="flex items-center gap-1 text-[11px] text-[var(--text-tertiary)]"><BarChart3 size={11} />{label}</p>
      <p className="mt-0.5 text-xl font-semibold" style={{ color: accent ?? 'var(--text-primary)' }}>{value}</p>
    </div>
  );
}
```

- [ ] **Step 2: Verify types + line-count contract**

Run: `cd web && npx tsc --noEmit`
Expected: 0 错误。

Run: `wc -l "web/src/app/(app)/stats/page.tsx"`
Expected: ≤300（AGENTS.md §6 前端契约单文件行数上限）；若超了，把 `Tile` 组件拆到 `components/stats/StatsTile.tsx` 再引入。

- [ ] **Step 3: Manual smoke check**

```bash
cd /Users/zhanglinlin/Downloads/工作区/vibehub
npm run dev:server &
sleep 3
npm run dev:web &
```

浏览器打开 `http://127.0.0.1:3211/board`，登录后按 `G` 再按 `D`，确认跳到 `/stats` 且页面渲染出五个分区（此时多半全是 0，因为还没有真实数据——这一步只验证「不报错、结构完整」，不验证数字准确性，准确性由 Task 4/12 的自动化测试保证）。看完后 `kill %1 %2` 结束两个后台进程。

- [ ] **Step 4: Commit**

```bash
cd /Users/zhanglinlin/Downloads/工作区/vibehub
git add "web/src/app/(app)/stats/page.tsx"
git commit -m "feat(stats): /stats 页面装配（今天/剩余/活跃/按密钥/趋势）"
```

---

### Task 12: E2E——抽出 `connectMcp` 夹具 + 统计页闭环测试

**Files:**
- Modify: `server/tests/e2e/fixtures.ts`
- Modify: `server/tests/e2e/core-loop.spec.ts`
- Create: `server/tests/e2e/stats.spec.ts`

**Interfaces:**
- Consumes: `createOwnerWithProject`、`gotoBoardWithSession`（`./fixtures.js`，已存在）
- Produces: `export function connectMcp(apiKey: string): Promise<{ call: (name: string, args?: Record<string, unknown>) => Promise<any>; close: () => void }>`（从 `core-loop.spec.ts` 里的私有实现原样搬到 `fixtures.ts` 并导出，供 `stats.spec.ts` 复用，避免拷贝一份重复的 stdio 客户端代码）

- [ ] **Step 1: 把 `connectMcp` 从 core-loop.spec.ts 搬到 fixtures.ts**

在 `server/tests/e2e/fixtures.ts` 顶部 import 区新增：

```typescript
import { spawn } from 'node:child_process';
```

在文件末尾（`openBugDetail` 之后）追加：

```typescript
const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export interface McpClient {
  call: (name: string, args?: Record<string, unknown>) => Promise<any>;
  close: () => void;
}

/**
 * MCP stdio 子进程客户端（与 IDE 同款传输）。
 * DATABASE_URL 必须与 HTTP 服务同库：父进程缺 DATABASE_URL 时会继承 server/.env 的 dev 库，
 * 查不到测试库里的密钥 → 子进程 exit 1 → initialize 超时（历史踩坑）。
 */
export async function connectMcp(apiKey: string): Promise<McpClient> {
  const child = spawn('npx', ['tsx', 'src/mcp-entry.ts'], {
    cwd: SERVER_DIR,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, VIBEHUB_API_KEY: apiKey },
  });
  let buf = '';
  let nextId = 1;
  const pending = new Map<number, (v: any) => void>();
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && pending.has(msg.id)) {
          pending.get(msg.id)?.(msg);
          pending.delete(msg.id);
        }
      } catch {
        /* 非 JSON 行忽略（stdout 只应有 JSON-RPC） */
      }
    }
  });
  child.stderr.on('data', () => {});
  const send = (method: string, params?: unknown) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      setTimeout(() => reject(new Error(`MCP ${method} 超时`)), 25_000);
    });
  await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  return {
    call: (name, args = {}) => send('tools/call', { name, arguments: args }),
    close: () => child.kill(),
  };
}
```

- [ ] **Step 2: `core-loop.spec.ts` 改用导入的 `connectMcp`，删掉本地实现**

在 `server/tests/e2e/core-loop.spec.ts` 里：
1. 删除 `import { spawn } from 'node:child_process';`、`import path from 'node:path';`、`import { fileURLToPath } from 'node:url';` 这三行（不再需要，`connectMcp` 已经把这些用掉了）。
2. 把 `import { createOwnerWithProject, gotoBoardWithSession, openCreateDialog } from './fixtures.js';` 改成：
   ```typescript
   import { createOwnerWithProject, gotoBoardWithSession, openCreateDialog, connectMcp } from './fixtures.js';
   ```
3. 删除文件里 `const SERVER_DIR = ...` 到 `connectMcp` 函数结束（含 `interface McpClient` 声明）的整段本地实现——即从 `const SERVER_DIR = path.resolve(...)` 开始，到 `async function connectMcp(apiKey: string): Promise<McpClient> { ... }` 函数体结束的所有代码，全部删掉（这段逻辑已经原样搬进 `fixtures.ts` 了）。
4. 文件里唯一调用点 `const mcp = await connectMcp(key);` 保持不变（现在解析到导入的版本）。

- [ ] **Step 3: Run existing E2E to verify the refactor didn't break it**

Run:
```bash
cd server
bash scripts/test-db.sh
docker exec vibehub-test-db psql -U postgres -q -c 'TRUNCATE "bug_comments","bugs","attachments","saved_views","bug_templates","notes","tasks","usage_events","refresh_tokens","api_keys","projects","users","embeddings","skill_files","skills" RESTART IDENTITY CASCADE'
rm -f tests/e2e/.test-owner.json
cd ../web && npx next build && cd ../server
DATABASE_URL='postgresql://postgres:test@127.0.0.1:55432/postgres' DATA_DIR=./acceptance-e2e-data PORT=3457 EMBEDDING_PROVIDER=none LOGIN_MAX_ATTEMPTS=100 npx tsx src/index.ts &
sleep 3
DATABASE_URL='postgresql://postgres:test@127.0.0.1:55432/postgres' E2E_BASE=http://127.0.0.1:3457 npx playwright test -c playwright.config.ts tests/e2e/core-loop.spec.ts
```
Expected: PASS（1 个用例通过）——证明抽出 `connectMcp` 没有改变行为。跑完后 `kill %1` 结束后台服务、`rm -rf acceptance-e2e-data`。

- [ ] **Step 4: Write the failing stats E2E test**

```typescript
// server/tests/e2e/stats.spec.ts
import { test, expect } from '@playwright/test';
import { createOwnerWithProject, connectMcp } from './fixtures.js';

/**
 * 统计页闭环（R85）：经 MCP 把一个缺陷走到 verified、完成一个任务后，
 * 统计页「今天」两项各 +1，「按密钥」行显示该密钥名。
 * 前置同 core-loop.spec.ts：空测试库、DATABASE_URL 与 HTTP 服务同库。
 */
if (!process.env.DATABASE_URL) {
  throw new Error('E2E 需要 DATABASE_URL（与 E2E 服务同库）；请经 bash scripts/acceptance.sh 运行，或显式设置 DATABASE_URL');
}

const KEY_NAME = 'e2e-stats-key';

test('MCP 把缺陷验证完成、任务完成后，统计页今天数字与按密钥行都更新', async ({ page }) => {
  const session = await createOwnerWithProject(`统计闭环 ${Date.now()}`);
  const { api, token, project } = session;
  const headers = { authorization: `Bearer ${token}` };

  const bugRes = await api.post('/api/bugs', { headers, data: { project_id: project.id, title: '统计闭环：登录接口偶发 500' } });
  expect(bugRes.status()).toBe(201);
  const bugId = (await bugRes.json()).id as string;

  const taskRes = await api.post('/api/tasks', { headers, data: { project_id: project.id, title: '统计闭环：补充接口重试逻辑' } });
  expect(taskRes.status()).toBe(201);
  const taskId = (await taskRes.json()).id as string;

  const keyRes = await api.post('/api/api-keys', {
    headers,
    data: { name: KEY_NAME, scopes: ['context:read', 'bug:write', 'task:write'] },
  });
  expect(keyRes.status()).toBe(201);
  const { key } = await keyRes.json();

  const mcp = await connectMcp(key);
  try {
    for (const status of ['in_progress', 'resolved', 'verifying', 'verified']) {
      const r = await mcp.call('update_bug_status', { bug_id: bugId, status, resolution_notes: status === 'resolved' ? '已定位并修复' : undefined });
      expect(r.result?.isError ?? r.isError ?? false, JSON.stringify(r).slice(0, 200)).toBe(false);
    }
    for (const status of ['doing', 'review', 'verifying', 'done']) {
      const r = await mcp.call('update_task', { task_id: taskId, status });
      expect(r.result?.isError ?? r.isError ?? false, JSON.stringify(r).slice(0, 200)).toBe(false);
    }
  } finally {
    mcp.close();
  }

  // 直接注入登录态进统计页（复用 fixtures 的写法，不经 gotoBoardWithSession 以免多余跳转）
  await page.addInitScript(([t]) => {
    localStorage.setItem('vibehub_token', t as string);
    localStorage.setItem('vibehub_onboarded', '1');
  }, [token]);
  await page.goto('/stats');
  await expect(page.getByTestId('stats-refresh')).toBeVisible();

  await expect
    .poll(async () => {
      const res = await api.get(`/api/stats?project_id=${project.id}`, { headers });
      return (await res.json()).today.bugs_fixed;
    }, { message: '接口应统计到今天修复完成 1 个缺陷', timeout: 15_000 })
    .toBe(1);

  await page.getByTestId('stats-refresh').click();
  await expect(page.getByText('修复完成的缺陷')).toBeVisible();
  const todaySection = page.locator('section', { hasText: '今天' }).first();
  await expect(todaySection.getByText('1', { exact: true }).first()).toBeVisible();

  await expect(page.getByTestId('stats-by-actor-table')).toBeVisible();
  const actorRow = page.getByTestId('stats-by-actor-table').locator('tr', { hasText: KEY_NAME });
  await expect(actorRow).toBeVisible();
  await expect(actorRow).toContainText('AI');

  await api.dispose();
});
```

- [ ] **Step 5: Run test to verify it fails (or passes if lucky — check for the right reason either way)**

Run:
```bash
cd server
docker exec vibehub-test-db psql -U postgres -q -c 'TRUNCATE "bug_comments","bugs","attachments","saved_views","bug_templates","notes","tasks","usage_events","refresh_tokens","api_keys","projects","users","embeddings","skill_files","skills" RESTART IDENTITY CASCADE'
rm -f tests/e2e/.test-owner.json
DATABASE_URL='postgresql://postgres:test@127.0.0.1:55432/postgres' DATA_DIR=./acceptance-e2e-data PORT=3457 EMBEDDING_PROVIDER=none LOGIN_MAX_ATTEMPTS=100 npx tsx src/index.ts &
sleep 3
DATABASE_URL='postgresql://postgres:test@127.0.0.1:55432/postgres' E2E_BASE=http://127.0.0.1:3457 npx playwright test -c playwright.config.ts tests/e2e/stats.spec.ts
```
Expected: 在 Task 5/11 都已完成的前提下，这条测试**理论上应该直接 PASS**（因为后端接口与前端页面在前面任务里都已实现并验证过）。如果失败，看失败点在哪一步：
- MCP 调用本身报错 → 检查 scope 是否给全（`bug:write`/`task:write`）、状态机是否按顺序走。
- `stats-refresh` 按钮找不到 → 说明静态产物没重建（Step 3 已 `next build` 过，若又改了前端代码要重新 build）或路由没注册进侧栏/页面文件缺失。
- 数字不是 1 → 先用 `curl` 直接打 `/api/stats?project_id=<id>` 看原始 JSON，对照 Task 4 的单测断言排查，不要瞎改前端断言迁就错误数字。

跑完记得 `kill %1`、`rm -rf acceptance-e2e-data`。

- [ ] **Step 6: Commit**

```bash
cd /Users/zhanglinlin/Downloads/工作区/vibehub
git add server/tests/e2e/fixtures.ts server/tests/e2e/core-loop.spec.ts server/tests/e2e/stats.spec.ts
git commit -m "test(stats): 抽出 connectMcp 共用夹具 + 统计页 MCP 闭环 E2E"
```

---

### Task 13: 全量验证 + 文档登记 + 收尾提交

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/计划/PROGRESS.md`

**Interfaces:** 无代码接口——本任务是门禁 + 文档收尾。

- [ ] **Step 1: 后端权威门禁**

Run: `cd /Users/zhanglinlin/Downloads/工作区/vibehub/server && bash scripts/acceptance.sh 2>&1 | tail -40`
Expected: `PASS=19  FAIL=0`（在 R84 基线上新增了 Task 1-5、12 的用例，总用例数应比之前多——用实际输出的数字，不要照抄本计划写的数字）。

- [ ] **Step 2: 前端纯函数测试 + 双端类型检查**

Run: `cd /Users/zhanglinlin/Downloads/工作区/vibehub/server && npx vitest run --root ../web 2>&1 | tail -20`
Expected: 全绿（含 Task 6 新增的 `stats-view.test.ts`）。

Run: `cd /Users/zhanglinlin/Downloads/工作区/vibehub/web && npx tsc --noEmit && npx next build 2>&1 | tail -20`
Expected: tsc 0 错误；`next build` 成功产出 `web/out/`（确认 `/stats` 出现在构建路由列表里）。

- [ ] **Step 3: 登记 AGENTS.md（R85 定向解冻记录）**

在 `AGENTS.md` 顶部说明块（`> **R83（用户决定，定向解冻）**：...` 那一段）之后新增一行：

```markdown
>
> **R85（用户决定，定向解冻）**：统计页 `/stats`——今天产出多少（修复完成的缺陷/完成的任务/新增）、还剩多少（含未验证）、现在谁在做什么（经手人=最近一次改状态的人，AI 为 MCP 密钥名）、按密钥归集、最近 14 天趋势；只读，全员可见，不改任何写路径。规格见 `docs/计划/07-功能页面规格.md` §7.16。
```

- [ ] **Step 4: 登记 PROGRESS.md**

在 `docs/计划/PROGRESS.md` 的 §3「运行日志」区块末尾（最后一行 R 记录之后）新增一行，格式与既有条目一致：

```markdown
| R85 | 用户请求「做一个统计页」→ 走完整 brainstorming→writing-plans 流程确认口径后实现：`GET /api/stats`（今天/还剩/现在谁在做什么/按密钥/14天趋势，service 层 `stats.ts`+`stats-time.ts`+`stats-legacy.ts`，老数据兜底靠解析历史「状态变更」评论），前端 `/stats` 页（侧栏「统计」入口 + `G D` 快捷键，复用 `taskRevision` 同款 `statsRevision` 刷新模式，图表沿用 `KeyUsageChart` 的 flex/div 柱状图写法不引新依赖） | `<在此填入 Step 1/2 的真实输出：acceptance.sh PASS 数、vitest 用例数、web vitest 数、tsc/build 结果>` | 待用户验收。**技能治理**：① 无新重复工作流；② 技能无需更新；③ AGENTS.md §5/§6 无新契约（沿用既有 service/route/hook 分层与 Beijing 时区做法，未新增跨功能约定，仅本功能内部实现细节） |
```

**填写前必须先执行 Step 1/2 拿到真实数字，不得照抄示例占位——`<...>` 部分必须替换成命令的真实输出摘要。**

- [ ] **Step 5: Final commit**

```bash
cd /Users/zhanglinlin/Downloads/工作区/vibehub
git add AGENTS.md docs/计划/PROGRESS.md
git commit -m "docs(stats): 登记 R85 统计页——AGENTS.md 定向解冻记录 + PROGRESS 驾驶舱"
git log --oneline main..HEAD
```

Expected: 显示本次 `feat/stats-page` 分支相对 `main` 的全部提交（约 13 条，Task 1-13），无待提交改动（`git status --short` 应为空）。

---

## 完成后交付物一览

- 后端：`services/stats-time.ts`、`services/stats-legacy.ts`、`services/stats.ts`、`routes/stats.ts` + 对应测试文件，`index.ts` 新注册一条路由。
- 前端：`lib/stats-types.ts`、`lib/stats-view.ts`（+测试）、`app/(app)/stats/page.tsx`、`components/stats/{StatsActiveList,StatsTrendChart}.tsx`，`api.ts`/`use-vibehub-store.ts`/`Sidebar.tsx`/`(app)/layout.tsx` 各有一处小改动。
- E2E：`tests/e2e/fixtures.ts` 新导出 `connectMcp`（`core-loop.spec.ts` 同步瘦身），新增 `tests/e2e/stats.spec.ts`。
- 文档：`docs/计划/07-功能页面规格.md` §7.16（已在 brainstorming 阶段写好并提交）、`AGENTS.md`、`docs/计划/PROGRESS.md`。
- 分支 `feat/stats-page`，未合并、未部署到 Docker——是否合并、是否重建 1.8 镜像部署，留给用户在验收完后明确要求（与此前每一轮的收尾方式一致，不擅自合并/部署）。
