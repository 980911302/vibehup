-- pgvector 列说明（raw SQL 例外，AGENTS.md §4）：Prisma 不感知 embeddings.embedding 向量列，
-- migrate dev 生成的迁移总会带上 DROP INDEX "Embedding_embedding_idx" 与 DROP COLUMN "embedding"。
-- 此处删去这两句：本迁移与向量列无关，照抄会清空全部语义索引（之前的迁移是删了再补回，数据会丢）。

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "reopen_reason" TEXT,
ADD COLUMN     "reopened_count" INTEGER NOT NULL DEFAULT 0;
