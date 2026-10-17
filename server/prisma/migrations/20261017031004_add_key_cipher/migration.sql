-- R87：MCP 密钥新增「明文密文」列（AES-256-GCM），供 Admin+ 随时查看/复制。
--
-- ⚠️ 向量列陷阱（AGENTS.md §4）：Prisma 不感知 embeddings.embedding（vector 类型），
-- 本次自动生成的迁移里附带了以下两句，已在落库前手工删除——保留会清空全部语义索引：
--   DROP INDEX "Embedding_embedding_idx";
--   ALTER TABLE "embeddings" DROP COLUMN "embedding";
-- 本迁移只做一件事：给 api_keys 加可空的密文列（存量行保持 NULL = 明文不可恢复）。
ALTER TABLE "api_keys" ADD COLUMN     "key_cipher" TEXT;
