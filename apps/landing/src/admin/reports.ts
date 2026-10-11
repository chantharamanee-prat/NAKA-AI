// GET /api/admin/reports?months=6: รายงาน (page /admin/reports/), how the business is doing month by month (Thailand
// months, as the reporting views count them):
//   months    new customers, first-time payers, paying customers, revenue, packages that ended without renewal, credits used
//   funnel    of the customers who signed up in the window: how many used credits, how many paid
//   features  use of each metered feature per month (feature_usage, migrations/pg/0003_entitlements.sql)
//   jobs      naka-ai jobs by kind: how many, how many failed
//   top       the customers who paid the most in the window
//   now       packages in force and the monthly revenue they stand for (a yearly package counts a twelfth)
import type { Env } from '../types';
import { bangkokMonth } from './insights';

const BKK = 7 * 3600;
const now = () => Math.floor(Date.now() / 1000);
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
const monthKey = (t: number) => new Date((t + BKK) * 1000).toISOString().slice(0, 7);
const utcText = (t: number) => new Date(t * 1000).toISOString().slice(0, 19).replace('T', ' ');
/** 'YYYY-MM' of the Thailand month a column holds: unix seconds, or SQLite-style UTC text */
const MONTH_OF = (column: string) => `to_char(to_timestamp(${column}) AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM')`;
const MONTH_OF_TEXT = (column: string) => `to_char((${column}::timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM')`;

async function report(env: Env, months: number): Promise<Response> {
  const t = now();
  const from = bangkokMonth(t, -(months - 1));
  const keys = Array.from({ length: months }, (_, i) => monthKey(bangkokMonth(t, -(months - 1) + i)));
  const db = env.DB;
  const [signups, payers, revenue, ended, credits, funnel, features, jobs, top, active] = await Promise.all([
    db.prepare(`SELECT ${MONTH_OF('created_at')} AS m, COUNT(*) AS n FROM users WHERE created_at >= ?1 GROUP BY 1`).bind(from).all<{ m: string; n: number }>(),
    // a customer's first successful payment, in the month it was paid
    db.prepare(`SELECT ${MONTH_OF('first_paid')} AS m, COUNT(*) AS n FROM
      (SELECT user_id, MIN(COALESCE(paid_at, created_at)) AS first_paid FROM payments WHERE status = 'successful' GROUP BY user_id) f
      WHERE first_paid >= ?1 GROUP BY 1`).bind(from).all<{ m: string; n: number }>(),
    db.prepare(`SELECT ${MONTH_OF('COALESCE(paid_at, created_at)')} AS m, COALESCE(SUM(amount_satang), 0) AS satang, COUNT(DISTINCT user_id) AS payers, COUNT(*) AS payments
      FROM payments WHERE status = 'successful' AND COALESCE(paid_at, created_at) >= ?1 GROUP BY 1`).bind(from).all<{ m: string; satang: number; payers: number; payments: number }>(),
    // a package whose end has passed and was not extended (a renewal moves expires_at forward)
    db.prepare(`SELECT ${MONTH_OF('expires_at')} AS m, COUNT(*) AS n FROM subscriptions WHERE expires_at >= ?1 AND expires_at <= ?2 GROUP BY 1`).bind(from, t).all<{ m: string; n: number }>(),
    db.prepare(`SELECT ${MONTH_OF_TEXT('created_at')} AS m,
        -COALESCE(SUM(delta) FILTER (WHERE reason IN ('job_hold', 'job_refund')), 0) AS landing,
        -COALESCE(SUM(delta) FILTER (WHERE reason IN ('studio_hold', 'studio_refund')), 0) AS studio
      FROM credit_ledger WHERE created_at >= ?1 GROUP BY 1`).bind(utcText(from)).all<{ m: string; landing: number; studio: number }>(),
    db.prepare(`SELECT COUNT(*) AS signed,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM credit_ledger l WHERE l.user_id = u.id AND l.reason IN ('job_hold', 'studio_hold'))) AS used,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM payments p WHERE p.user_id = u.id AND p.status = 'successful')) AS paid
      FROM users u WHERE u.created_at >= ?1`).bind(from).first<{ signed: number; used: number; paid: number }>(),
    db.prepare(`SELECT u.feature_key AS key, f.label, f.quota_unit AS unit, u.period AS m, SUM(u.used) AS used, COUNT(DISTINCT u.user_id) AS users
      FROM feature_usage u JOIN features f ON f.key = u.feature_key WHERE u.period >= ?1 AND u.used > 0
      GROUP BY u.feature_key, f.label, f.quota_unit, f.sort_order, u.period ORDER BY f.sort_order, u.feature_key, u.period`).bind(keys[0])
      .all<{ key: string; label: string; unit: string | null; m: string; used: number; users: number }>(),
    db.prepare(`SELECT kind, COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'failed') AS failed, COUNT(DISTINCT user_id) AS users
      FROM jobs WHERE created_at >= ?1 GROUP BY kind ORDER BY total DESC`).bind(utcText(from)).all<{ kind: string; total: number; failed: number; users: number }>(),
    db.prepare(`SELECT p.user_id AS "userId", u.display_name AS name, SUM(p.amount_satang) AS satang, COUNT(*) AS payments
      FROM payments p LEFT JOIN users u ON u.id = p.user_id WHERE p.status = 'successful' AND COALESCE(p.paid_at, p.created_at) >= ?1
      GROUP BY p.user_id, u.display_name ORDER BY satang DESC, p.user_id LIMIT 10`).bind(from).all<{ userId: string; name: string | null; satang: number; payments: number }>(),
    db.prepare(`SELECT COUNT(*) AS subs,
        COALESCE(SUM(CASE WHEN s.billing_period = 'yearly' THEN p.price_thb * 10 / 12.0 ELSE p.price_thb END), 0) AS mrr
      FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > ?1) AND p.price_thb > 0`)
      .bind(t).first<{ subs: number; mrr: number }>(),
  ]);
  const by = <R extends { m: string }>(rows: R[]) => new Map(rows.map(r => [r.m, r]));
  const s = by(signups.results), p = by(payers.results), r = by(revenue.results), e = by(ended.results), c = by(credits.results);
  const featureMap = new Map<string, { key: string; label: string; unit: string | null; months: Record<string, { used: number; users: number }> }>();
  for (const row of features.results) {
    const f = featureMap.get(row.key) ?? { key: row.key, label: row.label, unit: row.unit, months: {} };
    f.months[row.m] = { used: row.used, users: row.users };
    featureMap.set(row.key, f);
  }
  return json({
    generatedAt: t, months: keys,
    monthly: keys.map(m => ({ month: m, signups: s.get(m)?.n ?? 0, firstPayers: p.get(m)?.n ?? 0, payers: r.get(m)?.payers ?? 0,
      payments: r.get(m)?.payments ?? 0, revenue: (r.get(m)?.satang ?? 0) / 100, ended: e.get(m)?.n ?? 0,
      creditsLanding: c.get(m)?.landing ?? 0, creditsStudio: c.get(m)?.studio ?? 0 })),
    funnel: { signed: funnel?.signed ?? 0, used: funnel?.used ?? 0, paid: funnel?.paid ?? 0 },
    features: [...featureMap.values()],
    jobs: jobs.results,
    top: top.results.map(row => ({ userId: row.userId, name: row.name, revenue: row.satang / 100, payments: row.payments })),
    now: { subscriptions: active?.subs ?? 0, mrr: Math.round((active?.mrr ?? 0) * 100) / 100 },
  });
}

export async function handleReports(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/admin/reports') return null;
  if (request.method !== 'GET') return json({ error: 'ไม่รองรับวิธีเรียกใช้งานนี้' }, 405);
  const months = Math.min(24, Math.max(2, Math.trunc(Number(url.searchParams.get('months'))) || 6));
  try { return await report(env, months); }
  catch { console.error('admin reports: failed'); return json({ error: 'ระบบขัดข้อง กรุณาลองใหม่' }, 500); }
}
