// Customer care tools (src/admin/customer-tools.ts, migrations/pg/0010_customer_tools.sql): notes and tags, the list
// as CSV, credits for many customers at once, and a customer's data exported or erased on request (PDPA).
const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, after, mock } = require('node:test');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { rmSync } = require('node:fs');
const path = require('node:path');
const { migratedDb } = require('./helpers/d1.cjs');
const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.wrangler', `customer-tools-tests-${process.pid}`);
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16', '--rootDir', path.join(root, 'src'), '--outDir', buildDir], { stdio: 'inherit' });
const worker = require(path.join(buildDir, 'index.js')).default;

const ORIGIN = 'https://naka.test';
const TOKEN = 'test-only-admin-token';
const STUDIO_TOKEN = 'studio-admin-token-0123456789';
const t = () => Math.floor(Date.now() / 1000);
const sha = value => createHash('sha256').update(value).digest('base64url');
let sqlite, db, env, media, studioCalls, studioUp;

beforeEach(() => {
  ({ sqlite, db } = migratedDb());
  media = new Map([['marketer/u1/out/v1.mp4', 1], ['marketer/u2/out/v2.mp4', 1]]);
  env = { DB: db, ADMIN_TOKEN: TOKEN, ADMIN_EMAILS: 'owner@naka.test', APP_ORIGIN: ORIGIN, SESSION_SECRET: 's'.repeat(40),
    STUDIO_INTERNAL_URL: 'http://studio:5679', STUDIO_ADMIN_TOKEN: STUDIO_TOKEN, ASSETS: { fetch: async () => new Response('asset') },
    MEDIA: { async delete(keys) { for (const k of [].concat(keys)) media.delete(k); } } };
  sqlite.exec(`INSERT INTO users (id, display_name, created_at, status) VALUES ('u1', 'ร้านเอ', 1, 'active'), ('u2', '=cmd()', 2, 'active'), ('u3', 'ปิดแล้ว', 3, 'disabled');
    INSERT INTO auth_identities (id, user_id, provider, provider_uid, email, verified_at) VALUES
      ('i1', 'u1', 'google', 'g1', 'shop-a@example.test', 1), ('i2', 'u1', 'phone', '+66811111111', NULL, 1), ('i3', 'u2', 'google', 'g2', 'b@example.test', 1);
    INSERT INTO auth_passwords (user_id, hash, updated_at) VALUES ('u1', 'SECRET_HASH', 1);
    INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s1', 'u1', 9999999999, 1);
    INSERT INTO social_accounts (id, user_id, platform, external_id, name, token_enc, status, created_at) VALUES ('sa1', 'u1', 'facebook', 'p1', 'เพจเอ', 'NEVER_EXPORT_THIS', 'active', 1);
    INSERT INTO marketer_media (key, user_id, kind, content_type, size, created_at) VALUES ('marketer/u1/out/v1.mp4', 'u1', 'output', 'video/mp4', 10, 1);
    INSERT INTO credit_ledger (user_id, delta, reason, note) VALUES ('u1', 30, 'grant', 'เริ่มต้น');
    INSERT INTO payments (id, user_id, plan_id, period, amount_satang, method, status, created_at, paid_at) VALUES
      ('pay1', 'u1', 'starter', 'monthly', 39900, 'promptpay', 'successful', 1, 1), ('pay2', 'u1', 'starter', 'monthly', 39900, 'promptpay', 'pending', 2, NULL);`);
  studioCalls = []; studioUp = true;
  mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = String(input);
    studioCalls.push({ url, method: init.method, body: init.body });
    if (!studioUp) throw new TypeError('fetch failed');
    const data = url.includes('/member-data') ? { owner: 'u1', rows: { dramas: 2, sys_task: 5 }, total: 7 }
      : url.includes('/member-works') ? { works: [{ kind: 'drama', title: 'ละครของเอ' }] }
      : url.includes('/erase-member') ? { owner: 'u1', rows: { dramas: 2 }, total: 7, files: { removed: 4, failed: 0 } } : null;
    return new Response(JSON.stringify({ code: 200, data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
});
afterEach(() => { mock.restoreAll(); sqlite.close(); });
after(() => { assert.equal(path.dirname(buildDir), path.join(root, '.wrangler')); rmSync(buildDir, { recursive: true, force: true }); });

const call = (pathname, init = {}, headers = { Authorization: 'Bearer ' + TOKEN }) => worker.fetch(new Request(ORIGIN + pathname, {
  ...init, headers: { ...headers, ...(init.json !== undefined ? { 'Content-Type': 'application/json', Origin: ORIGIN } : {}) },
  ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}) }), env, { waitUntil() {} });
const get = async (pathname) => (await call(pathname)).json();
function support() {
  sqlite.exec(`INSERT INTO admin_staff (email, role, created_at) VALUES ('helper@naka.test', 'support', 1);
    INSERT INTO users (id, display_name, created_at) VALUES ('staff', 'ทีม', 1);
    INSERT INTO auth_identities (id, user_id, provider, provider_uid, email, verified_at) VALUES ('is', 'staff', 'google', 'gs', 'helper@naka.test', ${t()});`);
  sqlite.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(sha('x'.repeat(43)), 'staff', t() + 3600, t() - 60);
  return { Cookie: 'naka_session=' + 'x'.repeat(43) };
}

test('notes and tags: added and removed on the customer, shown on their page and in the list, searchable by tag', async () => {
  assert.equal((await call('/api/admin/customers/u1/notes', { method: 'POST', json: { body: '' } })).status, 400);
  let extras = await (await call('/api/admin/customers/u1/notes', { method: 'POST', json: { body: 'โทรมาถามเรื่องใบกำกับภาษี' } })).json();
  assert.equal(extras.notes[0].body, 'โทรมาถามเรื่องใบกำกับภาษี'); assert.equal(extras.notes[0].author, 'โทเคนฉุกเฉิน');
  for (const tag of [' VIP ', 'VIP', 'ขอใบกำกับ']) extras = await (await call('/api/admin/customers/u1/tags', { method: 'POST', json: { tag } })).json();
  assert.deepEqual(extras.tags, ['VIP', 'ขอใบกำกับ'], 'trimmed, no duplicates');
  for (const tag of ['', 'a,b', 'x'.repeat(31)]) assert.equal((await call('/api/admin/customers/u1/tags', { method: 'POST', json: { tag } })).status, 400);
  assert.equal((await call('/api/admin/customers/nope/tags', { method: 'POST', json: { tag: 'x' } })).status, 404);

  const detail = await get('/api/admin/customers/u1');
  assert.deepEqual(detail.tags, ['VIP', 'ขอใบกำกับ']); assert.equal(detail.notes.length, 1); assert.equal(detail.erased, false);
  assert.deepEqual(detail.customer.tags, ['VIP', 'ขอใบกำกับ']);
  assert.deepEqual((await get('/api/admin/customers?tag=vip')).customers.map(c => c.id), ['u1'], 'tag search ignores case');
  assert.deepEqual((await get('/api/admin/customers')).customers.find(c => c.id === 'u2').tags, []);

  extras = await (await call('/api/admin/customers/u1/tags/' + encodeURIComponent('ขอใบกำกับ'), { method: 'DELETE' })).json();
  assert.deepEqual(extras.tags, ['VIP']);
  extras = await (await call('/api/admin/customers/u1/notes/' + detail.notes[0].id, { method: 'DELETE' })).json();
  assert.deepEqual(extras.notes, []);
  assert.equal((await call('/api/admin/customers/u1/notes/' + detail.notes[0].id, { method: 'DELETE' })).status, 404);

  // support staff keep notes and tags too
  const cookie = support();
  assert.equal((await call('/api/admin/customers/u2/notes', { method: 'POST', json: { body: 'ลูกค้าใหม่' } }, cookie)).status, 201);
  assert.equal(sqlite.prepare("SELECT author FROM customer_notes WHERE user_id = 'u2'").get().author, 'helper@naka.test');
});

test('the customer list as CSV: Excel-ready, filtered like the list, formulas neutralised', async () => {
  await call('/api/admin/customers/u1/tags', { method: 'POST', json: { tag: 'VIP' } });
  const response = await call('/api/admin/customers.csv');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /naka-ai-customers-\d{4}-\d{2}-\d{2}\.csv/);
  const text = (await response.text()).replace(/^﻿/, '');
  const lines = text.trimEnd().split('\r\n');
  assert.equal(lines.length, 4);
  assert.ok(lines[0].startsWith('รหัสลูกค้า,ชื่อ,อีเมล'));
  assert.ok(lines.some(l => l.startsWith("u2,'=cmd()")), 'a name that looks like a formula is neutralised');
  const a = lines.find(l => l.startsWith('u1,'));
  assert.ok(a.includes('shop-a@example.test') && a.includes('+66811111111') && a.includes(',30,VIP,'));
  const vip = (await (await call('/api/admin/customers.csv?tag=VIP')).text()).trimEnd().split('\r\n');
  assert.equal(vip.length, 2);
});

test('bulk credits: by a list or a tag, one audit row and one grant each, in one go; refused for unknown or closed accounts', async () => {
  const bulk = (json, headers) => call('/api/admin/customers/bulk-credits', { method: 'POST', json }, headers);
  for (const bad of [{ userIds: ['u1'], amount: 0, note: 'x' }, { userIds: ['u1'], amount: 5 }, { userIds: [], amount: 5, note: 'x' },
    { userIds: ['u1', 'ghost'], amount: 5, note: 'x' }, { userIds: ['u1', 'u3'], amount: 5, note: 'x' }, { tag: 'nobody', amount: 5, note: 'x' }, { amount: 5, note: 'x' }]) {
    assert.equal((await bulk(bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM admin_audit").get().n, 0, 'a refused request changes nothing');
  const r = await (await bulk({ userIds: ['u1', 'u2'], amount: 20, note: 'ชดเชยระบบล่ม' })).json();
  assert.equal(r.customers, 2);
  const balance = (id) => sqlite.prepare('SELECT COALESCE(SUM(delta), 0) AS n FROM credit_ledger WHERE user_id = ?').get(id).n;
  assert.equal(balance('u1'), 50); assert.equal(balance('u2'), 20);
  const audits = sqlite.prepare("SELECT user_id, detail, note FROM admin_audit WHERE action = 'credits' ORDER BY user_id").all().map(a => ({ ...a, detail: JSON.parse(a.detail) }));
  assert.deepEqual(audits.map(a => [a.user_id, a.detail.before.credits, a.detail.after.credits, a.detail.input.bulk]), [['u1', 30, 50, r.batch], ['u2', 0, 20, r.batch]]);

  await call('/api/admin/customers/u2/tags', { method: 'POST', json: { tag: 'ทดลองใช้' } });
  assert.equal((await (await bulk({ tag: 'ทดลองใช้', amount: 5, note: 'แจกทดลอง' })).json()).customers, 1);
  assert.equal(balance('u2'), 25);

  const cookie = support();
  assert.equal((await bulk({ userIds: ['u1'], amount: 5, note: 'x' }, cookie)).status, 403, 'bulk credits are for owners');
});

test('export: everything about the customer as a file, no secrets, the studio\'s part, and the export recorded', async () => {
  assert.equal((await call('/api/admin/customers/u1/export', { method: 'POST', json: {} })).status, 400, 'a reason is required');
  await call('/api/admin/customers/u1/notes', { method: 'POST', json: { body: 'โน้ตภายใน' } });
  const response = await call('/api/admin/customers/u1/export', { method: 'POST', json: { note: 'ลูกค้าขอข้อมูลทางอีเมล' } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /naka-ai-customer-u1\.json/);
  const raw = await response.text();
  for (const secret of ['NEVER_EXPORT_THIS', 'SECRET_HASH', '"s1"']) assert.ok(!raw.includes(secret), secret);
  const file = JSON.parse(raw);
  assert.equal(file.customer.name, 'ร้านเอ');
  assert.deepEqual(file.identities.map(i => [i.provider, i.email, i.phone]), [['google', 'shop-a@example.test', null], ['phone', null, '+66811111111']]);
  assert.equal(file.payments.length, 2); assert.equal(file.credits[0].delta, 30);
  assert.deepEqual(file.socialAccounts.map(s => s.name), ['เพจเอ']);
  assert.equal(file.adminNotes[0].body, 'โน้ตภายใน');
  assert.equal(file.nakaStudio.counts.total, 7);
  assert.equal(file.nakaStudio.latestWorks.works[0].title, 'ละครของเอ');
  assert.ok(studioCalls.some(c => c.url === 'http://studio:5679/api/v1/system/member-data?owner=u1'));
  assert.deepEqual(sqlite.prepare("SELECT action, note FROM admin_audit WHERE user_id = 'u1'").all(), [{ action: 'export', note: 'ลูกค้าขอข้อมูลทางอีเมล' }]);
  assert.equal((await call('/api/admin/customers/u1/export', { method: 'POST', json: { note: 'x' } }, support())).status, 403, 'owners only');
});

test('erase: preview first; the studio before anything here; personal data gone, accounting kept, done once', async () => {
  await call('/api/admin/customers/u1/tags', { method: 'POST', json: { tag: 'VIP' } });
  const preview = await get('/api/admin/customers/u1/erase-preview');
  assert.equal(preview.erased, false);
  assert.equal(preview.remove.auth_identities, 2); assert.equal(preview.remove.social_accounts, 1); assert.equal(preview.remove.customer_tags, 1);
  assert.deepEqual(preview.keep, { payments: 2, credit_ledger: 1 }, 'tables with nothing to keep are left out');
  assert.equal(preview.studio.counts.total, 7);

  const erase = (json, headers) => call('/api/admin/customers/u1/erase', { method: 'POST', json }, headers);
  assert.equal((await erase({ confirm: 'u2', note: 'ลูกค้าขอลบ' })).status, 400, 'the id must be typed to confirm');
  assert.equal((await erase({ confirm: 'u1', note: 'x' }, support())).status, 403, 'owners only');

  studioUp = false;
  const down = await erase({ confirm: 'u1', note: 'ลูกค้าขอลบ' });
  assert.equal(down.status, 502); assert.match((await down.json()).error, /ยังไม่ได้ลบอะไร/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auth_identities WHERE user_id = 'u1'").get().n, 2, 'nothing changed');

  studioUp = true;
  const done = await (await erase({ confirm: 'u1', note: 'ลูกค้าขอลบตาม PDPA' })).json();
  assert.equal(done.ok, true);
  assert.equal(JSON.parse(studioCalls.find(c => c.url.endsWith('/erase-member')).body).owner, 'u1');
  for (const table of ['auth_identities', 'auth_passwords', 'sessions', 'social_accounts', 'marketer_media', 'customer_tags']) {
    assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = 'u1'`).get().n, 0, table);
  }
  assert.deepEqual(sqlite.prepare("SELECT display_name, status FROM users WHERE id = 'u1'").get(), { display_name: '', status: 'disabled' });
  assert.deepEqual(sqlite.prepare("SELECT id, status FROM payments WHERE user_id = 'u1' ORDER BY id").all(), [{ id: 'pay1', status: 'successful' }, { id: 'pay2', status: 'expired' }]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE user_id = 'u1'").get().n, 1, 'the ledger is kept');
  assert.deepEqual([...media.keys()], ['marketer/u2/out/v2.mp4'], 'their files go, nobody else\'s');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auth_identities WHERE user_id = 'u2'").get().n, 1, 'other customers untouched');
  const record = JSON.parse(sqlite.prepare("SELECT detail FROM admin_audit WHERE user_id = 'u1' AND action = 'erase'").get().detail);
  assert.equal(record.removed.auth_identities, 2); assert.equal(record.kept.payments, 2); assert.equal(record.studio.total, 7);

  assert.equal((await erase({ confirm: 'u1', note: 'อีกครั้ง' })).status, 409);
  assert.equal((await get('/api/admin/customers/u1/erase-preview')).erased, true);
});
