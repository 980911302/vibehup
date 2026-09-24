import type { Skill } from '@prisma/client';
import type { McpContext } from './context.js';
import { prisma } from '../core/prisma.js';
import * as projectsService from '../services/projects.js';
import * as skillsService from '../services/skills.js';
import { ValidationError } from '../core/errors.js';

/**
 * 技能工具（R80）：list_skills 查看（名称+描述）/ download_skill 下载 / upload_skill 上传 / delete_skill 删除。
 * 下载按预算分批：一次最多约 40K 字符，超出的文件标 pending，再带 path（和 offset）逐个取。
 */

const CHUNK = 40_000;

interface FileIn {
  path: string;
  content?: string;
  content_base64?: string;
}

async function scopeOf(skill: Pick<Skill, 'projectId'>) {
  if (!skill.projectId) return { scope: 'global' as const, project_slug: null };
  const p = await prisma.project.findUnique({ where: { id: skill.projectId }, select: { slug: true } });
  return { scope: 'project' as const, project_slug: p?.slug ?? null };
}

/** 按 skill_id 或 name 定位；name 查找时项目内同名优先、其次通用 */
async function locate(input: { skill_id?: string; name?: string; project_slug?: string }): Promise<Skill> {
  if (input.skill_id) return skillsService.getSkill(input.skill_id);
  if (!input.name?.trim()) throw new ValidationError('需要 name 或 skill_id');
  const project = await projectsService.resolveProject(input.project_slug);
  return skillsService.findSkillByName(input.name.trim(), project.id);
}

export async function listSkills(_ctx: McpContext, input: { project_slug?: string; q?: string }) {
  const project = await projectsService.resolveProject(input.project_slug);
  const items = await skillsService.listSkills({ projectId: project.id, q: input.q });
  return {
    project: { slug: project.slug, name: project.name },
    total: items.length,
    skills: items.map((s) => ({
      name: s.name,
      description: s.description,
      scope: s.projectId ? 'project' : 'global',
      file_count: s.fileCount,
      updated_at: s.updatedAt.toISOString(),
    })),
    tip: '要用某个技能时 download_skill 取回全文，按原目录结构写到 .claude/skills/<name>/',
  };
}

function presentFile(f: { path: string; data: Buffer; isText: boolean }, offset: number) {
  const full = f.isText ? f.data.toString('utf8') : f.data.toString('base64');
  const piece = full.slice(offset, offset + CHUNK);
  const next = offset + CHUNK < full.length ? offset + CHUNK : null;
  const body = f.isText ? { content: piece } : { content_base64: piece };
  return { path: f.path, size: f.data.byteLength, is_text: f.isText, offset, next_offset: next, ...body };
}

/** 整个技能：SKILL.md + 尽量多的文件；超预算的文件标 pending */
async function downloadWhole(skill: Skill) {
  const rows = await skillsService.listSkillFilesWithContent(skill.id);
  let budget = CHUNK - skill.content.length;
  const files = rows.map((r) => {
    const data = Buffer.from(r.content);
    const isText = skillsService.isTextContent(data);
    const text = isText ? data.toString('utf8') : data.toString('base64');
    const meta = { path: r.path, size: r.size, is_text: isText };
    if (text.length > budget) return { ...meta, pending: true };
    budget -= text.length;
    return isText ? { ...meta, content: text } : { ...meta, content_base64: text };
  });
  const complete = files.every((f) => !('pending' in f));
  return {
    name: skill.name,
    description: skill.description,
    ...(await scopeOf(skill)),
    install_dir: `.claude/skills/${skill.name}`,
    skill_md: skill.content,
    files,
    complete,
    ...(complete ? {} : { tip: '内容较多，标了 pending 的文件请带 path 再调 download_skill 逐个取（大文件按 next_offset 分段）' }),
  };
}

export async function downloadSkill(
  _ctx: McpContext,
  input: { name?: string; skill_id?: string; project_slug?: string; path?: string; offset?: number },
) {
  const skill = await locate(input);
  if (!input.path) return downloadWhole(skill);
  const f = await skillsService.getSkillFile(skill.id, input.path);
  return { name: skill.name, ...presentFile(f, Math.max(0, input.offset ?? 0)) };
}

export async function uploadSkill(
  ctx: McpContext,
  input: { skill_md: string; files?: FileIn[]; project_slug?: string; scope?: 'project' | 'global' },
) {
  const projectId = input.scope === 'global' ? null : (await projectsService.resolveProject(input.project_slug)).id;
  const files = (input.files ?? []).map((f) => ({
    path: f.path,
    data: f.content_base64 !== undefined ? Buffer.from(f.content_base64, 'base64') : Buffer.from(f.content ?? '', 'utf8'),
  }));
  const { action, skill } = await skillsService.uploadSkill({
    projectId,
    skillMd: input.skill_md,
    files,
    source: 'ai',
    uploadedBy: ctx.apiKeyId,
  });
  return {
    ok: true,
    action,
    skill: { id: skill.id, name: skill.name, description: skill.description, ...(await scopeOf(skill)), file_count: files.length },
  };
}

export async function deleteSkill(_ctx: McpContext, input: { name?: string; skill_id?: string; project_slug?: string }) {
  const skill = await locate(input);
  const where = await scopeOf(skill);
  await skillsService.deleteSkill(skill.id);
  return { ok: true, deleted: { id: skill.id, name: skill.name, ...where } };
}
