import type { FastifyPluginAsync } from 'fastify';
import * as activityService from '../services/activity.js';

/**
 * AI 活动路由（卡片 36）。
 * GET /api/activity/recent —— 全员可读（刻意不挂 requireRole：本特性就是让
 * 非管理员感知 AI 活动；管理员完整用量仍在密钥页 keyUsage）。数据经 service 脱敏。
 */
export const activityRoutes: FastifyPluginAsync = async (app) => {
  app.get('/recent', { preHandler: [app.authenticate] }, async () => {
    return activityService.listRecentActivity(20);
  });
};
