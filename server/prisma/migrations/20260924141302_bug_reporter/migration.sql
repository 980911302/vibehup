-- pgvector 列说明（raw SQL 例外，AGENTS.md §4）：Prisma 不感知 embeddings.embedding 向量列，
-- migrate dev 生成时总会带上 DROP INDEX "Embedding_embedding_idx" 与 DROP COLUMN "embedding"，
-- 本迁移与向量列无关，删去这两句以免清空语义索引。

-- AlterTable
ALTER TABLE "bugs" ADD COLUMN     "reporter_id" TEXT;

-- CreateIndex
CREATE INDEX "bugs_project_id_reporter_id_idx" ON "bugs"("project_id", "reporter_id");

-- AddForeignKey
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
