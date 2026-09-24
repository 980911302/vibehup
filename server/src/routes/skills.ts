import type { FastifyPluginAsync } from 'fastify';
import * as skillsService from '../services/skills.js';
import { ValidationError } from '../core/errors.js';
import { WRITER_ROLES } from '../plugins/authenticate.js';
import { serializeSkill } from '../core/serialize.js';

interface UploadBody {
  /** 缺省或 null = 全团队通用 */
  project_id?: string | null;
  skill_md?: string;
  files?: { path?: string; content?: string; content_base64?: string }[];
  /** 整个技能目录打成的 zip（与 skill_md 二选一） */
  zip_base64?: string;
}

/** JSON 上传体 → service 入参：skill_md + files，或 zip_base64 */
function readUpload(body: UploadBody): { skillMd: string; files: skillsService.SkillFileInput[] } {
  if (body.zip_base64) return skillsService.readSkillZip(Buffer.from(body.zip_base64, 'base64'));
  if (!body.skill_md?.trim()) throw new ValidationError('需要 skill_md（SKILL.md 全文）或 zip_base64（技能目录 zip）');
  const files = (body.files ?? []).map((f) => {
    if (!f?.path) throw new ValidationError('每个附带文件都需要 path');
    const data = f.content_base64 !== undefined ? Buffer.from(f.content_base64, 'base64') : Buffer.from(f.content ?? '', 'utf8');
    return { path: f.path, data };
  });
  return { skillMd: body.skill_md, files };
}

async function presentDetail(skillId: string) {
  const { files, ...skill } = await skillsService.getSkillDetail(skillId);
  return serializeSkill(skill, files);
}

export const skillRoutes: FastifyPluginAsync = async (fastify) => {
  // 写操作限 owner/admin/member（登录校验已由外层 onRequest 钩子完成）
  const canWrite = { preHandler: [fastify.requireRole(...WRITER_ROLES)] };

  // GET /api/skills?project_id=&include_global=false&q=
  fastify.get('/', async (request) => {
    const q = request.query as Record<string, string>;
    const items = await skillsService.listSkills({
      projectId: q.project_id || undefined,
      includeGlobal: q.include_global !== 'false',
      q: q.q,
    });
    return items.map((s) => serializeSkill(s));
  });

  // GET /api/skills/:skillId —— 详情：SKILL.md 全文 + 附带文件清单
  fastify.get('/:skillId', async (request) => {
    const { skillId } = request.params as { skillId: string };
    return presentDetail(skillId);
  });

  // GET /api/skills/:skillId/file?path= —— 单个文件（文本直出，二进制给 base64）
  fastify.get('/:skillId/file', async (request) => {
    const { skillId } = request.params as { skillId: string };
    const { path } = request.query as { path?: string };
    if (!path) throw new ValidationError('path 不能为空');
    const f = await skillsService.getSkillFile(skillId, path);
    return f.isText
      ? { path: f.path, size: f.data.byteLength, is_text: true, content: f.data.toString('utf8') }
      : { path: f.path, size: f.data.byteLength, is_text: false, content_base64: f.data.toString('base64') };
  });

  // GET /api/skills/:skillId/download —— zip：<name>/SKILL.md + 附带文件
  fastify.get('/:skillId/download', async (request, reply) => {
    const { skillId } = request.params as { skillId: string };
    const { fileName, data } = await skillsService.buildSkillZip(skillId);
    reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${fileName}"`)
      .header('X-Content-Type-Options', 'nosniff');
    return reply.send(data);
  });

  // POST /api/skills —— 上传：同一范围同名即覆盖（200），否则新建（201）
  fastify.post('/', canWrite, async (request, reply) => {
    const body = (request.body ?? {}) as UploadBody;
    const { skillMd, files } = readUpload(body);
    const { action, skill } = await skillsService.uploadSkill({
      projectId: body.project_id ?? null,
      skillMd,
      files,
      source: 'human',
      uploadedBy: request.user?.id ?? null,
    });
    reply.code(action === 'created' ? 201 : 200);
    return { action, skill: await presentDetail(skill.id) };
  });

  // PATCH /api/skills/:skillId —— 调整归属（project_id: null = 改为通用）
  fastify.patch('/:skillId', canWrite, async (request) => {
    const { skillId } = request.params as { skillId: string };
    const body = (request.body ?? {}) as { project_id?: string | null };
    if (!('project_id' in body)) throw new ValidationError('目前只支持修改 project_id（null 表示全团队通用）');
    await skillsService.setSkillProject(skillId, body.project_id ?? null);
    return presentDetail(skillId);
  });

  // DELETE /api/skills/:skillId
  fastify.delete('/:skillId', canWrite, async (request, reply) => {
    const { skillId } = request.params as { skillId: string };
    await skillsService.deleteSkill(skillId);
    reply.code(204);
    return null;
  });
};
