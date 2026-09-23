-- AlterTable
ALTER TABLE "embeddings" ALTER COLUMN "dim" SET DEFAULT 1024;

-- 语义检索（卡片 28）：向量列宽收敛到 vector(1024)（text-embedding-v3，EMBEDDING_DIM）。
-- Prisma 无 vector 类型，按 AGENTS.md 数据契约以 raw SQL 追加。
-- 自愈式：新库路径由 team_domain_models 建 vector(1536) 后在此 ALTER 到 1024；
-- 历史漂移库（列缺失，见 §4 R51）则由 ADD COLUMN IF NOT EXISTS 直接建 1024。
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE "embeddings" ADD COLUMN IF NOT EXISTS "embedding" vector(1024);
DROP INDEX IF EXISTS "Embedding_embedding_idx";
ALTER TABLE "embeddings" ALTER COLUMN "embedding" TYPE vector(1024);
CREATE INDEX "Embedding_embedding_idx" ON "embeddings" USING hnsw ("embedding" vector_cosine_ops);
