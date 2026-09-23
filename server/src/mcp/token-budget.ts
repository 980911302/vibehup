/**
 * Token 经济学（步骤 03 §3.3）——所有 MCP 工具输出必经整形。
 * 目标：让 AI 用最少 token 办最完整的事，永不撑爆上下文窗口。
 */

export interface Budget {
  /** 列表默认条数 */
  listLimit: number;
  /** 长文本字段截断阈值（字符） */
  textFieldMax: number;
  /** 便签 content 截断阈值（字符） */
  noteMax: number;
}

export const DEFAULT_BUDGET: Budget = { listLimit: 20, textFieldMax: 500, noteMax: 300 };

/** 整体输出字节上限（64KB），超过强制再截断 */
export const MAX_OUTPUT_BYTES = 64 * 1024;

export interface Paginated<T> {
  items: T[];
  total: number;
  returned: number;
  has_more: boolean;
  /** 下一页起始下标（0 基）；无下一页为 null */
  next_cursor: number | null;
}

/** 列表截断：默认 20 条 + has_more + next_cursor */
export function paginate<T>(items: T[], limit: number = DEFAULT_BUDGET.listLimit): Paginated<T> {
  const safeLimit = Math.min(Math.max(1, limit), 200);
  const slice = items.slice(0, safeLimit);
  return {
    items: slice,
    total: items.length,
    returned: slice.length,
    has_more: items.length > safeLimit,
    next_cursor: items.length > safeLimit ? safeLimit : null,
  };
}

export interface TruncatedText {
  value: string | null;
  truncated: boolean;
  original_length?: number;
}

/** 长文本字段截断：超限时附人话提示 */
export function truncateText(
  text: string | null | undefined,
  max: number = DEFAULT_BUDGET.textFieldMax,
): TruncatedText {
  if (text == null) return { value: null, truncated: false };
  if (text.length <= max) return { value: text, truncated: false };
  return {
    value: `${text.slice(0, max)}…（已截断，完整内容共 ${text.length} 字符）`,
    truncated: true,
    original_length: text.length,
  };
}

/**
 * 整体字节保护：序列化超过 MAX_OUTPUT_BYTES 时，对 items 取半数重试并附 warning。
 * 仅处理 { items: unknown[] } 形态；其他形态原样返回并附 warning。
 */
export function enforceSizeBudget<T extends { items?: unknown[] }>(
  data: T,
  maxBytes: number = MAX_OUTPUT_BYTES,
): T & { warning?: string } {
  const sizeOf = (v: unknown) => Buffer.byteLength(JSON.stringify(v ?? null));
  if (sizeOf(data) <= maxBytes) return data;

  if (Array.isArray(data.items) && data.items.length > 1) {
    const half = Math.ceil(data.items.length / 2);
    const reduced = { ...data, items: data.items.slice(0, half) };
    const result = enforceSizeBudget(reduced as T & { items: unknown[] }, maxBytes);
    return {
      ...result,
      warning: `输出超过 ${maxBytes} 字节，已自动截断至 ${result.items?.length ?? 0} 条，请用分页参数继续获取`,
    };
  }
  return { ...data, warning: `输出超过 ${maxBytes} 字节且无法继续截断，请缩小查询范围` };
}
