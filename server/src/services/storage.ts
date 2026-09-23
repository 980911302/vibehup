import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { paths } from '../config.js';
import { ids } from '../core/ids.js';

/**
 * 资产存储引擎（设计文档第 2 节 Asset Storage Engine）。
 * 阶段一：宿主机本地文件系统；接口按可扩展设计，阶段二可平滑替换为 S3/MinIO 实现。
 */
export interface StoredFile {
  storagePath: string;
  publicUrl: string;
}

export class LocalFileStorage {
  readonly type = 'local';

  constructor(readonly rootDir: string = paths.uploads) {}

  /** 确保目录存在（按年月分片，避免单目录文件过多） */
  private async ensureDir(dir: string): Promise<void> {
    await fsp.mkdir(dir, { recursive: true });
  }

  /** 计算文件落盘路径：<root>/<yyyy-mm>/<attachmentId>.<ext> */
  resolvePath(attachmentId: string, ext: string, now = new Date()): string {
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const safeExt = ext.replace(/[^a-z0-9.]/gi, '').slice(0, 16) || 'bin';
    return path.join(this.rootDir, month, `${attachmentId}.${safeExt}`);
  }

  /** 生成公网访问地址（Fastify 静态代理路由） */
  publicUrl(attachmentId: string): string {
    return `/api/attachments/${attachmentId}/raw`;
  }

  /** 流式写入（供 multipart 上传使用，避免整文件驻留内存） */
  async writeStream(sourcePath: string, attachmentId: string, ext: string): Promise<StoredFile> {
    const target = this.resolvePath(attachmentId, ext);
    await this.ensureDir(path.dirname(target));
    await fsp.copyFile(sourcePath, target);
    return { storagePath: target, publicUrl: this.publicUrl(attachmentId) };
  }

  /** 直接写入 Buffer（供测试与 MCP 内部派生使用） */
  async writeBuffer(buffer: Buffer, attachmentId: string, ext: string): Promise<StoredFile> {
    const target = this.resolvePath(attachmentId, ext);
    await this.ensureDir(path.dirname(target));
    await fsp.writeFile(target, buffer);
    return { storagePath: target, publicUrl: this.publicUrl(attachmentId) };
  }

  /** 删除物理文件（不存在时静默成功） */
  async delete(storagePath: string): Promise<void> {
    try {
      await fsp.unlink(storagePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  exists(storagePath: string): boolean {
    return fs.existsSync(storagePath);
  }

  /**
   * 把在役文件移入回收区（保留相对路径，可恢复）。
   * 目标：<trash>/<原相对于 rootDir 的路径>，如 trash/attachments/2026-09/att_x.png
   */
  async moveToTrash(storagePath: string): Promise<string> {
    const relative = path.relative(this.rootDir, storagePath);
    const target = path.join(paths.trash, relative);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.rename(storagePath, target);
    return target;
  }

  /**
   * 清理回收区中修改时间超过 days 天的文件，返回清理数量。
   * 同时清理清空后的子目录；trash 不存在时返回 0。
   */
  async purgeOlderThan(days: number): Promise<number> {
    let purged = 0;
    const walk = async (dir: string): Promise<string[]> => {
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return []; // 目录不存在或不可读
      }
      const emptyDirs: string[] = [];
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const sub = await walk(full);
          if (sub.length === 0) emptyDirs.push(full);
          continue;
        }
        const stat = await fsp.stat(full);
        // 钳制负年龄：文件系统时钟可能略快于系统时钟，负 ageDays 会导致同轮文件漏清
        const ageDays = Math.max(0, (Date.now() - stat.mtimeMs) / 86_400_000);
        if (ageDays >= days) {
          await fsp.unlink(full);
          purged++;
        }
      }
      // 返回本层剩余条目，供上层判断是否空目录
      const remaining = entries.filter((e) => {
        const full = path.join(dir, e.name);
        return e.isDirectory() ? !emptyDirs.includes(full) : true;
      });
      return remaining.length === 0 ? [] : remaining.map((e) => e.name);
    };
    await walk(paths.trash);
    return purged;
  }
}

export const storage = new LocalFileStorage();

export function newAttachmentId(): string {
  return ids.attachment();
}
