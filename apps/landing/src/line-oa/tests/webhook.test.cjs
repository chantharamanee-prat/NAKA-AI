// LINE OA tenant webhook (Stage 1) + connect API: signature order, receipts, idempotency, C1–C3.
const assert = require('node:assert/strict');
const { test, after, mock } = require('node:test');
const { migratedDb } = require('../../../tests/helpers/d1.cjs');
const { mkdirSync, writeFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');

const root = path.resolve(__dirname, '../../..');
const output = path.join(root, '.wrangler', `line-oa-webhook-tests-${process.pid}`);
mkdirSync(output, { recursive: true });
const compiled = buildSync({ stdin: { contents: `export * from './src/line-oa/index';
  export { normalizeLineEvents } from './src/line-oa/events';
  export { runQueue } from './src/jobs';
  export { encryptToken, decryptToken, lineContext } from './src/social/crypto';`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs' });
writeFileSync(path.join(output, 'line-oa.cjs'), compiled.outputFiles[0].text);
const lineoa = require(path.join(output, 'line-oa.cjs'));

class D1 {
  constructor() { const { sqlite, db } = migratedDb(); this.sql = sqlite; this.db = db; }
  prepare(query) { return this.db.prepare(query); }
  batch(statements) { return this.db.batch(statements); }
}

let time = 1800000000000;
mock.method(Date, 'now', () => time);
const T = 1800000000 - 10;
const ORIGIN = 'https://naka.test';
const SECRET = '0123456789abcdef0123456789abcdef';
const TOKEN32 = 'a'.repeat(32);
const BOT = { userId: 'Ubot123', basicId: '@shop123', displayName: 'ร้านทดสอบ' };

async function sign(bytes, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Buffer.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes))).toString('base64');
}

const http = mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected live HTTP'); });
after(() => { mock.restoreAll(); rmSync(output, { recursive: true, force: true }); });

function botInfoReply() {
  return new Response(JSON.stringify({ userId: BOT.userId, basicId: BOT.basicId, displayName: BOT.displayName }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
}
function verifyReply() {
  return new Response(JSON.stringify({ client_id: '1234567890', scope: 'message' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
}
function mockConnect() {
  http.mock.mockImplementation(async url => {
    const u = String(url);
    if (u.includes('/oauth2/v2.1/verify')) return verifyReply();
    if (u.endsWith('/v2/bot/info')) return botInfoReply();
    throw new Error('Unexpected HTTP ' + u);
  });
}

async function setup(t, { feature = true } = {}) {
  time = 1800000000000;
  const DB = new D1();
  t.after(() => DB.sql.close());
  DB.sql.exec(`INSERT INTO users (id, created_at) VALUES ('user-a', 0), ('user-b', 0);
    INSERT INTO subscriptions (user_id, plan_id) VALUES ('user-a', 'business');`);
  const env = { DB, APP_ORIGIN: ORIGIN, SOCIAL_TOKEN_KEY: Buffer.alloc(32, 9).toString('base64'),
    ...(feature ? {} : { FEATURE_LINE_AUTOREPLY: 'off' }) };
  const secretEnc = await lineoa.encryptToken(env, SECRET, lineoa.lineContext('user-a', 'chan1'));
  const tokenEnc = await lineoa.encryptToken(env, 'channel-token', lineoa.lineContext('user-a', 'chan1'));
  DB.sql.prepare(`INSERT INTO line_accounts (id,user_id,channel_id,destination,name,secret_enc,token_enc,webhook_token,created_at,updated_at)
    VALUES ('acct-a','user-a','chan1','Ubot123','ร้านทดสอบ',?,?,?, ?,?)`).run(secretEnc, tokenEnc, TOKEN32, T, T);
  http.mock.resetCalls();
  http.mock.mockImplementation(async () => { throw new Error('Unexpected HTTP'); });
  const pending = [];
  const ctx = { waitUntil: p => pending.push(p) };
  const webhook = async (token, body, sig) => {
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    const response = await lineoa.handleTenantLineWebhook(new Request(`${ORIGIN}/webhook/line/${token}`,
      { method: 'POST', body: bytes, headers: { 'Content-Type': 'application/json', ...(sig === null ? {} : { 'x-line-signature': sig ?? await sign(bytes, SECRET) }) } }), env, ctx);
    await Promise.all(pending.splice(0));
    return response;
  };
  return { DB, env, ctx, webhook };
}

const lineBody = (eventId, text = 'สวัสดีค่ะ', extra = {}) => JSON.stringify({ destination: 'Ubot123',
  events: [{ type: 'message', replyToken: 'r1', source: { type: 'user', userId: 'Ucust1' },
    timestamp: (time - 5000), webhookEventId: eventId, deliveryContext: { isRedelivery: false },
    message: { id: 'm1', type: 'text', text }, ...extra }] });

test('a correctly signed payload stores one receipt and one message; the legacy /webhook/line path is untouched', async t => {
  const { DB, webhook } = await setup(t);
  const response = await webhook(TOKEN32, lineBody('ev-1'));
  assert.equal(response.status, 200);
  assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM line_webhook_receipts').get().n, 1);
  assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM line_messages').get().n, 1);
  const row = DB.sql.prepare('SELECT body,status,reply_token AS replyToken FROM line_messages').get();
  assert.equal(row.body, 'สวัสดีค่ะ');
  assert.equal(row.status, 'pending');
  assert.equal(row.replyToken, 'r1');
  // The exact-match legacy bot path must not be claimed by the tenant handler.
  const legacy = await lineoa.handleTenantLineWebhook(
    new Request(`${ORIGIN}/webhook/line`, { method: 'POST', body: '{}' }), {}, { waitUntil() {} });
  assert.equal(legacy, null);
});

test('replaying the same body stores nothing twice; a duplicate webhookEventId in a new body is also ignored', async t => {
  const { DB, webhook } = await setup(t);
  const body = lineBody('ev-1');
  assert.equal((await webhook(TOKEN32, body)).status, 200);
  assert.equal((await webhook(TOKEN32, body)).status, 200);
  assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM line_webhook_receipts').get().n, 1);
  assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM line_messages').get().n, 1);
  const other = lineBody('ev-1', 'ส่งอีกครั้ง');
  assert.equal((await webhook(TOKEN32, other)).status, 200, 'new bytes, same webhookEventId');
  assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM line_webhook_receipts').get().n, 2);
  assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM line_messages').get().n, 1);
});

test('bad signature → 401 without disabling the account; missing → 401; unknown token → 404; oversize → 413', async t => {
  const { DB, webhook } = await setup(t);
  const body = lineBody('ev-1');
  assert.equal((await webhook(TOKEN32, body, 'bogus')).status, 401);
  assert.equal((await webhook(TOKEN32, body, null)).status, 401);
  assert.equal((await webhook('b'.repeat(32), body, await sign(new TextEncoder().encode(body), SECRET))).status, 404);
  const big = 'x'.repeat(257 * 1024);
  assert.equal((await webhook(TOKEN32, big, 'bogus')).status, 413);
  // C2: probing the webhook URL records last_error but leaves a working account active.
  const account = DB.sql.prepare('SELECT status,last_error AS lastError FROM line_accounts WHERE id=?').get('acct-a');
  assert.equal(account.status, 'active');
  assert.equal(account.lastError, 'invalid_signature');
  assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM line_webhook_receipts').get().n, 0);
});

test('destination mismatch → 401; first webhook learns the destination', async t => {
  const { DB, webhook } = await setup(t);
  DB.sql.prepare('UPDATE line_accounts SET destination=NULL WHERE id=?').run('acct-a');
  const learned = JSON.stringify({ destination: 'Ubot999', events: [] });
  assert.equal((await webhook(TOKEN32, learned)).status, 200);
  assert.equal(DB.sql.prepare('SELECT destination FROM line_accounts WHERE id=?').get('acct-a').destination, 'Ubot999');
  const wrong = JSON.stringify({ destination: 'Ubot000', events: [] });
  assert.equal((await webhook(TOKEN32, wrong)).status, 401);
});

test('feature switch off → 200 and drop; DB failure → 503', async t => {
  const off = await setup(t, { feature: false });
  assert.equal((await off.webhook(TOKEN32, lineBody('ev-1'))).status, 200);
  assert.equal(off.DB.sql.prepare('SELECT COUNT(*) AS n FROM line_webhook_receipts').get().n, 0);
  const { env, ctx } = await setup(t);
  const broken = { ...env, DB: { prepare() { throw new Error('down'); }, batch() { throw new Error('down'); } } };
  const bytes = new TextEncoder().encode(lineBody('ev-1'));
  const response = await lineoa.handleTenantLineWebhook(new Request(`${ORIGIN}/webhook/line/${TOKEN32}`,
    { method: 'POST', body: bytes, headers: { 'x-line-signature': await sign(bytes, SECRET) } }), broken, ctx);
  assert.equal(response.status, 503);
});

test('connect verifies ownership with LINE, encrypts credentials, and returns the webhook URL — never a secret', async t => {
  const { DB, env } = await setup(t);
  mockConnect();
  const api = (route, { method = 'GET', body } = {}) => {
    const url = new URL(`${ORIGIN}/api/line/${route}`);
    return lineoa.handleLineOa(new Request(url, { method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' } }), env, url, 'user-a');
  };
  const created = await api('accounts', { method: 'POST',
    body: { channelSecret: SECRET, channelAccessToken: 'pasted-token' } });
  assert.equal(created.status, 201);
  const data = await created.json();
  assert.match(data.webhookUrl, new RegExp(`^${ORIGIN}/webhook/line/[0-9a-f]{32}$`));
  assert.ok(!('secret_enc' in data) && !('token_enc' in data) && !JSON.stringify(data).includes('pasted-token'), 'no secret in the response');
  const stored = DB.sql.prepare('SELECT channel_id AS channelId,destination,secret_enc AS secretEnc,token_enc AS tokenEnc FROM line_accounts WHERE id=?').get(data.id);
  assert.equal(stored.channelId, '1234567890', 'channel_id comes from LINE OAuth verify, not member input');
  assert.equal(stored.destination, BOT.userId);
  assert.ok(stored.secretEnc.startsWith('v1.') && !stored.secretEnc.includes(SECRET));
  assert.equal(await lineoa.decryptToken(env, stored.tokenEnc, lineoa.lineContext('user-a', '1234567890')), 'pasted-token');
  const listed = await (await api('accounts')).json();
  assert.ok(!JSON.stringify(listed).includes('pasted-token') && !JSON.stringify(listed).includes(SECRET), 'list returns no secret');
  // Reconnecting the same OA with fresh credentials updates in place and keeps history.
  const again = await api('accounts', { method: 'POST',
    body: { channelSecret: 'fedcba9876543210fedcba9876543210', channelAccessToken: 'rotated-token' } });
  assert.equal(again.status, 200);
  const redone = await again.json();
  assert.deepEqual([redone.id, redone.reconnected], [data.id, true]);
  assert.equal(await lineoa.decryptToken(env,
    DB.sql.prepare('SELECT token_enc AS t FROM line_accounts WHERE id=?').get(data.id).t,
    lineoa.lineContext('user-a', '1234567890')), 'rotated-token');
  // C3: disconnect wipes the credentials.
  DB.sql.prepare('INSERT INTO line_webhook_receipts (id,line_account_id,body,created_at) VALUES (?,?,?,?)').run('r1', data.id, '{}', T);
  assert.equal(await api(`accounts/${data.id}`, { method: 'DELETE' }).then(r => r.status), 204);
  assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM line_accounts WHERE id=?').get(data.id).n, 0);
  assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM line_webhook_receipts WHERE line_account_id=?').get(data.id).n, 0);
  assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM line_settings WHERE line_account_id=?').get(data.id).n, 0);
});

test('connect rejects a bad secret and a token LINE does not recognise', async t => {
  const { env } = await setup(t);
  http.mock.mockImplementation(async url => {
    const u = String(url);
    if (u.includes('/oauth2/v2.1/verify') || u.endsWith('/v2/bot/info')) return new Response('{}', { status: 401 });
    throw new Error('Unexpected HTTP ' + u);
  });
  const post = body => {
    const url = new URL(`${ORIGIN}/api/line/accounts`);
    return lineoa.handleLineOa(new Request(url, { method: 'POST', body: JSON.stringify(body),
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' } }), env, url, 'user-a');
  };
  assert.equal((await post({ channelSecret: 'not-hex', channelAccessToken: 'x'.repeat(20) })).status, 400);
  assert.equal((await post({ channelSecret: SECRET, channelAccessToken: 'nope-nope-nope-nope' })).status, 400);
});
