-- R90 交付证据包（JSONB）。与向量列无关；按 R80 契约移除 Prisma 自动生成的 vector 重建语句。
ALTER TABLE "bugs" ADD COLUMN     "evidence" JSONB;
ALTER TABLE "tasks" ADD COLUMN     "evidence" JSONB;
