/*
  Warnings:

  - You are about to drop the column `embedding` on the `embeddings` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Embedding_embedding_idx";

-- AlterTable
ALTER TABLE "embeddings" DROP COLUMN "embedding";

-- AddForeignKey
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- pgvector 列修复（R2 模式）：Prisma 不感知 raw SQL 追加的向量列，shadow 库 diff 会误判DROP，
-- 需在 migration 末尾补回（dim=1024，与 EMBEDDING_DIM 一致）。
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE "embeddings" ADD COLUMN IF NOT EXISTS "embedding" vector(1024);
CREATE INDEX IF NOT EXISTS "Embedding_embedding_idx" ON "embeddings" USING hnsw ("embedding" vector_cosine_ops);
