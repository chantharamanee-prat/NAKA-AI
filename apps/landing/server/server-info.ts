/**
 * What the back office's สถานะเซิร์ฟเวอร์ page knows about this machine (src/admin/server-status.ts), given to the
 * Worker code as env.SERVER_INFO: only the Node server has a process, disks and the backup folder to look at.
 *
 *   process   uptime, memory, Node version, role (NAKA_ROLE), app version (NAKA_VERSION)
 *   disks     free and total space where media and backups live
 *   backups   infra/backup/backup.sh writes BACKUP_DIR/last.json and naka-*.dump files
 */
import { readdir, readFile, stat, statfs } from 'node:fs/promises';
import path from 'node:path';

export interface ServerInfo {
  process: { uptimeSeconds: number; rssBytes: number; heapUsedBytes: number; node: string; role: string; version: string | null; pid: number };
  disks: { name: string; path: string; freeBytes: number; totalBytes: number }[];
  backups: { configured: boolean; last: Record<string, unknown> | null; files: { name: string; bytes: number; at: number }[]; error: string | null };
}

async function disk(name: string, dir: string | undefined) {
  if (!dir) return null;
  try {
    const s = await statfs(dir);
    return { name, path: dir, freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
  } catch { return null; }
}

async function backups(dir: string | undefined): Promise<ServerInfo['backups']> {
  if (!dir) return { configured: false, last: null, files: [], error: null };
  try {
    const names = (await readdir(dir)).filter(n => /^naka-\d{8}-\d{4}\.dump$/.test(n)).sort().reverse().slice(0, 14);
    const files = await Promise.all(names.map(async name => {
      const s = await stat(path.join(dir, name));
      return { name, bytes: s.size, at: Math.floor(s.mtimeMs / 1000) };
    }));
    let last: Record<string, unknown> | null = null;
    try { last = JSON.parse(await readFile(path.join(dir, 'last.json'), 'utf8')); } catch { /* not run yet */ }
    return { configured: true, last, files, error: null };
  } catch {
    return { configured: true, last: null, files: [], error: 'อ่านโฟลเดอร์สำรองข้อมูลไม่ได้' };
  }
}

export function serverInfo(role: string) {
  return async (): Promise<ServerInfo> => {
    const memory = process.memoryUsage();
    const disks = (await Promise.all([disk('ไฟล์ของลูกค้า (MEDIA_DIR)', process.env.MEDIA_DIR), disk('สำรองข้อมูล (BACKUP_DIR)', process.env.BACKUP_DIR),
      disk('แอป', process.cwd())])).filter((d): d is NonNullable<typeof d> => !!d);
    return {
      process: { uptimeSeconds: Math.round(process.uptime()), rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, node: process.version, role,
        version: process.env.NAKA_VERSION ?? null, pid: process.pid },
      disks,
      backups: await backups(process.env.BACKUP_DIR),
    };
  };
}
