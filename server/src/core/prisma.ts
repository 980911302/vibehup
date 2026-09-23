import { PrismaClient } from '@prisma/client';

/**
 * Prisma 客户端单例。
 * MCP Server（stdio）与 HTTP 服务共享同一数据库实例（设计文档第 6 节）。
 */
export const prisma = new PrismaClient({
  log: process.env.PRISMA_LOG === '1' ? ['query', 'warn', 'error'] : ['warn', 'error'],
});

export type Prisma = typeof prisma;
