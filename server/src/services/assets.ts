import fsp from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { paths } from '../config.js';

/**
 * 多模态资产处理器（设计文档第 2 节 multi-modal asset processor）。
 * 解决传统附件系统两大痛点：防盗链拦截（本地直读）、上下文窗口爆炸（图片降采样 + 文本分片）。
 */

export interface TextSliceResult {
  content: string;
  /** 文件总行数（或 grep 命中行数） */
  totalLines: number;
  /** 本次返回的行数 */
  returnedLines: number;
  /** 是否还有更多内容未返回 */
  hasMore: boolean;
  /** 下一次读取的起始行号 */
  nextOffsetLine: number | null;
  /** 实际使用的 grep 关键词 */
  grepKeyword: string | null;
}

const TEXT_EXTENSIONS = new Set([
  'txt', 'log', 'json', 'xml', 'yaml', 'yml', 'csv', 'tsv', 'md',
  'js', 'ts', 'tsx', 'jsx', 'py', 'java', 'go', 'rs', 'rb', 'php',
  'html', 'css', 'sql', 'sh', 'env', 'conf', 'ini', 'toml',
]);

export function isTextFile(fileName: string, fileType: string): boolean {
  if (fileType.startsWith('text/')) return true;
  const ext = path.extname(fileName).slice(1).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

export function isImageFile(fileType: string, fileName: string): boolean {
  if (fileType.startsWith('image/')) return true;
  const ext = path.extname(fileName).slice(1).toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
}

/**
 * 分片/范围读取文本与日志附件（MCP read_attachment_text）。
 * 支持 grep 关键词过滤，返回 has_more 截断标志防止撑爆上下文。
 */
export async function readTextSlice(
  filePath: string,
  options: { offsetLine?: number; limitLines?: number; grepKeyword?: string } = {},
): Promise<TextSliceResult> {
  const offsetLine = Math.max(1, options.offsetLine ?? 1);
  const limitLines = Math.min(Math.max(1, options.limitLines ?? 200), 2000);
  const grepKeyword = options.grepKeyword?.trim() || null;

  const raw = await fsp.readFile(filePath, 'utf8');
  let lines = raw.split('\n');
  // 去掉末尾空行（文件以换行结尾时产生的伪行）
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const totalLines = lines.length;

  if (grepKeyword) {
    const matched = lines
      .map((text, i) => ({ text, lineNo: i + 1 }))
      .filter((l) => l.text.includes(grepKeyword));
    const start = offsetLine - 1;
    const slice = matched.slice(start, start + limitLines);
    const nextOffset = start + limitLines;
    return {
      content: slice.map((l) => `L${l.lineNo}: ${l.text}`).join('\n'),
      totalLines: matched.length,
      returnedLines: slice.length,
      hasMore: nextOffset < matched.length,
      nextOffsetLine: nextOffset < matched.length ? nextOffset + 1 : null,
      grepKeyword,
    };
  }

  const start = offsetLine - 1;
  const slice = lines.slice(start, start + limitLines);
  const nextOffset = start + limitLines;
  return {
    content: slice.map((text, i) => `L${start + i + 1}: ${text}`).join('\n'),
    totalLines,
    returnedLines: slice.length,
    hasMore: nextOffset < totalLines,
    nextOffsetLine: nextOffset < totalLines ? nextOffset + 1 : null,
    grepKeyword: null,
  };
}

export interface ImageInspection {
  /** 降采样后的本地绝对路径 */
  filePath: string;
  width: number;
  height: number;
  format: string;
  /** 是否发生了缩放（原图未超限时为 false） */
  downscaled: boolean;
  originalWidth: number;
  originalHeight: number;
  mimeType: string;
  /** 文件字节数 */
  byteSize: number;
}

const MIME_BY_FORMAT: Record<string, string> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
};

/**
 * 提取图像资产供多模态模型消费：自动缩放降采样至目标最大边长（默认 1080）。
 * 返回派生文件路径；派生文件缓存在 data/derived/，重复请求不重复处理。
 */
export async function inspectImageAsset(
  filePath: string,
  attachmentId: string,
  options: { targetMaxDimension?: number } = {},
): Promise<ImageInspection> {
  const targetMax = Math.min(Math.max(options.targetMaxDimension ?? 1080, 64), 4096);

  const image = sharp(filePath, { failOn: 'error' });
  const meta = await image.metadata();
  const originalWidth = meta.width ?? 0;
  const originalHeight = meta.height ?? 0;
  const format = meta.format ?? 'png';
  const mimeType = MIME_BY_FORMAT[format] ?? 'image/png';

  const longestEdge = Math.max(originalWidth, originalHeight);
  const needDownscale = longestEdge > targetMax;

  if (!needDownscale) {
    const stat = await fsp.stat(filePath);
    return {
      filePath,
      width: originalWidth,
      height: originalHeight,
      format,
      downscaled: false,
      originalWidth,
      originalHeight,
      mimeType,
      byteSize: stat.size,
    };
  }

  const scale = targetMax / longestEdge;
  const width = Math.max(1, Math.round(originalWidth * scale));
  const height = Math.max(1, Math.round(originalHeight * scale));

  await fsp.mkdir(paths.derived, { recursive: true });
  const derivedPath = path.join(paths.derived, `${attachmentId}@${width}x${height}.${format}`);

  if (!(await fileExists(derivedPath))) {
    const buffer = await sharp(filePath)
      .resize({ width, height, fit: 'inside', withoutEnlargement: true })
      .toFormat(format as 'png' | 'jpeg' | 'jpg' | 'webp' | 'gif' | 'avif' | 'tiff')
      .toBuffer();
    await fsp.writeFile(derivedPath, buffer);
  }

  const stat = await fsp.stat(derivedPath);
  return {
    filePath: derivedPath,
    width,
    height,
    format,
    downscaled: true,
    originalWidth,
    originalHeight,
    mimeType,
    byteSize: stat.size,
  };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}
