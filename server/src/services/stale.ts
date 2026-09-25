import { prisma } from '../core/prisma.js';

/**
 * 「有人在处理却迟迟没结果」的判定（R83）：验证的 AI 接手后看板上要看得出它是不是还在干活。
 * 只看处理中的状态停留了多久；前端 web/src/lib/stale.ts 是同一份阈值的镜像，改这里要一起改。
 */
export const STALE_AFTER_MS: Record<string, number> = {
  verifying: 2 * 3600_000, // 验证中（缺陷 / 任务）：AI 验证通常几分钟，两小时没结论多半是验证方中断了
  in_progress: 24 * 3600_000, // 缺陷进行中
  doing: 24 * 3600_000, // 任务进行中
};

export function isStale(status: string, since: Date | null | undefined, now: Date = new Date()): boolean {
  const limit = STALE_AFTER_MS[status];
  if (!limit || !since) return false;
  return now.getTime() - since.getTime() > limit;
}

/** 流转操作人：用户记名字，AI 记密钥名（快照，改名不回溯） */
export interface StatusActor {
  type: 'user' | 'ai';
  id?: string | null;
  name?: string | null;
}

/** 解析出落库用的操作人字段；用户未给名字时按 id 查一次 */
export async function resolveStatusActor(
  actor: StatusActor | undefined,
): Promise<{ statusActorType: string | null; statusActorName: string | null }> {
  if (!actor) return { statusActorType: null, statusActorName: null };
  let name = actor.name?.trim() || null;
  if (!name && actor.type === 'user' && actor.id) {
    const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } });
    name = user?.name ?? null;
  }
  if (!name && actor.type === 'ai') name = 'AI';
  return { statusActorType: actor.type, statusActorName: name };
}
