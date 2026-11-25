import type { Skill } from '@prisma/client';
import type { McpContext } from './context.js';
import * as projectsService from '../services/projects.js';
import * as skillsService from '../services/skills.js';
import { ValidationError } from '../core/errors.js';

/**
 * 9. get_skill —— 读取技能全文（R96 精简版）。
 * 可用技能目录已内聚进 get_project_context.skills；技能上传与删除统一归 Web 端维护。
 * 下载按预算分批：一次最多约 40K 字符，超出的文件标 pending，再带 path（和 offset）逐个取。
 */

const CHUNK = 40_000;

async function scopeOf(skill: Pick<Skill, 'projectId'>) {
  if (!skill.projectId) return { scope: 'global' as const, project_slug: null };
  const p = await projectsService.getProject(skill.projectId);
  return { scope: 'project' as const, project_slug: p.slug as string | null };
}

/** 按 skill_id 或 name 定位；name 查找时项目内同名优先、其次通用 */
async function locate(input: { skill_id?: string; name?: string; project_slug?: string }): Promise<Skill> {
  if (input.skill_id) return skillsService.getSkill(input.skill_id);
  if (!input.name?.trim()) throw new ValidationError('需要 name 或 skill_id');
  const active = (await projectsService.listProjects()).filter((p) => !p.archivedAt);
  const project = input.project_slug || active.length === 1
    ? await projectsService.resolveProject(input.project_slug)
    : null;
  return skillsService.findSkillByName(input.name.trim(), project?.id ?? null);
}

function presentFile(f: { path: string; data: Buffer; isText: boolean }, offset: number) {
  const full = f.isText ? f.data.toString('utf8') : f.data.toString('base64');
  const piece = full.slice(offset, offset + CHUNK);
  const next = offset + CHUNK < full.length ? offset + CHUNK : null;
  const body = f.isText ? { content: piece } : { content_base64: piece };
  return { path: f.path, size: f.data.byteLength, is_text: f.isText, offset, next_offset: next, ...body };
}

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
    ...(complete ? {} : { tip: '内容较多，标了 pending 的文件请带 path 再调 get_skill 逐个取（大文件按 next_offset 分段）' }),
  };
}

export async function getSkill(
  _ctx: McpContext,
  input: { name?: string; skill_id?: string; project_slug?: string; path?: string; offset?: number },
) {
  const skill = await locate(input);
  if (!input.path) return downloadWhole(skill);
  const f = await skillsService.getSkillFile(skill.id, input.path);
  return { name: skill.name, ...presentFile(f, Math.max(0, input.offset ?? 0)) };
}
