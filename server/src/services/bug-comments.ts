import { prisma } from '../core/prisma.js';
import { ids } from '../core/ids.js';
import { NotFoundError } from '../core/errors.js';

/**
 * 缺陷评论 / 活动流（闭环②的对话通道：人与 AI 都能追加）。
 */

export interface BugCommentView {
  id: string;
  bug_id: string;
  author_type: 'user' | 'ai';
  author_id: string | null;
  author_name: string | null;
  content: string;
  created_at: string;
}

export async function addComment(input: {
  bugId: string;
  authorType: 'user' | 'ai';
  authorId?: string | null;
  content: string;
}): Promise<{ id: string }> {
  const bug = await prisma.bug.findUnique({ where: { id: input.bugId } });
  if (!bug) throw new NotFoundError(`缺陷不存在: ${input.bugId}`);
  if (!input.content.trim()) throw new (await import('../core/errors.js')).ValidationError('评论内容不能为空');

  const id = ids.attachment();
  await prisma.bugComment.create({
    data: {
      id,
      bugId: input.bugId,
      authorType: input.authorType,
      authorId: input.authorId ?? null,
      content: input.content,
    },
  });
  return { id };
}

/** 评论列表（倒序）；author_name 为用户名快照（ai 为 null） */
export async function listComments(bugId: string): Promise<BugCommentView[]> {
  const comments = await prisma.bugComment.findMany({
    where: { bugId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const userIds = [...new Set(comments.filter((c) => c.authorType === 'user' && c.authorId).map((c) => c.authorId!))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : [];
  const nameMap = new Map(users.map((u) => [u.id, u.name]));
  return comments.map((c) => ({
    id: c.id,
    bug_id: c.bugId,
    author_type: c.authorType as 'user' | 'ai',
    author_id: c.authorId,
    author_name: c.authorId ? nameMap.get(c.authorId) ?? null : null,
    content: c.content,
    created_at: c.createdAt.toISOString(),
  }));
}
