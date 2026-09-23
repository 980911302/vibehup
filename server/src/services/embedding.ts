import { prisma } from '../core/prisma.js';
import { ids } from '../core/ids.js';
import { config } from '../config.js';

/**
 * 语义检索（卡片 28）：DashScope OpenAI 兼容模式 /embeddings。
 * - provider=none（默认）时全部能力关闭，纯关键词路径不受影响；
 * - base64 传输：DashScope 兼容模式 encoding_format=base64，响应为 float32 小端 base64；
 * - 向量列与 HNSW 索引由迁移维护（raw SQL），列宽以 EMBEDDING_DIM 为准（1024）。
 */

export function getEmbeddingConfig() {
  return config.embedding;
}

export function isEmbeddingEnabled(): boolean {
  const c = config.embedding;
  return c.provider !== 'none' && c.apiKey.length > 0;
}

/** 调用 embedding 接口，返回维度数为 config.embedding.dim 的向量 */
export async function embedText(text: string): Promise<number[]> {
  const c = config.embedding;
  if (!isEmbeddingEnabled()) {
    throw new Error('EMBEDDING_PROVIDER=none：语义检索未启用');
  }
  const input = text.slice(0, c.tokenLimit);
  const body: Record<string, unknown> = { model: c.model, input };
  if (c.sendDim) body.dimensions = c.dim;
  if (c.useBase64) body.encoding_format = 'base64';

  const res = await fetch(`${c.baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${c.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`DashScope embedding 请求失败: HTTP ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { data?: { embedding?: number[] | string }[] };
  const emb = json.data?.[0]?.embedding;
  if (!emb) throw new Error('DashScope embedding 响应缺少 data[0].embedding');

  if (typeof emb === 'string') {
    const buf = Buffer.from(emb, 'base64');
    if (buf.byteLength === 0 || buf.byteLength % 4 !== 0) {
      throw new Error('base64 embedding 长度非法');
    }
    const out: number[] = [];
    for (let i = 0; i < buf.byteLength; i += 4) out.push(buf.readFloatLE(i));
    if (out.length !== c.dim) {
      throw new Error(`embedding 维度 ${out.length} 与 EMBEDDING_DIM=${c.dim} 不一致`);
    }
    return out;
  }
  if (emb.length !== c.dim) {
    throw new Error(`embedding 维度 ${emb.length} 与 EMBEDDING_DIM=${c.dim} 不一致`);
  }
  return emb;
}

/**
 * 计算并落库实体向量（bug/note 写路径触发即算，见 §4 R51 登记）。
 * 失败仅丢语义索引、不抛断业务（内部已隔离）；关闭态直接跳过。
 */
export async function upsertEntityEmbedding(
  entityType: 'bug' | 'note',
  entityId: string,
  text: string,
): Promise<void> {
  if (!isEmbeddingEnabled()) return;
  try {
    const vector = await embedText(text);
    const c = config.embedding;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "embeddings" (id, "entityType", "entityId", model, dim, embedding, "created_at", "updated_at")
       VALUES ($1, $2, $3, $4, $5, $6::vector, now(), now())
       ON CONFLICT ("entityType", "entityId", "model")
       DO UPDATE SET embedding = EXCLUDED.embedding, dim = EXCLUDED.dim, "updated_at" = now()`,
      ids.embedding(),
      entityType,
      entityId,
      c.model,
      c.dim,
      JSON.stringify(vector),
    );
  } catch {
    // 语义索引失败不影响主流程（附件/缺陷写入可用性优先）
  }
}

export interface SimilarHit {
  entityType: string;
  entityId: string;
  distance: number;
}

/** 实体删除时清理向量（避免相似查询返回幽灵实体）；关闭态同样是 no-op */
export async function deleteEntityEmbedding(entityType: 'bug' | 'note', entityId: string): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      'DELETE FROM "embeddings" WHERE "entityType" = $1 AND "entityId" = $2',
      entityType,
      entityId,
    );
  } catch {
    // 清理失败不影响主流程
  }
}

/** 默认相关度阈值：cosine 距离 <0.5 视为相关（>0.5 不返回，防垃圾查询也出命中） */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.5;

/** cosine 距离最近的实体（dim 与列宽不一致的历史行自动过滤；超过阈值视为不相关） */
export async function similarEntities(
  query: string,
  entityTypes: string[],
  limit = 10,
  maxDistance: number = DEFAULT_SIMILARITY_THRESHOLD,
): Promise<SimilarHit[]> {
  if (!isEmbeddingEnabled() || entityTypes.length === 0) return [];
  const vector = await embedText(query);
  const c = config.embedding;
  const rows = await prisma.$queryRawUnsafe<SimilarHit[]>(
    `SELECT "entityType", "entityId", embedding <=> $1::vector AS distance
     FROM "embeddings"
     WHERE "entityType" = ANY($2::text[]) AND dim = $3 AND embedding <=> $1::vector < $4
     ORDER BY distance ASC
     LIMIT $5`,
    JSON.stringify(vector),
    entityTypes,
    c.dim,
    maxDistance,
    limit,
  );
  return rows;
}
