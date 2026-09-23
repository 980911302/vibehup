import { prisma } from '../core/prisma.js';

/** 系统设置服务：键值对读写（注册开关等） */

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await prisma.systemSetting.findMany();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** 注册开关：设置表优先，环境变量兜底 */
export async function isRegistrationOpen(): Promise<boolean> {
  const v = await getSetting('registration_open');
  if (v !== null) return v === 'true';
  return (process.env.REGISTRATION_OPEN ?? 'true') !== 'false';
}
