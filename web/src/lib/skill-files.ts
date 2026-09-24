/**
 * 技能上传的文件整理（纯函数，便于单测）：
 * 选文件夹时浏览器给出 webkitRelativePath（如 my-skill/scripts/a.sh），
 * 以最浅的 SKILL.md 所在目录为技能根目录，其余文件按相对路径作为附带文件。
 */

export interface PickedFile {
  /** 相对路径（选文件夹时为 webkitRelativePath，单选文件时为文件名） */
  path: string;
}

const JUNK = new Set(['.DS_Store', 'Thumbs.db']);

function isJunk(path: string): boolean {
  const parts = path.split('/');
  return parts.some((p) => p === '__MACOSX' || p === '.git') || JUNK.has(parts[parts.length - 1]);
}

/** 返回 SKILL.md 与附带文件（路径已相对技能根目录）；找不到 SKILL.md 返回 null */
export function arrangeSkillFiles<T extends PickedFile>(picked: T[]): { skillMd: T; files: { path: string; file: T }[] } | null {
  const usable = picked.filter((f) => !isJunk(f.path));
  const skillMd = usable
    .filter((f) => f.path === 'SKILL.md' || f.path.endsWith('/SKILL.md'))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length)[0];
  if (!skillMd) return null;
  const root = skillMd.path.slice(0, -'SKILL.md'.length);
  const files = usable
    .filter((f) => f !== skillMd && f.path.startsWith(root))
    .map((f) => ({ path: f.path.slice(root.length), file: f }));
  return { skillMd, files };
}

/** 去掉 SKILL.md 开头的 frontmatter，只渲染正文 */
export function stripFrontmatter(md: string): string {
  const src = md.replace(/^﻿/, '');
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(src);
  return m ? src.slice(m[0].length) : src;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
