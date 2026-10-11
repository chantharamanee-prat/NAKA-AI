// Customer care tools for /admin/customers/ (migrations/pg/0010_customer_tools.sql, docs/admin-backoffice.md):
//   notes and tags      POST/DELETE /api/admin/customers/:id/notes[/:noteId], /tags[/:tag]
//   the list as CSV     GET  /api/admin/customers.csv?q=&tag=
//   bulk credits        POST /api/admin/customers/bulk-credits { userIds | tag, amount, note }
//   PDPA                POST /api/admin/customers/:id/export { note }   → the customer's data as a JSON file
//                       GET  /api/admin/customers/:id/erase-preview     → what erasing would remove and keep
//                       POST /api/admin/customers/:id/erase { confirm: <id>, note }
// Erasing removes the customer's personal data here and in naka-studio. Payments, receipts, the credit ledger and the
// admin history stay (accounting and tax records must be kept); the account keeps its id, loses its name and is closed.
import type { Env } from '../types';
import type { AdminActor } from './auth';
import { csvCell } from './insights';
import { studio, StudioSystemError } from './studio-system';

const BASE = '/api/admin/customers';
const MAX_BULK = 1000;
const CSV_MAX = 20_000;
const now = () => Math.floor(Date.now() / 1000);
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
class ToolError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const studioConfigured = (env: Env) => !!env.STUDIO_INTERNAL_URL?.trim() && !!env.STUDIO_ADMIN_TOKEN?.trim();

async function body(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ToolError(400, 'กรุณาส่งข้อมูลเป็น JSON');
  const raw = await request.text();
  if (raw.length > 64 * 1024) throw new ToolError(413, 'ข้อมูลยาวเกินไป');
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* below */ }
  throw new ToolError(400, 'ข้อมูลไม่ถูกต้อง');
}
function reason(input: Record<string, unknown>): string {
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (!note || note.length > 200) throw new ToolError(400, 'กรุณาระบุเหตุผล 1 ถึง 200 ตัวอักษร');
  return note;
}
async function customerExists(env: Env, userId: string) {
  const row = await env.DB.prepare('SELECT id, display_name AS name FROM users WHERE id = ?').bind(userId).first<{ id: string; name: string }>();
  if (!row) throw new ToolError(404, 'ไม่พบลูกค้านี้');
  return row;
}
const erased = async (env: Env, userId: string) =>
  !!await env.DB.prepare("SELECT 1 AS x FROM admin_audit WHERE user_id = ? AND action = 'erase'").bind(userId).first();

// ---------- notes and tags ----------

/** Notes and tags for the customer's page (src/admin/customers.ts detail). */
export async function customerExtras(env: Env, userId: string) {
  const [notes, tags] = await Promise.all([
    env.DB.prepare('SELECT id, body, author, created_at AS "createdAt" FROM customer_notes WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100').bind(userId).all(),
    env.DB.prepare('SELECT tag FROM customer_tags WHERE user_id = ? ORDER BY tag').bind(userId).all<{ tag: string }>(),
  ]);
  return { notes: notes.results, tags: tags.results.map(t => t.tag), erased: await erased(env, userId) };
}
const cleanTag = (value: unknown) => {
  const tag = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!tag || tag.length > 30 || /[,\r\n]/.test(tag)) throw new ToolError(400, 'ป้ายยาว 1 ถึง 30 ตัวอักษร ไม่มีจุลภาค');
  return tag;
};

// ---------- CSV of the customer list ----------

async function customersCsv(env: Env, url: URL): Promise<Response> {
  const q = (url.searchParams.get('q') ?? '').trim();
  const tag = (url.searchParams.get('tag') ?? '').trim();
  if (q.length > 200 || tag.length > 30) throw new ToolError(400, 'คำค้นยาวเกินไป');
  const phone = q.replace(/[\s()-]/g, '');
  const normalized = /^0\d{9}$/.test(phone) ? '+66' + phone.slice(1) : phone;
  const { results } = await env.DB.prepare(`SELECT u.id, u.display_name AS name, u.status, u.created_at AS "createdAt",
      (SELECT provider_uid FROM auth_identities WHERE user_id = u.id AND provider = 'phone' ORDER BY id LIMIT 1) AS phone,
      (SELECT email FROM auth_identities WHERE user_id = u.id AND email IS NOT NULL ORDER BY provider, id LIMIT 1) AS email,
      CASE WHEN s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > ?1) THEN p.name ELSE 'ฟรี' END AS plan,
      CASE WHEN s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > ?1) THEN s.expires_at END AS "expiresAt",
      (SELECT COALESCE(SUM(delta), 0) FROM credit_ledger WHERE user_id = u.id) AS credits,
      (SELECT string_agg(tag, ', ' ORDER BY tag) FROM customer_tags WHERE user_id = u.id) AS tags
    FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id LEFT JOIN plans p ON p.id = s.plan_id
    WHERE (?2 = '' OR instr(lower(u.id), lower(?2)) > 0 OR instr(lower(u.display_name), lower(?2)) > 0
      OR EXISTS (SELECT 1 FROM auth_identities a WHERE a.user_id = u.id AND
        ((a.provider = 'phone' AND instr(a.provider_uid, ?3) > 0) OR instr(lower(a.email), lower(?2)) > 0)))
      AND (?4 = '' OR EXISTS (SELECT 1 FROM customer_tags t WHERE t.user_id = u.id AND lower(t.tag) = lower(?4)))
    ORDER BY u.created_at DESC, u.id LIMIT ?5`).bind(now(), q, normalized || q, tag, CSV_MAX + 1)
    .all<{ id: string; name: string; status: string; createdAt: number; phone: string | null; email: string | null; plan: string; expiresAt: number | null; credits: number; tags: string | null }>();
  if (results.length > CSV_MAX) throw new ToolError(413, `มีลูกค้ามากกว่า ${CSV_MAX.toLocaleString('en-US')} คน กรุณากรองให้แคบลง`);
  const day = (t: number | null) => t ? new Date((t + 7 * 3600) * 1000).toISOString().slice(0, 10) : '';
  const lines = [['รหัสลูกค้า', 'ชื่อ', 'อีเมล', 'เบอร์โทร', 'สถานะ', 'แพ็กเกจ', 'ใช้ได้ถึง', 'เครดิต', 'ป้าย', 'สมัครเมื่อ'].map(csvCell).join(',')];
  for (const c of results) {
    lines.push([c.id, c.name, c.email ?? '', c.phone ?? '', c.status === 'disabled' ? 'ระงับ' : 'ใช้งาน', c.plan, day(c.expiresAt), c.credits, c.tags ?? '', day(c.createdAt)]
      .map(csvCell).join(','));
  }
  return new Response('﻿' + lines.join('\r\n') + '\r\n', { headers: { 'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="naka-ai-customers-${day(now())}.csv"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

// ---------- credits for many customers ----------

async function bulkCredits(request: Request, env: Env, who: string): Promise<Response> {
  const input = await body(request);
  const note = reason(input);
  const amount = input.amount;
  if (!Number.isInteger(amount) || (amount as number) < 1 || (amount as number) > 10000) throw new ToolError(400, 'จำนวนเครดิตต้องเป็นจำนวนเต็ม 1 ถึง 10000');
  let ids: string[];
  if (Array.isArray(input.userIds)) {
    ids = [...new Set(input.userIds.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200))];
    if (!ids.length || ids.length !== input.userIds.length) throw new ToolError(400, 'รายชื่อลูกค้าไม่ถูกต้อง');
  } else if (typeof input.tag === 'string') {
    const tag = cleanTag(input.tag);
    ids = (await env.DB.prepare('SELECT user_id FROM customer_tags WHERE lower(tag) = lower(?) ORDER BY user_id').bind(tag).all<{ user_id: string }>()).results.map(r => r.user_id);
    if (!ids.length) throw new ToolError(400, `ไม่มีลูกค้าที่มีป้าย "${tag}"`);
  } else throw new ToolError(400, 'เลือกลูกค้า หรือระบุป้าย');
  if (ids.length > MAX_BULK) throw new ToolError(400, `เติมได้ครั้งละไม่เกิน ${MAX_BULK} คน`);
  const known = await env.DB.prepare(`SELECT COUNT(*) AS n FROM users WHERE id IN (${ids.map(() => '?').join(', ')}) AND status = 'active'`).bind(...ids).first<{ n: number }>();
  if (known?.n !== ids.length) throw new ToolError(400, 'มีลูกค้าที่ไม่พบหรือถูกระงับอยู่ในรายชื่อ');
  const batch = crypto.randomUUID(), t = now();
  // one audit row and one ledger grant per customer, all in one transaction (the same record as a single grant)
  const statements = ids.flatMap(userId => {
    const auditId = crypto.randomUUID();
    return [
      env.DB.prepare(`INSERT INTO admin_audit (id, user_id, action, detail, note, actor, created_at)
        SELECT ?1, u.id, 'credits', jsonb_build_object('input', jsonb_build_object('amount', ?3::bigint, 'note', ?4::text, 'bulk', ?6::text),
          'before', jsonb_build_object('credits', b.c), 'after', jsonb_build_object('credits', b.c + ?3::bigint))::text, ?4, ?5, ?7
        FROM users u, (SELECT COALESCE(SUM(delta), 0) AS c FROM credit_ledger WHERE user_id = ?2) b WHERE u.id = ?2`)
        .bind(auditId, userId, amount, note, who, batch, t),
      env.DB.prepare(`INSERT INTO credit_ledger (user_id, delta, reason, note) SELECT user_id, ?2, 'grant', note FROM admin_audit WHERE id = ?1`).bind(auditId, amount),
    ];
  });
  await env.DB.batch(statements);
  return json({ ok: true, customers: ids.length, amount, batch });
}

// ---------- PDPA: export ----------

const EXPORT_LIMIT = 10_000;
async function exportCustomer(request: Request, env: Env, userId: string, who: string): Promise<Response> {
  const note = reason(await body(request));
  const customer = await customerExists(env, userId);
  const all = (sql: string) => env.DB.prepare(sql + ` LIMIT ${EXPORT_LIMIT}`).bind(userId).all().then(r => r.results);
  const [identities, subscription, payments, receipts, ledger, jobs, videos, media, socialAccounts, posts, inboxSettings, kb, threads, messages,
    features, usage, notes, tags, history] = await Promise.all([
    all(`SELECT provider, CASE WHEN provider = 'phone' THEN provider_uid END AS phone, email, verified_at AS "verifiedAt" FROM auth_identities WHERE user_id = ? ORDER BY id`),
    all(`SELECT plan_id AS "planId", status, billing_period AS period, expires_at AS "expiresAt", next_credit_at AS "nextCreditAt" FROM subscriptions WHERE user_id = ?`),
    all(`SELECT id, plan_id AS "planId", period, amount_satang / 100.0 AS amount, method, status, created_at AS "createdAt", paid_at AS "paidAt" FROM payments WHERE user_id = ? ORDER BY created_at`),
    all(`SELECT number, issued_at AS "issuedAt", snapshot FROM receipts WHERE user_id = ? ORDER BY issued_at`),
    all(`SELECT delta, reason, job_id AS "jobId", note, created_at AS "createdAt" FROM credit_ledger WHERE user_id = ? ORDER BY id`),
    all(`SELECT id, kind, status, input, output, error, cost_credits AS cost, created_at AS "createdAt" FROM jobs WHERE user_id = ? ORDER BY created_at`),
    all(`SELECT id, kind, prompt, input, status, output_key AS "outputKey", created_at AS "createdAt" FROM ai_videos WHERE user_id = ? ORDER BY created_at`),
    all(`SELECT key, kind, content_type AS "contentType", size, created_at AS "createdAt" FROM marketer_media WHERE user_id = ? ORDER BY created_at`),
    // token_enc never leaves the database
    all(`SELECT platform, name, status, created_at AS "createdAt" FROM social_accounts WHERE user_id = ? ORDER BY created_at`),
    all(`SELECT caption, publish_at AS "publishAt", status, external_post_id AS "externalPostId", created_at AS "createdAt" FROM scheduled_posts WHERE user_id = ? ORDER BY created_at`),
    all(`SELECT mode, tone, escalate_keywords AS "escalateKeywords" FROM inbox_settings WHERE user_id = ?`),
    all(`SELECT * FROM inbox_kb WHERE user_id = ?`),
    all(`SELECT id, kind, customer_name AS "customerName", status, last_message_at AS "lastMessageAt" FROM inbox_threads WHERE user_id = ? ORDER BY last_message_at`),
    all(`SELECT thread_id AS "threadId", direction, body, status, message_at AS "messageAt" FROM inbox_messages WHERE user_id = ? ORDER BY message_at`),
    all(`SELECT feature_key AS feature, enabled, monthly_limit AS "monthlyLimit", expires_at AS "expiresAt" FROM user_features WHERE user_id = ?`),
    all(`SELECT feature_key AS feature, period, used FROM feature_usage WHERE user_id = ? ORDER BY period`),
    all(`SELECT body, author, created_at AS "createdAt" FROM customer_notes WHERE user_id = ? ORDER BY created_at`),
    all(`SELECT tag FROM customer_tags WHERE user_id = ? ORDER BY tag`),
    all(`SELECT action, note, actor, created_at AS "createdAt" FROM admin_audit WHERE user_id = ? ORDER BY created_at`),
  ]);
  let studioData: unknown = 'naka-studio ไม่ได้เชื่อมต่อ';
  if (studioConfigured(env)) {
    try {
      const [counts, works] = await Promise.all([
        studio(env, `/system/member-data?owner=${encodeURIComponent(userId)}`, 'GET', 15_000),
        studio(env, `/system/member-works?owner=${encodeURIComponent(userId)}&limit=20`, 'GET', 15_000),
      ]);
      studioData = { counts, latestWorks: works };
    } catch (error) { studioData = 'อ่านข้อมูลจาก naka-studio ไม่ได้: ' + (error instanceof StudioSystemError ? error.message : 'ไม่ทราบสาเหตุ'); }
  }
  const parse = (v: unknown) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return v; } };
  const file = {
    exportedAt: new Date().toISOString(), exportedBy: who, reason: note,
    customer: { id: customer.id, name: customer.name },
    identities, subscription: subscription[0] ?? null, payments, receipts: receipts.map(r => ({ ...r, snapshot: parse((r as { snapshot: string }).snapshot) })),
    credits: ledger, jobs: jobs.map(j => ({ ...j, input: parse((j as { input: string }).input), output: parse((j as { output: string }).output) })),
    aiVideos: videos.map(v => ({ ...v, input: parse((v as { input: string }).input) })), uploadedMedia: media,
    socialAccounts, scheduledPosts: posts, inbox: { settings: inboxSettings[0] ?? null, knowledge: kb, threads, messages },
    features, featureUsage: usage, adminNotes: notes, tags: tags.map(t => (t as { tag: string }).tag), adminHistory: history,
    nakaStudio: studioData,
  };
  await env.DB.prepare(`INSERT INTO admin_audit (id, user_id, action, detail, note, actor, created_at) VALUES (?, ?, 'export', ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), userId, JSON.stringify({ input: { note } }), note, who, now()).run();
  return new Response(JSON.stringify(file, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="naka-ai-customer-${userId.replace(/[^\w-]/g, '_').slice(0, 60)}.json"`, 'Cache-Control': 'no-store' } });
}

// ---------- PDPA: erase ----------

/** rows that go, per table (the order is the order of deletion: children before what they reference) */
const ERASE: [string, string][] = [
  ['scheduled_posts', 'user_id = ?1'], ['inbox_messages', 'user_id = ?1'], ['inbox_threads', 'user_id = ?1'], ['inbox_kb', 'user_id = ?1'],
  ['inbox_settings', 'user_id = ?1'], ['social_media', 'user_id = ?1'], ['social_accounts', 'user_id = ?1'], ['social_oauth_states', 'user_id = ?1'],
  ['ai_videos', 'user_id = ?1'], ['marketer_media', 'user_id = ?1'], ['jobs', 'user_id = ?1'], ['user_features', 'user_id = ?1'],
  ['feature_usage', 'user_id = ?1'], ['customer_notes', 'user_id = ?1'], ['customer_tags', 'user_id = ?1'], ['subscriptions', 'user_id = ?1'],
  ['studio_sso_codes', 'user_id = ?1'], ['auth_password_resets', 'user_id = ?1'], ['auth_passwords', 'user_id = ?1'], ['sessions', 'user_id = ?1'],
  ['auth_identities', 'user_id = ?1'],
];
const KEPT = ['payments', 'receipts', 'credit_ledger', 'admin_audit'];

async function counts(env: Env, userId: string, tables: string[], where = (t: string) => ERASE.find(([n]) => n === t)?.[1] ?? 'user_id = ?1') {
  const row = await env.DB.prepare(`SELECT ${tables.map(t => `(SELECT COUNT(*) FROM ${t} WHERE ${where(t)}) AS "${t}"`).join(', ')}`).bind(userId).first<Record<string, number>>();
  return Object.fromEntries(tables.map(t => [t, row?.[t] ?? 0]).filter(([, n]) => n));
}

async function erasePreview(env: Env, userId: string): Promise<Response> {
  await customerExists(env, userId);
  let studioCounts: unknown = null, studioError: string | null = null;
  if (studioConfigured(env)) {
    try { studioCounts = await studio(env, `/system/member-data?owner=${encodeURIComponent(userId)}`, 'GET', 15_000); }
    catch (error) { studioError = error instanceof StudioSystemError ? error.message : 'อ่านข้อมูลจาก naka-studio ไม่ได้'; }
  }
  return json({ erased: await erased(env, userId), remove: await counts(env, userId, ERASE.map(([t]) => t)), keep: await counts(env, userId, KEPT),
    studio: { connected: studioConfigured(env), counts: studioCounts, error: studioError } });
}

async function erase(request: Request, env: Env, userId: string, who: string): Promise<Response> {
  const input = await body(request);
  const note = reason(input);
  if (input.confirm !== userId) throw new ToolError(400, 'พิมพ์รหัสลูกค้าให้ตรงเพื่อยืนยันการลบ');
  await customerExists(env, userId);
  if (await erased(env, userId)) throw new ToolError(409, 'ข้อมูลของลูกค้านี้ถูกลบไปแล้ว');
  // the studio first: if it cannot erase, nothing here changes and the admin can try again
  let studioResult: unknown = 'not_connected';
  if (studioConfigured(env)) {
    try { studioResult = await studio(env, '/system/erase-member', 'POST', 60_000, { owner: userId }); }
    catch (error) { throw new ToolError(502, 'ลบข้อมูลใน naka-studio ไม่สำเร็จ จึงยังไม่ได้ลบอะไร: ' + (error instanceof StudioSystemError ? error.message : 'ไม่ทราบสาเหตุ')); }
  }
  const mediaKeys = (await env.DB.prepare(`SELECT key FROM marketer_media WHERE user_id = ?1 UNION SELECT output_key FROM ai_videos WHERE user_id = ?1 AND output_key IS NOT NULL
    UNION SELECT key FROM social_media WHERE user_id = ?1`).bind(userId).all<{ key: string }>()).results.map(r => r.key);
  const removed = await counts(env, userId, ERASE.map(([t]) => t));
  const kept = await counts(env, userId, KEPT);
  const t = now();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO admin_audit (id, user_id, action, detail, note, actor, created_at) VALUES (?, ?, 'erase', ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), userId, JSON.stringify({ input: { note }, removed, kept, files: mediaKeys.length, studio: studioResult }), note, who, t),
    ...ERASE.map(([table, where]) => env.DB.prepare(`DELETE FROM ${table} WHERE ${where}`).bind(userId)),
    env.DB.prepare(`UPDATE payments SET status = 'expired' WHERE user_id = ? AND status = 'pending'`).bind(userId),
    env.DB.prepare(`UPDATE users SET display_name = '', status = 'disabled' WHERE id = ?`).bind(userId),
  ]);
  // files last: a file that fails to go is logged; the database no longer points at it
  if (mediaKeys.length && env.MEDIA) await env.MEDIA.delete(mediaKeys).catch(() => console.error('erase: some media not deleted'));
  return json({ ok: true, removed, kept, files: mediaKeys.length, studio: studioResult });
}

// ---------- router ----------

export async function handleCustomerTools(request: Request, env: Env, url: URL, actor: AdminActor): Promise<Response | null> {
  const path = url.pathname;
  const method = request.method, who = actor.label;
  try {
    if (path === BASE + '.csv' && method === 'GET') return await customersCsv(env, url);
    if (path === BASE + '/bulk-credits' && method === 'POST') return await bulkCredits(request, env, who);
    const m = path.slice(BASE.length).match(/^\/([^/]{1,200})\/(notes|tags|export|erase-preview|erase)(?:\/([^/]{1,200}))?$/);
    if (!m) return null;
    let userId: string, item: string | null = null;
    try { userId = decodeURIComponent(m[1]); if (m[3]) item = decodeURIComponent(m[3]); } catch { throw new ToolError(400, 'รหัสไม่ถูกต้อง'); }
    const [, , kind] = m;
    if (kind === 'notes' && !item && method === 'POST') {
      const input = await body(request);
      const text = typeof input.body === 'string' ? input.body.trim() : '';
      if (!text || text.length > 1000) throw new ToolError(400, 'โน้ตยาว 1 ถึง 1000 ตัวอักษร');
      await customerExists(env, userId);
      await env.DB.prepare('INSERT INTO customer_notes (id, user_id, body, author, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), userId, text, who, now()).run();
      return json(await customerExtras(env, userId), 201);
    }
    if (kind === 'notes' && item && method === 'DELETE') {
      const gone = await env.DB.prepare('DELETE FROM customer_notes WHERE id = ? AND user_id = ?').bind(item, userId).run();
      if (!gone.meta.changes) throw new ToolError(404, 'ไม่พบโน้ตนี้');
      return json(await customerExtras(env, userId));
    }
    if (kind === 'tags' && !item && method === 'POST') {
      const tag = cleanTag((await body(request)).tag);
      await customerExists(env, userId);
      await env.DB.prepare('INSERT INTO customer_tags (user_id, tag, added_by, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, tag) DO NOTHING')
        .bind(userId, tag, who, now()).run();
      return json(await customerExtras(env, userId), 201);
    }
    if (kind === 'tags' && item && method === 'DELETE') {
      await env.DB.prepare('DELETE FROM customer_tags WHERE user_id = ? AND tag = ?').bind(userId, item).run();
      return json(await customerExtras(env, userId));
    }
    if (kind === 'export' && !item && method === 'POST') return await exportCustomer(request, env, userId, who);
    if (kind === 'erase-preview' && !item && method === 'GET') return await erasePreview(env, userId);
    if (kind === 'erase' && !item && method === 'POST') return await erase(request, env, userId, who);
    return json({ error: 'ไม่รองรับวิธีเรียกใช้งานนี้' }, 405);
  } catch (error) {
    if (error instanceof ToolError) return json({ error: error.message }, error.status);
    console.error('customer tools: request failed');
    return json({ error: 'ระบบขัดข้อง กรุณาลองใหม่' }, 500);
  }
}
