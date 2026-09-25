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
