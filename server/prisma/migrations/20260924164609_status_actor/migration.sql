-- pgvector 列说明（raw SQL 例外，AGENTS.md §4）：Prisma 不感知 embeddings.embedding 向量列，
-- migrate dev 生成的迁移总会带上 DROP INDEX "Embedding_embedding_idx" 与 DROP COLUMN "embedding"。
-- 此处删去这两句：本迁移与向量列无关，照抄会清空全部语义索引。

-- AlterTable
ALTER TABLE "bugs" ADD COLUMN     "status_actor_name" TEXT,
ADD COLUMN     "status_actor_type" TEXT,
ADD COLUMN     "status_changed_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "status_actor_name" TEXT,
ADD COLUMN     "status_actor_type" TEXT,
ADD COLUMN     "status_changed_at" TIMESTAMP(3);
