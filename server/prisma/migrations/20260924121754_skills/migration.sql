-- pgvector 列说明（raw SQL 例外，AGENTS.md §4）：Prisma 不感知 embeddings.embedding 向量列，
-- migrate dev 生成时总会带上 DROP INDEX "Embedding_embedding_idx" 与 DROP COLUMN "embedding"，
-- 本迁移与向量列无关，删去这两句以免清空语义索引。

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "project_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'human',
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_files" (
    "id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "skills_project_id_idx" ON "skills"("project_id");

-- CreateIndex
CREATE INDEX "skills_name_idx" ON "skills"("name");

-- CreateIndex
CREATE UNIQUE INDEX "skill_files_skill_id_path_key" ON "skill_files"("skill_id", "path");

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_files" ADD CONSTRAINT "skill_files_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
