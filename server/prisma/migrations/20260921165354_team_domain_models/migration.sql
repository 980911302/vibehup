-- CreateTable
CREATE TABLE "bug_comments" (
    "id" TEXT NOT NULL,
    "bug_id" TEXT NOT NULL,
    "author_type" TEXT NOT NULL,
    "author_id" TEXT,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bug_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bug_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title_template" TEXT NOT NULL,
    "fields" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bug_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_views" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" TEXT NOT NULL,
    "sort" TEXT NOT NULL,
    "columns" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "embeddings" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dim" INTEGER NOT NULL DEFAULT 1536,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bug_comments_bug_id_created_at_idx" ON "bug_comments"("bug_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "saved_views_user_id_entity_name_key" ON "saved_views"("user_id", "entity", "name");

-- CreateIndex
CREATE INDEX "embeddings_entityType_idx" ON "embeddings"("entityType");

-- CreateIndex
CREATE UNIQUE INDEX "embeddings_entityType_entityId_model_key" ON "embeddings"("entityType", "entityId", "model");

-- pgvector：Prisma 不支持 vector 类型，按 AGENTS.md 数据契约以 raw SQL 追加。
-- 放在 migration 内（而非单独脚本）以保证 shadow DB 重放一致，避免漂移误报。
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "embeddings" ADD COLUMN "embedding" vector(1536);

CREATE INDEX "Embedding_embedding_idx" ON "embeddings" USING hnsw ("embedding" vector_cosine_ops);
