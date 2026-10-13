// LINE event normalisation + storage (Stage 1; groups/rooms are stored, never answered before Stage 4).
const assert = require('node:assert/strict');
const { test, after, mock } = require('node:test');
const { migratedDb } = require('../../../tests/helpers/d1.cjs');
const { mkdirSync, writeFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');

const root = path.resolve(__dirname, '../../..');
const output = path.join(root, '.wrangler', `line-oa-events-tests-${process.pid}`);
mkdirSync(output, { recursive: true });
const compiled = buildSync({ stdin: { contents: `export * from './src/line-oa/index';
  export { normalizeLineEvents, groupAddressed } from './src/line-oa/events';
  export { encryptToken, lineContext } from './src/social/crypto';`, resolveDir: root, loader: 'ts' },
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

async function sign(bytes, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Buffer.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes))).toString('base64');
}
mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected live HTTP'); });
after(() => { mock.restoreAll(); rmSync(output, { recursive: true, force: true }); });

async function setup(t) {
  time = 1800000000000;
  const DB = new D1();
  t.after(() => DB.sql.close());
  DB.sql.exec(`INSERT INTO users (id, created_at) VALUES ('user-a', 0);
    INSERT INTO subscriptions (user_id, plan_id) VALUES ('user-a', 'business');`);
  const env = { DB, APP_ORIGIN: ORIGIN, SOCIAL_TOKEN_KEY: Buffer.alloc(32, 9).toString('base64') };
  const secretEnc = await lineoa.encryptToken(env, SECRET, lineoa.lineContext('user-a', 'chan1'));
  const tokenEnc = await lineoa.encryptToken(env, 'channel-token', lineoa.lineContext('user-a', 'chan1'));
  DB.sql.prepare(`INSERT INTO line_accounts (id,user_id,channel_id,destination,name,secret_enc,token_enc,webhook_token,created_at,updated_at)
    VALUES ('acct-a','user-a','chan1','Ubot123','ร้านทดสอบ',?,?,?, ?,?)`).run(secretEnc, tokenEnc, TOKEN32, T, T);
  const pending = [];
  const ctx = { waitUntil: p => pending.push(p) };
  const webhook = async events => {
    const body = JSON.stringify({ destination: 'Ubot123', events });
    const bytes = new TextEncoder().encode(body);
    const response = await lineoa.handleTenantLineWebhook(new Request(`${ORIGIN}/webhook/line/${TOKEN32}`,
      { method: 'POST', body: bytes, headers: { 'x-line-signature': await sign(bytes, SECRET) } }), env, ctx);
    await Promise.all(pending.splice(0));
    return response;
  };
  return { DB, env, webhook };
}

const msg = (over = {}) => ({ type: 'message', replyToken: 'r1', source: { type: 'user', userId: 'Ucust1' },
  timestamp: time - 5000, webhookEventId: `ev-${Math.random().toString(36).slice(2)}`, deliveryContext: { isRedelivery: false },
  message: { id: 'm1', type: 'text', text: 'สวัสดีค่ะ' }, ...over });
const groupMsg = (over = {}) => ({ type: 'message', replyToken: 'r2', source: { type: 'group', groupId: 'G1', userId: 'Ucust2' },
  timestamp: time - 5000, webhookEventId: `ev-${Math.random().toString(36).slice(2)}`, deliveryContext: { isRedelivery: false },
  message: { id: 'm2', type: 'text', text: 'ใครว่างบ้าง' }, ...over });

test('1:1 text is pending and addressed; events without a webhookEventId are ignored', async t => {
  const { DB, webhook } = await setup(t);
  assert.equal((await webhook([msg({ webhookEventId: 'ev-1' })])).status, 200);
  const row = DB.sql.prepare('SELECT status,addressed AS a,event_type AS e,message_type AS m FROM line_messages').get();
  assert.deepEqual([row.status, row.a, row.e, row.m], ['pending', 1, 'message', 'text']);
  const body = JSON.stringify({ destination: 'Ubot123', events: [{ ...msg(), webhookEventId: undefined }] });
  const bytes = new TextEncoder().encode(body);
  const pending = [];
  const res = await lineoa.handleTenantLineWebhook(new Request(`${ORIGIN}/webhook/line/${TOKEN32}`,
    { method: 'POST', body: bytes, headers: { 'x-line-signature': await sign(bytes, SECRET) } }),
    { DB: DB.db, APP_ORIGIN: ORIGIN, SOCIAL_TOKEN_KEY: Buffer.alloc(32, 9).toString('base64') }, { waitUntil: p => pending.push(p) });
  await Promise.all(pending.splice(0));
  assert.equal(res.status, 200);
  assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM line_messages').get().n, 1, 'no id, no row');
});

test('group mention: isSelf, destination fallback, and keyword prefix address the bot; silence stays context-only', async t => {
  const norm = (message, group = {}) => lineoa.normalizeLineEvents(
    { destination: 'Ubot123', events: [groupMsg({ message })] }, { groupMode: 'mention', prefix: '', ...group });
  assert.equal(norm({ type: 'text', text: 'ว่าไง', mention: { mentionees: [{ isSelf: true }] } })[0].addressed, true);
  assert.equal(norm({ type: 'text', text: 'ว่าไง', mention: { mentionees: [{ userId: 'Ubot123' }] } })[0].addressed, true);
  assert.equal(norm({ type: 'text', text: 'ว่าไง' })[0].addressed, false);
  assert.equal(norm({ type: 'text', text: 'ว่าไง' }, { groupMode: 'off', prefix: '' })[0].addressed, false);
  assert.equal(norm({ type: 'text', text: 'บอทช่วยตอบหน่อย' }, { groupMode: 'mention_or_prefix', prefix: 'บอท' })[0].addressed, true);
  const { DB, webhook } = await setup(t);
  assert.equal((await webhook([groupMsg({ webhookEventId: 'ev-g1' })])).status, 200);
  const stored = DB.sql.prepare('SELECT status,addressed AS a,error FROM line_messages').get();
  assert.deepEqual([stored.status, stored.a, stored.error], ['skipped', 0, 'not_addressed']);
});

test('follow opens, unfollow closes, join stores without replying, non-text hands off, postback is unsupported', async t => {
  const { DB, webhook } = await setup(t);
  const ev = (type, extra = {}) => ({ type, replyToken: type === 'follow' ? 'r3' : undefined,
    source: { type: 'user', userId: 'Ucust9' }, timestamp: time - 5000,
    webhookEventId: `ev-${type}-1`, deliveryContext: { isRedelivery: false }, ...extra });
  assert.equal((await webhook([ev('follow')])).status, 200);
  assert.equal(DB.sql.prepare("SELECT status FROM line_chats WHERE external_chat_id='Ucust9'").get().status, 'open');
  assert.equal((await webhook([ev('unfollow')])).status, 200);
  assert.equal(DB.sql.prepare("SELECT status FROM line_chats WHERE external_chat_id='Ucust9'").get().status, 'closed');
  assert.equal((await webhook([{ type: 'join', replyToken: 'r4', source: { type: 'group', groupId: 'G9' },
    timestamp: time - 5000, webhookEventId: 'ev-join-1', deliveryContext: { isRedelivery: false } }])).status, 200);
  assert.equal((await webhook([msg({ webhookEventId: 'ev-img-1', message: { id: 'mi', type: 'image' } })])).status, 200);
  const img = DB.sql.prepare("SELECT status,handoff_reason AS h FROM line_messages WHERE external_id='line:chan1:ev-img-1'").get();
  assert.deepEqual([img.status, img.h], ['drafted', 'attachment_requires_human']);
  assert.equal(DB.sql.prepare("SELECT status FROM line_chats WHERE external_chat_id='Ucust1'").get().status, 'needs_human');
  const n = DB.sql.prepare('SELECT COUNT(*) AS n FROM line_messages').get().n;
  assert.equal((await webhook([{ type: 'postback', replyToken: 'r5', source: { type: 'user', userId: 'Ucust1' },
    timestamp: time - 5000, webhookEventId: 'ev-pb-1', deliveryContext: { isRedelivery: false }, postback: { data: 'x' } }])).status, 200);
  assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM line_messages').get().n, n, 'postback stores nothing');
  assert.equal(DB.sql.prepare("SELECT COUNT(*) AS n FROM line_webhook_receipts WHERE status='done' AND error='unsupported_event'").get().n,
    1, 'a body with zero events is marked unsupported_event');
});
