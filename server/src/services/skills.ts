import type { Prisma, Skill } from '@prisma/client';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { prisma } from '../core/prisma.js';
import { ids } from '../core/ids.js';
import { eventBus } from '../core/events.js';
import { buildSearchIndex, matchIndex } from '../core/search.js';
import { NotFoundError, ValidationError } from '../core/errors.js';

/**
 * 技能域（Claude Code skill）：一个技能 = SKILL.md（frontmatter 写 name/description）+ 若干附带文件。
 * projectId 为空表示全团队通用；同一范围（某项目 / 通用）内按 name 唯一，再次上传即覆盖。
 */

export const SKILL_LIMITS = {
  skillMdBytes: 256 * 1024,
  fileBytes: 1024 * 1024,
  totalBytes: 5 * 1024 * 1024,
  files: 100,
  pathLength: 200,
  nameLength: 64,
  descriptionLength: 1024,
};

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const BLOCK_MARKERS = new Set(['>', '>-', '>+', '|', '|-', '|+']);

export interface SkillFileInput {
  path: string;
  data: Buffer;
}

export type SkillSummary = Omit<Skill, 'content'> & { fileCount: number; totalSize: number };

// ---------------------------------------------------------------- SKILL.md 解析

function unquote(v: string): string {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\"/g, '"');
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

/** 极简 YAML：只取顶层 key: value，支持引号、> / | 块与缩进续行（技能 frontmatter 够用） */
function parseFrontmatter(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const [, key, raw] = m;
    const cont: string[] = [];
    while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
      cont.push(lines[++i].trim());
    }
    const value = raw.trim();
    if (BLOCK_MARKERS.has(value)) {
      out[key] = value.startsWith('|') ? cont.join('\n').trim() : cont.filter(Boolean).join(' ');
    } else {
      out[key] = [unquote(value), ...cont.filter(Boolean)].filter(Boolean).join(' ');
    }
  }
  return out;
}

export function parseSkillMd(text: string): { name: string; description: string; body: string } {
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const lines = src.split('\n');
  const end = lines[0].trim() === '---' ? lines.findIndex((l, i) => i > 0 && l.trim() === '---') : -1;
  if (end < 0) {
    throw new ValidationError(
      'SKILL.md 需要以 --- 包起来的 frontmatter 开头，写明 name 和 description，例如：\n---\nname: commit-style\ndescription: 一句话说明做什么、什么时候用\n---',
    );
  }
  const meta = parseFrontmatter(lines.slice(1, end));
  const name = (meta.name ?? '').trim();
  const description = (meta.description ?? '').trim();
  if (!name) throw new ValidationError('SKILL.md 的 frontmatter 缺少 name');
  if (name.length > SKILL_LIMITS.nameLength) throw new ValidationError(`技能名最长 ${SKILL_LIMITS.nameLength} 个字符`);
  if (!NAME_RE.test(name)) {
    throw new ValidationError(`技能名「${name}」不合规：只能用小写字母、数字和连字符（Claude Code 的技能命名规则），如 commit-style`);
  }
  if (!description) throw new ValidationError('SKILL.md 的 frontmatter 缺少 description（一句话说明这个技能做什么、什么时候用）');
  if (description.length > SKILL_LIMITS.descriptionLength) {
    throw new ValidationError(`description 最长 ${SKILL_LIMITS.descriptionLength} 个字符`);
  }
  return { name, description, body: lines.slice(end + 1).join('\n') };
}

// ---------------------------------------------------------------- 附带文件

export function isTextContent(data: Uint8Array): boolean {
  if (data.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(data);
    return true;
  } catch {
    return false;
  }
}

export function normalizeSkillPath(input: string): string {
  let p = String(input ?? '').replace(/\\/g, '/').trim();
  while (p.startsWith('./')) p = p.slice(2);
  const parts = p.split('/');
  const bad = !p || p.startsWith('/') || /^[A-Za-z]:/.test(p) || parts.some((s) => s === '' || s === '.' || s === '..');
  if (bad || p.length > SKILL_LIMITS.pathLength) {
    throw new ValidationError(`文件路径「${input}」不合法：只能是技能目录内的相对路径（如 scripts/run.sh）`);
  }
  if (p === 'SKILL.md') throw new ValidationError('SKILL.md 不能作为附带文件，请把它作为技能正文上传');
  return p;
}

function prepareFiles(files: SkillFileInput[]): SkillFileInput[] {
  if (files.length > SKILL_LIMITS.files) throw new ValidationError(`附带文件最多 ${SKILL_LIMITS.files} 个`);
  const seen = new Set<string>();
  let total = 0;
  return files.map((f) => {
    const path = normalizeSkillPath(f.path);
    if (seen.has(path)) throw new ValidationError(`附带文件路径重复：${path}`);
    seen.add(path);
    if (f.data.byteLength > SKILL_LIMITS.fileBytes) throw new ValidationError(`文件「${path}」超过 1MB，技能里只放脚本和参考文档`);
    total += f.data.byteLength;
    if (total > SKILL_LIMITS.totalBytes) throw new ValidationError('附带文件总大小超过 5MB');
    return { path, data: f.data };
  });
}

// ---------------------------------------------------------------- 写

async function assertProject(projectId: string | null): Promise<void> {
  if (!projectId) return;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new NotFoundError(`项目不存在: ${projectId}`);
}

function fileRows(skillId: string, files: SkillFileInput[]): Prisma.SkillFileCreateManyInput[] {
  // Prisma Bytes 需要 ArrayBuffer 支撑的 Uint8Array（Buffer 可能落在共享池上）
  return files.map((f) => ({ id: ids.skillFile(), skillId, path: f.path, content: new Uint8Array(f.data), size: f.data.byteLength }));
}

/** 上传技能：同一范围内同名即覆盖（正文与附带文件整体替换），否则新建 */
export async function uploadSkill(input: {
  projectId: string | null;
  skillMd: string;
  files?: SkillFileInput[];
  source?: 'human' | 'ai';
  uploadedBy?: string | null;
}): Promise<{ action: 'created' | 'updated'; skill: Skill }> {
  if (Buffer.byteLength(input.skillMd ?? '') > SKILL_LIMITS.skillMdBytes) throw new ValidationError('SKILL.md 超过 256KB');
  const { name, description } = parseSkillMd(input.skillMd ?? '');
  const files = prepareFiles(input.files ?? []);
  const projectId = input.projectId || null;
  await assertProject(projectId);

  const fields = { name, description, content: input.skillMd, source: input.source ?? 'human', uploadedBy: input.uploadedBy ?? null };
  const existing = await prisma.skill.findFirst({ where: { projectId, name } });
  const skillId = existing?.id ?? ids.skill();
  const [skill] = await prisma.$transaction([
    existing
      ? prisma.skill.update({ where: { id: skillId }, data: fields })
      : prisma.skill.create({ data: { id: skillId, projectId, ...fields } }),
    prisma.skillFile.deleteMany({ where: { skillId } }),
    prisma.skillFile.createMany({ data: fileRows(skillId, files) }),
  ]);
  eventBus.publish({ type: 'skill.changed', projectId, skillId });
  return { action: existing ? 'updated' : 'created', skill };
}

export async function setSkillProject(skillId: string, projectId: string | null): Promise<Skill> {
  const skill = await getSkill(skillId);
  const target = projectId || null;
  await assertProject(target);
  const clash = await prisma.skill.findFirst({ where: { projectId: target, name: skill.name, NOT: { id: skillId } } });
  if (clash) throw new ValidationError(`目标范围已有同名技能「${skill.name}」，先删除或改名后再移动`);
  const updated = await prisma.skill.update({ where: { id: skillId }, data: { projectId: target } });
  eventBus.publish({ type: 'skill.changed', projectId: target, skillId });
  return updated;
}

export async function deleteSkill(skillId: string): Promise<void> {
  const skill = await getSkill(skillId);
  await prisma.skill.delete({ where: { id: skillId } });
  eventBus.publish({ type: 'skill.changed', projectId: skill.projectId, skillId });
}

// ---------------------------------------------------------------- 读

export async function getSkill(skillId: string): Promise<Skill> {
  const skill = await prisma.skill.findUnique({ where: { id: skillId } });
  if (!skill) throw new NotFoundError(`技能不存在: ${skillId}`);
  return skill;
}

/** 列表：给了项目则返回「本项目 + 通用」（includeGlobal=false 只看本项目），不给项目返回全部 */
export async function listSkills(query: { projectId?: string; includeGlobal?: boolean; q?: string }): Promise<SkillSummary[]> {
  let where: Prisma.SkillWhereInput = {};
  if (query.projectId) {
    where = query.includeGlobal === false ? { projectId: query.projectId } : { OR: [{ projectId: query.projectId }, { projectId: null }] };
  }
  let rows = await prisma.skill.findMany({ where, omit: { content: true }, orderBy: { name: 'asc' }, take: 500 });
  if (query.q?.trim()) {
    const q = query.q.trim();
    rows = rows.filter((s) => matchIndex(q, buildSearchIndex(s.name, s.description)));
  }
  const stats = await prisma.skillFile.groupBy({
    by: ['skillId'],
    where: { skillId: { in: rows.map((s) => s.id) } },
    _count: { _all: true },
    _sum: { size: true },
  });
  const byId = new Map(stats.map((s) => [s.skillId, s]));
  return rows.map((s) => ({ ...s, fileCount: byId.get(s.id)?._count._all ?? 0, totalSize: byId.get(s.id)?._sum.size ?? 0 }));
}

/** 按名字找技能：项目内的优先，其次通用 */
export async function findSkillByName(name: string, projectId: string | null): Promise<Skill> {
  const rows = await prisma.skill.findMany({ where: { name, OR: [{ projectId }, { projectId: null }] } });
  const skill = rows.find((s) => s.projectId === projectId) ?? rows.find((s) => s.projectId === null);
  if (!skill) throw new NotFoundError(`没有名为「${name}」的技能，先用 list_skills 查看可用技能`);
  return skill;
}

export async function getSkillDetail(skillId: string) {
  const skill = await getSkill(skillId);
  const files = await prisma.skillFile.findMany({ where: { skillId }, orderBy: { path: 'asc' } });
  return {
    ...skill,
    files: files.map((f) => ({ path: f.path, size: f.size, isText: isTextContent(f.content) })),
  };
}

export async function listSkillFilesWithContent(skillId: string) {
  return prisma.skillFile.findMany({ where: { skillId }, orderBy: { path: 'asc' } });
}

export async function getSkillFile(skillId: string, path: string): Promise<{ path: string; data: Buffer; isText: boolean }> {
  const skill = await getSkill(skillId);
  if (path === 'SKILL.md') return { path, data: Buffer.from(skill.content), isText: true };
  const row = await prisma.skillFile.findUnique({ where: { skillId_path: { skillId, path: normalizeSkillPath(path) } } });
  if (!row) throw new NotFoundError(`文件不存在: ${path}`);
  const data = Buffer.from(row.content);
  return { path: row.path, data, isText: isTextContent(data) };
}

// ---------------------------------------------------------------- zip

/** 下载：<name>/SKILL.md + 附带文件，解压后放进 .claude/skills/ 即可用 */
export async function buildSkillZip(skillId: string): Promise<{ fileName: string; data: Buffer }> {
  const skill = await getSkill(skillId);
  const files = await listSkillFilesWithContent(skillId);
  const entries: Record<string, Uint8Array> = { [`${skill.name}/SKILL.md`]: strToU8(skill.content) };
  for (const f of files) entries[`${skill.name}/${f.path}`] = new Uint8Array(f.content);
  return { fileName: `${skill.name}.zip`, data: Buffer.from(zipSync(entries)) };
}

function isJunk(path: string): boolean {
  const base = path.split('/').pop() ?? '';
  return path.endsWith('/') || path.startsWith('__MACOSX/') || base === '.DS_Store';
}

/** 上传 zip：找到最浅的 SKILL.md，以它所在目录为技能根目录 */
export function readSkillZip(buf: Buffer): { skillMd: string; files: SkillFileInput[] } {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(buf));
  } catch {
    throw new ValidationError('不是有效的 zip 文件');
  }
  const paths = Object.keys(entries).filter((p) => !isJunk(p));
  const skillMdPath = paths
    .filter((p) => p === 'SKILL.md' || p.endsWith('/SKILL.md'))
    .sort((a, b) => a.split('/').length - b.split('/').length)[0];
  if (!skillMdPath) throw new ValidationError('zip 里没有找到 SKILL.md');
  const root = skillMdPath.slice(0, -'SKILL.md'.length);
  const files = paths
    .filter((p) => p !== skillMdPath && p.startsWith(root))
    .map((p) => ({ path: p.slice(root.length), data: Buffer.from(entries[p]) }));
  return { skillMd: strFromU8(entries[skillMdPath]), files };
}
