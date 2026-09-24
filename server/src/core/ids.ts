import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomId(prefix: string, entropyBytes = 12): string {
  const bytes = randomBytes(entropyBytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}

export const ids = {
  project: () => randomId('prj'),
  bug: () => randomId('bug'),
  task: () => randomId('tsk'),
  note: () => randomId('nte'),
  attachment: () => randomId('att'),
  embedding: () => randomId('emb'),
  skill: () => randomId('skl'),
  skillFile: () => randomId('skf'),
};

export const randomIdProject = ids.project;
export const randomIdBug = ids.bug;
export const randomIdTask = ids.task;
export const randomIdNote = ids.note;
export const randomIdAttachment = ids.attachment;

/** 生成 URL 安全的 slug（对应代码仓库名/目录名） */
export function slugify(input: string): string {
  const base = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const suffix = randomBytes(3).toString('hex');
  return base ? `${base}-${suffix}` : `project-${suffix}`;
}
