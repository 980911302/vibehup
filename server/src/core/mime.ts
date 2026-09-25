/**
 * 按扩展名推断 MIME（R84）：MCP 上传时 AI 常常不给 file_type，由文件名推断。
 * 推断不出来的由调用方给兜底值（文本上传兜底 text/plain，二进制兜底 application/octet-stream）。
 */

const MIME_BY_EXT: Record<string, string> = {
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  har: 'application/json',
  xml: 'application/xml',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  html: 'text/html',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  zip: 'application/zip',
  gz: 'application/gzip',
};

export function guessMimeType(fileName: string, fallback = 'application/octet-stream'): string {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return fallback;
  return MIME_BY_EXT[fileName.slice(dot + 1).toLowerCase()] ?? fallback;
}
