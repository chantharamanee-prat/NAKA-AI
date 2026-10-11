// รายงาน (src/admin/reports.ts) and สถานะเซิร์ฟเวอร์ (src/admin/server-status.ts, server/server-info.ts).
const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, after } = require('node:test');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync, writeFileSync, utimesSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { migratedDb } = require('./helpers/d1.cjs');
const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.wrangler', `reports-status-tests-${process.pid}`);
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16', '--rootDir', path.join(root, 'src'), '--outDir', buildDir], { stdio: 'inherit' });
// server/server-info.ts is Node-only (not in the Worker build): compile it on its own
const serverDir = path.join(buildDir, 'server');
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), path.join(root, 'server/server-info.ts'), '--ignoreConfig',
  '--outDir', serverDir, '--module', 'node16', '--moduleResolution', 'node16', '--target', 'es2022', '--types', 'node', '--skipLibCheck'], { cwd: root, stdio: 'inherit' });
const worker = require(path.join(buildDir, 'index.js')).default;
const { bangkokMonth } = require(path.join(buildDir, 'admin/insights.js'));
const { serverInfo } = require(path.join(serverDir, 'server-info.js'));

const TOKEN = 'test-only-admin-token';
const t = () => Math.floor(Date.now() / 1000);
const utc = (s) => new Date(s * 1000).toISOString().slice(0, 19).replace('T', ' ');
const monthKey = (s) => new Date((s + 7 * 3600) * 1000).toISOString().slice(0, 7);
let sqlite, db, env;
beforeEach(() => {
  ({ sqlite, db } = migratedDb());
  env = { DB: db, ADMIN_TOKEN: TOKEN, APP_ORIGIN: 'https://naka.test', SESSION_SECRET: 's'.repeat(40), ASSETS: { fetch: async () => new Response('asset') } };
});
afterEach(() => sqlite.close());
after(() => { assert.equal(path.dirname(buildDir), path.join(root, '.wrangler')); rmSync(buildDir, { recursive: true, force: true }); });
const get = async (pathname, e = env) => {
  const r = await worker.fetch(new Request('https://naka.test' + pathname, { headers: { Authorization: 'Bearer ' + TOKEN } }), e, { waitUntil() {} });
  assert.equal(r.status, 200, pathname);
  return r.json();
};

test('reports: month by month, the funnel, features, jobs, top customers and the monthly revenue in force', async () => {
  const now = t(), thisMonth = bangkokMonth(now), lastMonth = bangkokMonth(now, -1), old = bangkokMonth(now, -8);
  const [m0, m1] = [monthKey(lastMonth), monthKey(thisMonth)];
  sqlite.exec(`INSERT INTO users (id, display_name, created_at) VALUES ('a', 'ร้านเอ', ${lastMonth + 100}), ('b', 'ร้านบี', ${thisMonth + 100}),
    ('c', 'ร้านซี', ${thisMonth + 200}), ('z', 'เก่า', ${old})`);
  const pay = (id, user, satang, at) => sqlite.prepare(`INSERT INTO payments (id, user_id, plan_id, period, amount_satang, method, status, created_at, paid_at)
    VALUES (?, ?, 'starter', 'monthly', ?, 'promptpay', 'successful', ?, ?)`).run(id, user, satang, at, at);
  pay('p1', 'a', 39900, lastMonth + 500); pay('p2', 'a', 39900, thisMonth + 500); pay('p3', 'b', 79000, thisMonth + 600); pay('old', 'z', 1000, old + 10);
  sqlite.exec(`INSERT INTO subscriptions (user_id, plan_id, status, billing_period, expires_at) VALUES
    ('a', 'starter', 'active', 'monthly', ${now + 86400 * 20}), ('b', 'pro', 'active', 'yearly', ${now + 86400 * 300}), ('c', 'starter', 'active', 'monthly', ${thisMonth + 1000})`);
  sqlite.prepare("INSERT INTO credit_ledger (user_id, delta, reason, job_id, created_at) VALUES ('a', -5, 'job_hold', 'j1', ?), ('b', -8, 'studio_hold', 's1', ?)")
    .run(utc(thisMonth + 700), utc(thisMonth + 800));
  sqlite.exec(`INSERT INTO feature_usage (user_id, feature_key, period, used) VALUES ('a', 'landing.clips', '${m1}', 4), ('b', 'landing.clips', '${m1}', 2), ('a', 'landing.clips', '${m0}', 1)`);
  sqlite.prepare("INSERT INTO jobs (id, user_id, kind, status, cost_credits, created_at) VALUES ('j1', 'a', 'ai_video', 'done', 5, ?), ('j2', 'a', 'ai_video', 'failed', 5, ?), ('j3', 'b', 'affiliate_review', 'done', 2, ?)")
    .run(utc(thisMonth + 700), utc(thisMonth + 710), utc(thisMonth + 720));

  const r = await get('/api/admin/reports?months=2');
  assert.deepEqual(r.months, [m0, m1]);
  const [last, cur] = r.monthly;
  assert.deepEqual([last.signups, last.firstPayers, last.payers, last.revenue], [1, 1, 1, 399]);
  assert.deepEqual([cur.signups, cur.firstPayers, cur.payers, cur.payments, cur.revenue], [2, 1, 2, 2, 1189]);
  assert.equal(cur.ended, now > thisMonth + 1000 ? 1 : 0, 'c\'s package ended this month and was not renewed');
  assert.deepEqual([cur.creditsLanding, cur.creditsStudio], [5, 8]);
  assert.deepEqual(r.funnel, { signed: 3, used: 2, paid: 2 }, 'only customers who signed up in the window');
  const clips = r.features.find(f => f.key === 'landing.clips');
  assert.deepEqual(clips.months[m1], { used: 6, users: 2 }); assert.deepEqual(clips.months[m0], { used: 1, users: 1 });
  assert.deepEqual(r.jobs.map(j => [j.kind, j.total, j.failed]), [['ai_video', 2, 1], ['affiliate_review', 1, 0]]);
  assert.deepEqual(r.top.map(x => [x.userId, x.revenue]), [['a', 798], ['b', 790]], 'the payment from 8 months ago is outside');
  assert.equal(r.now.subscriptions, now < thisMonth + 1000 ? 3 : 2);
  assert.equal(r.now.mrr, 399 + Math.round(790 * 10 / 12 * 100) / 100 + (now < thisMonth + 1000 ? 399 : 0));
  assert.equal((await get('/api/admin/reports?months=999')).months.length, 24);
});

test('server status: the database, the cron heartbeat, and what only the Node server knows', async () => {
  let s = await get('/api/admin/server');
  assert.equal(s.server.ok, false); assert.match(s.server.error, /Node/);
  assert.equal(s.database.ok, true); assert.ok(s.database.data.bytes > 0); assert.ok(s.database.data.biggestTables.length > 0);
  assert.equal(s.cron.lastAt, null); assert.equal(s.cron.running, false);

  // the cron beats every minute
  const pending = [];
  await worker.scheduled({ scheduledTime: Date.now(), cron: '* * * * *' }, env, { waitUntil: (p) => pending.push(p) });
  await Promise.allSettled(pending);
  s = await get('/api/admin/server');
  assert.equal(s.cron.running, true); assert.ok(s.cron.lastAt >= t() - 5);
  sqlite.prepare("UPDATE runtime_heartbeats SET at = ? WHERE name = 'cron'").run(t() - 600);
  assert.equal((await get('/api/admin/server')).cron.running, false, 'ten minutes quiet: not running');

  const e = { ...env, SERVER_INFO: async () => ({ process: { uptimeSeconds: 5 }, disks: [], backups: { configured: false } }) };
  assert.deepEqual((await get('/api/admin/server', e)).server, { ok: true, data: { process: { uptimeSeconds: 5 }, disks: [], backups: { configured: false } } });
  assert.equal((await get('/api/admin/server', { ...env, SERVER_INFO: async () => { throw new Error('boom'); } })).server.ok, false, 'a failing part is reported, not fatal');
});

test('server info: process, disks, and the backups written by infra/backup/backup.sh, newest first', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'naka-backups-'));
  const saved = { BACKUP_DIR: process.env.BACKUP_DIR, MEDIA_DIR: process.env.MEDIA_DIR };
  try {
    writeFileSync(path.join(dir, 'naka-20261009-0300.dump'), 'a'.repeat(10));
    writeFileSync(path.join(dir, 'naka-20261010-0300.dump'), 'b'.repeat(20));
    writeFileSync(path.join(dir, 'naka-20261011-0300.dump.partial'), 'x');
    writeFileSync(path.join(dir, 'notes.txt'), 'x');
    utimesSync(path.join(dir, 'naka-20261010-0300.dump'), 1791600000, 1791600000);
    writeFileSync(path.join(dir, 'last.json'), JSON.stringify({ ok: true, at: 1791600000, file: 'naka-20261010-0300.dump', bytes: 20 }));
    process.env.BACKUP_DIR = dir; delete process.env.MEDIA_DIR;
    const info = await serverInfo('all')();
    assert.equal(info.process.role, 'all'); assert.ok(info.process.uptimeSeconds >= 0); assert.ok(info.process.rssBytes > 0);
    assert.deepEqual(info.backups.files.map(f => [f.name, f.bytes]), [['naka-20261010-0300.dump', 20], ['naka-20261009-0300.dump', 10]], 'only finished dumps');
    assert.equal(info.backups.files[0].at, 1791600000);
    assert.equal(info.backups.last.file, 'naka-20261010-0300.dump');
    assert.ok(info.disks.some(d => d.path === dir && d.totalBytes > 0 && d.freeBytes > 0));
    delete process.env.BACKUP_DIR;
    assert.deepEqual((await serverInfo('web')()).backups, { configured: false, last: null, files: [], error: null });
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    rmSync(dir, { recursive: true, force: true });
  }
});
