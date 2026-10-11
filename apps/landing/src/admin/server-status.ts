// GET /api/admin/server: สถานะเซิร์ฟเวอร์ (page /admin/server/): this server's process, disks and backups (from the Node
// server, server/server-info.ts), the database's size and connections, and when the cron last ran (runtime_heartbeats,
// migrations/pg/0011_runtime_heartbeats.sql). Each part is read on its own; one that fails is reported, not fatal.
import type { Env } from '../types';

const now = () => Math.floor(Date.now() / 1000);
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
/** the cron runs every minute; three missed minutes means it is not running */
export const CRON_LATE_SECONDS = 180;

/** Called by the cron every minute (src/index.ts scheduled). */
export async function beat(env: Env, name: string, detail: Record<string, unknown> = {}): Promise<void> {
  await env.DB.prepare(`INSERT INTO runtime_heartbeats (name, at, detail) VALUES (?, ?, ?)
    ON CONFLICT (name) DO UPDATE SET at = excluded.at, detail = excluded.detail`).bind(name, now(), JSON.stringify(detail)).run();
}

async function part<T>(read: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try { return { ok: true, data: await read() }; } catch { return { ok: false, error: 'อ่านข้อมูลส่วนนี้ไม่ได้' }; }
}

export async function handleServerStatus(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/admin/server') return null;
  if (request.method !== 'GET') return json({ error: 'ไม่รองรับวิธีเรียกใช้งานนี้' }, 405);
  const t = now();
  const [server, database, heartbeats] = await Promise.all([
    env.SERVER_INFO ? part(() => env.SERVER_INFO!()) : Promise.resolve({ ok: false as const, error: 'เซิร์ฟเวอร์นี้ไม่ได้รันด้วย Node (เช่น Cloudflare) จึงไม่มีข้อมูลเครื่อง' }),
    part(async () => {
      const [size, schemas, tables, connections] = await Promise.all([
        env.DB.prepare('SELECT pg_database_size(current_database()) AS bytes').first<{ bytes: number }>(),
        env.DB.prepare(`SELECT n.nspname AS schema, COALESCE(SUM(pg_total_relation_size(c.oid)), 0) AS bytes FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname IN ('account', 'studio', 'reporting', current_schema())
          GROUP BY n.nspname ORDER BY bytes DESC`).all<{ schema: string; bytes: number }>(),
        env.DB.prepare(`SELECT c.relname AS name, pg_total_relation_size(c.oid) AS bytes, c.reltuples::bigint AS rows FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname = current_schema()
          ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 8`).all<{ name: string; bytes: number; rows: number }>(),
        env.DB.prepare(`SELECT COUNT(*) AS n FROM pg_stat_activity WHERE datname = current_database()`).first<{ n: number }>(),
      ]);
      return { bytes: size?.bytes ?? 0, schemas: schemas.results, biggestTables: tables.results.map(r => ({ ...r, rows: Math.max(0, r.rows) })),
        connections: connections?.n ?? 0 };
    }),
    part(async () => (await env.DB.prepare('SELECT name, at, detail FROM runtime_heartbeats ORDER BY name').all<{ name: string; at: number; detail: string }>())
      .results.map(r => ({ name: r.name, at: r.at, detail: JSON.parse(r.detail) }))),
  ]);
  const cron = heartbeats.ok ? heartbeats.data.find(h => h.name === 'cron') ?? null : null;
  return json({
    now: t,
    server, database,
    cron: { lastAt: cron?.at ?? null, running: !!cron && t - cron.at <= CRON_LATE_SECONDS, lateAfterSeconds: CRON_LATE_SECONDS },
    heartbeats,
  });
}
