import type { FastifyPluginAsync } from 'fastify';
import * as attachmentsService from '../services/attachments.js';
import { verifyUploadGrant, consumeUploadGrant, type UploadGrant } from '../core/upload-grant.js';
import { UnauthorizedError, ValidationError } from '../core/errors.js';
import { refreshKeyedContext, ctxHas, McpContextError } from '../mcp/context.js';
import { config } from '../config.js';

/**
 * PUT /api/uploads?token=… —— 签名直传（R84）。
 * 令牌走查询参数：Fastify 路径参数默认上限 100 字符，令牌更长会 414；与 SSE 的 ?token= 同一约定，日志脱敏规则通用。
 * AI 经 MCP create_upload_url 拿到链接后执行 `curl -T <本地文件> <链接>`，文件内容不经过对话。
 * 不挂登录守卫：令牌即授权（验签 + 10 分钟有效 + 只能用一次）；签发它的密钥被撤销/过期/降权则同时失效。
 * 请求体一律按原始字节接收（任何 Content-Type，含 curl -T 不带类型的情形）。
 */
export const signedUploadRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: config.maxUploadBytes }, (_req, body, done) => {
    done(null, body);
  });

  fastify.put('/', async (request, reply) => {
    const { token } = request.query as { token?: string };
    const grant = token ? verifyUploadGrant(token) : null;
    if (!grant) throw new UnauthorizedError('上传链接无效或已过期，请重新调用 create_upload_url 申请');
    await assertIssuerStillAllowed(grant);

    const buffer = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    if (buffer.byteLength === 0) {
      throw new ValidationError('请求体为空：请用 curl -T <本地文件路径> <上传链接> 上传文件内容');
    }
    if (!consumeUploadGrant(grant)) {
      throw new UnauthorizedError('这个上传链接已经用过了（只能用一次），请重新调用 create_upload_url 申请');
    }

    const attachment = await attachmentsService.uploadFromBuffer({
      projectId: grant.projectId,
      entityType: grant.entityType,
      entityId: grant.entityId,
      fileName: grant.fileName,
      fileType: grant.fileType,
      buffer,
      uploadedBy: grant.uploadedBy,
    });
    reply.code(201);
    return {
      ok: true,
      attachment: {
        id: attachment.id,
        file_name: attachment.fileName,
        file_type: attachment.fileType,
        file_size: attachment.fileSize,
        bug_id: grant.entityType === 'bug' ? grant.entityId : null,
      },
    };
  });
};

/** 签发链接的密钥此刻仍须有效且有 attachment:write（撤销即时生效，与 MCP guard 同一复核逻辑） */
async function assertIssuerStillAllowed(grant: UploadGrant): Promise<void> {
  if (!grant.apiKeyId) return; // stdio 本地全权签发
  try {
    const ctx = await refreshKeyedContext({ mode: 'keyed', apiKeyId: grant.apiKeyId, scopes: new Set(), actorLabel: '' });
    if (!ctxHas(ctx, 'attachment:write')) {
      throw new UnauthorizedError('签发这个上传链接的密钥已没有 attachment:write 权限');
    }
  } catch (err) {
    if (err instanceof McpContextError) throw new UnauthorizedError(`上传链接已失效：${err.message}`);
    throw err;
  }
}
