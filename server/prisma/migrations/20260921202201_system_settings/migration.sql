/*
  Warnings:

  - You are about to drop the column `embedding` on the `embeddings` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Embedding_embedding_idx";

-- AlterTable
ALTER TABLE "embeddings" DROP COLUMN "embedding";

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);
