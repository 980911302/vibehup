import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnv(): void {
  // 轻量 .env 加载。server/.env 必须第一个候选：Prisma Client 本就按 schema 旁边的
  // server/.env 加载，config 若不读同一文件，EMBEDDING_*/JWT_SECRET 等会在非 Docker
  // 环境静默丢失（R57 实测：库能用但语义检索关闭、SSE LISTEN 降级 dev.db）。
  const candidates = [
    path.resolve(__dirname, '../.env'), // server/.env（与 Prisma 约定一致）
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../../../.env'),
  ];
  for (const file of candidates) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      for (const line of text.split('\n')) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!m) continue;
        const key = m[1];
        if (process.env[key]) continue;
        process.env[key] = m[2].replace(/^["']|["']$/g, '');
      }
    } catch {
      // 文件不存在则跳过
    }
  }
}

loadDotEnv();

export interface EmbeddingSettings {
  /** none=纯关键词；dashscope=OpenAI 兼容模式（/compatible-mode/v1） */
  provider: 'none' | 'dashscope';
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 向量维度：必须与 embeddings.embedding 列宽一致（迁移 1024） */
  dim: number;
  /** 单次向量化文本截断上限（token 近似按字符计，保守截断） */
  tokenLimit: number;
  /** 请求是否显式带 dimensions 参数 */
  sendDim: boolean;
  /** 请求/响应是否走 base64（DashScope encoding_format=base64） */
  useBase64: boolean;
}

function getEmbeddingSettings(): EmbeddingSettings {
  return {
    provider: (process.env.EMBEDDING_PROVIDER ?? 'none') as EmbeddingSettings['provider'],
    baseUrl: process.env.EMBEDDING_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: process.env.EMBEDDING_API_KEY ?? '',
    model: process.env.EMBEDDING_MODEL ?? 'text-embedding-v3',
    dim: Number(process.env.EMBEDDING_DIM ?? 1024),
    tokenLimit: Number(process.env.EMBEDDING_TOKEN_LIMIT ?? 8192),
    sendDim: (process.env.EMBEDDING_SEND_DIM ?? 'false') === 'true',
    useBase64: (process.env.EMBEDDING_USE_BASE64 ?? 'false') === 'true',
  };
}

export const config = {
  port: Number(process.env.PORT ?? 3210),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL ?? 'file:./dev.db',
  /** 数据目录：上传附件与图片派生缓存位于此（Docker 中挂载卷） */
  dataDir: path.resolve(process.cwd(), process.env.DATA_DIR ?? './data'),
  /** 附件允许的最大字节数（默认 50MB） */
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 50 * 1024 * 1024),
  /** 单次上传最多文件数 */
  maxUploadFiles: Number(process.env.MAX_UPLOAD_FILES ?? 10),
  /** 回收区保留天数（超期文件由 storage.purgeOlderThan 清理） */
  attachmentTrashDays: Number(process.env.ATTACHMENT_TRASH_DAYS ?? 30),
  /** 登录态签名密钥：空 = 每次重启随机生成（core/jwt.ts 处理），生产必须显式配置 */
  jwtSecret: process.env.JWT_SECRET ?? '',
  /** 是否开放自助注册 */
  registrationOpen: (process.env.REGISTRATION_OPEN ?? 'true') !== 'false',
  /** access token 有效期（秒） */
  accessTokenTtlSec: 15 * 60,
  /** refresh token 有效期（天） */
  refreshTokenTtlDays: 30,
  /** 语义检索（卡片 28）：DashScope embedding；none 时全功能关闭 */
  embedding: getEmbeddingSettings(),
};

export const paths = {
  /** 附件存储根目录 */
  uploads: path.join(config.dataDir, 'attachments'),
  /** 图片缩放等派生文件目录 */
  derived: path.join(config.dataDir, 'derived'),
  /** 回收区：实体删除后的文件在此保留 attachmentTrashDays 天（设计文档 §1.3.3） */
  trash: path.join(config.dataDir, 'trash'),
};
