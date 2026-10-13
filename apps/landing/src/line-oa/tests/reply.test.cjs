// The line_reply job (Stage 2, 1:1 only): draft → send claim → reply token, handoff, rate limit, C4–C5.
const assert = require('node:assert/strict');
const { test, after, mock } = require('node:test');
const { migratedDb } = require('../../../tests/helpers/d1.cjs');
const { mkdirSync, writeFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');

const root = path.resolve(__dirname, '../../..');
const output = path.join(root, '.wrangler', `line-oa-reply-tests-${process.pid}`);
mkdirSync(output, { recursive: true });
const compiled = buildSync({ stdin: { contents: `export * from './src/line-oa/index';
  export { sendLineReply } from './src/line-oa/send';
  export { runQueue } from './src/jobs';
  export { encryptToken, lineContext } from './src/social/crypto';
  export { memberFeatures, useFeature } from './src/entitlements';`, resolveDir: root, loader: 'ts' },
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
const DRAFT = { reply: 'ขอบคุณที่ทักมานะคะ ร้านเปิดทุกวันค่ะ', confidence: 'high', handoff: false, reason: 'kb' };

async function sign(bytes, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Buffer.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes))).toString('base64');
}
function anthropicReply(draft) {
  return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
    content: [{ type: 'text', text: JSON.stringify(draft) }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
const http = mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected live HTTP'); });
after(() => { mock.restoreAll(); rmSync(output, { recursive: true, force: true }); });

async function setup(t) {
  time = 1800000000000;
  const DB = new D1();
  t.after(() => DB.sql.close());
  DB.sql.exec(`INSERT INTO users (id, created_at) VALUES ('user-a', 0);
    INSERT INTO subscriptions (user_id, plan_id) VALUES ('user-a', 'business');
    INSERT INTO inbox_kb (id, user_id, title, content, updated_at) VALUES ('kb-1', 'user-a', 'เวลาเปิดร้าน', 'ร้านเปิดทุกวัน', ${T});`);
  const env = { DB, APP_ORIGIN: ORIGIN, SOCIAL_TOKEN_KEY: Buffer.alloc(32, 9).toString('base64'), ANTHROPIC_API_KEY: 'test-key' };
  const secretEnc = await lineoa.encryptToken(env, SECRET, lineoa.lineContext('user-a', 'chan1'));
  const tokenEnc = await lineoa.encryptToken(env, 'channel-token', lineoa.lineContext('user-a', 'chan1'));
  DB.sql.prepare(`INSERT INTO line_accounts (id,user_id,channel_id,destination,name,secret_enc,token_enc,webhook_token,created_at,updated_at)
    VALUES ('acct-a','user-a','chan1','Ubot123','ร้านทดสอบ',?,?,?, ?,?)`).run(secretEnc, tokenEnc, TOKEN32, T, T);
  DB.sql.prepare(`INSERT INTO line_settings (line_account_id,user_id,mode,allow_push,updated_at)
    VALUES ('acct-a','user-a','auto',false,?)`).run(T);
  const calls = { reply: [], push: [], anthropic: 0 };
  let draft = DRAFT, replyStatus = 200, pushStatus = 200;
  http.mock.resetCalls();
  http.mock.mockImplementation(async (url, init) => {
    const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    if (u.includes('anthropic.com')) { calls.anthropic++; return anthropicReply(draft); }
    if (u.endsWith('/message/reply')) { calls.reply.push(JSON.parse(init.body)); return new Response('{}', { status: replyStatus }); }
    if (u.endsWith('/message/push')) { calls.push.push(JSON.parse(init.body)); return new Response('{}', { status: pushStatus }); }
    throw new Error('Unexpected HTTP ' + u);
  });
  const pending = [];
  const ctx = { waitUntil: p => pending.push(p) };
  const webhook = async (eventId, text, replyToken = 'rt-1') => {
    const body = JSON.stringify({ destination: 'Ubot123',
      events: [{ type: 'message', replyToken, source: { type: 'user', userId: 'Ucust1' }, timestamp: time - 5000,
        webhookEventId: eventId, deliveryContext: { isRedelivery: false }, message: { id: 'm1', type: 'text', text } }] });
    const bytes = new TextEncoder().encode(body);
    const response = await lineoa.handleTenantLineWebhook(new Request(`${ORIGIN}/webhook/line/${TOKEN32}`,
      { method: 'POST', body: bytes, headers: { 'x-line-signature': await sign(bytes, SECRET) } }), env, ctx);
    await Promise.all(pending.splice(0));
    return response;
  };
  const run = () => lineoa.runQueue(DB.db, { line_reply: lineoa.makeLineReplyHandler(env) }, { maxJobs: 10, concurrency: 1 });
  const inbound = () => DB.sql.prepare("SELECT * FROM line_messages WHERE direction='in'").get();
  return { DB, env, webhook, run, inbound, calls,
    setDraft: d => { draft = d; }, setReplyStatus: s => { replyStatus = s; }, setPushStatus: s => { pushStatus = s; } };
}

test('a 1:1 text gets an LLM reply through the reply token within one cron tick', async t => {
  const s = await setup(t);
  assert.equal((await s.webhook('ev-1', 'ร้านเปิดวันไหนคะ')).status, 200);
  await s.run();
  assert.equal(s.calls.reply.length, 1);
  assert.equal(s.calls.reply[0].replyToken, 'rt-1');
  assert.equal(s.calls.reply[0].messages[0].text, DRAFT.reply);
  const row = s.inbound();
  assert.deepEqual([row.status, row.send_phase, row.reply_token, row.send_via],
    ['sent', 'sent', null, 'reply'], 'C4: the reply token is NULL once used');
  assert.ok(row.sent_at > 0);
  assert.equal(s.DB.sql.prepare("SELECT COUNT(*) AS n FROM line_messages WHERE direction='out'").get().n, 1);
  assert.equal(s.DB.sql.prepare("SELECT used FROM feature_usage WHERE user_id='user-a' AND feature_key='landing.line_autoreply'").get().used, 1);
  const job = s.DB.sql.prepare('SELECT input,status FROM jobs').get();
  assert.equal(job.status, 'done');
  assert.deepEqual(Object.keys(JSON.parse(job.input)).sort(), ['enqueueToken', 'messageId'], 'job input carries no credential');
  assert.ok(!JSON.stringify(s.calls).includes(SECRET) && !JSON.stringify(s.calls).includes('channel-token'), 'no credential leaves the server');
});

test('escalation phrases hand off instead of replying; the LLM is never called', async t => {
  const s = await setup(t);
  await s.webhook('ev-2', 'ขอคืนเงินให้หน่อยค่ะ ของมีปัญหา');
  await s.run();
  assert.equal(s.calls.anthropic, 0);
  assert.equal(s.calls.reply.length, 0);
  const row = s.inbound();
  assert.equal(row.handoff_reason, 'escalation_keyword');
  assert.equal(s.DB.sql.prepare("SELECT status FROM line_chats WHERE id=?").get(row.chat_id).status, 'needs_human');
});

test('rate limit defers the job; a changed settings revision blocks the send', async t => {
  const s = await setup(t);
  await s.webhook('ev-3', 'สวัสดีค่ะ');
  s.DB.sql.prepare('UPDATE line_chats SET window_start=?,sent_in_minute=1').run(1800000000);
  s.DB.sql.prepare('UPDATE line_settings SET rate_per_min=1 WHERE line_account_id=?').run('acct-a');
  await s.run();
  assert.equal(s.calls.anthropic, 0, 'deferred before the LLM call');
  assert.equal(s.DB.sql.prepare('SELECT status FROM jobs').get().status, 'queued');
  assert.equal(s.inbound().status, 'pending');
  // Draft mode stores the draft; a later settings change fences the send claim.
  const s2 = await setup(t);
  s2.DB.sql.prepare("UPDATE line_settings SET mode='draft' WHERE line_account_id=?").run('acct-a');
  await s2.webhook('ev-4', 'สวัสดีค่ะ');
  await s2.run();
  const msg = s2.inbound();
  assert.equal(msg.status, 'drafted');
  assert.equal(s2.calls.reply.length, 0);
  s2.DB.sql.prepare("UPDATE line_settings SET mode='auto',revision=revision+1 WHERE line_account_id=?").run('acct-a');
  assert.deepEqual(await lineoa.sendLineReply(s2.env, msg.id, 'user-a'), { status: 'drafted' });
  assert.equal(s2.calls.reply.length, 0, 'stale revision never sends');
});

test('a revoked feature skips the message mid-flight', async t => {
  const s = await setup(t);
  await s.webhook('ev-5', 'สวัสดีค่ะ');
  s.DB.sql.prepare("DELETE FROM subscriptions WHERE user_id='user-a'").run();
  await s.run();
  assert.equal(s.calls.anthropic, 0);
  assert.deepEqual([s.inbound().status, s.inbound().error], ['skipped', 'feature_revoked']);
});

test('expired reply token: no push allowed → skipped; push allowed → push; failed reply → uncertain, never retried', async t => {
  const s = await setup(t);
  await s.webhook('ev-6', 'สวัสดีค่ะ');
  s.DB.sql.prepare('UPDATE line_messages SET reply_token_until=1 WHERE direction=?').run('in');
  await s.run();
  assert.deepEqual([s.inbound().status, s.inbound().error], ['skipped', 'reply_window_expired']);
  assert.equal(s.calls.push.length, 0);
  const s2 = await setup(t);
  await s2.webhook('ev-7', 'สวัสดีค่ะ');
  s2.DB.sql.prepare('UPDATE line_messages SET reply_token_until=1 WHERE direction=?').run('in');
  s2.DB.sql.prepare('UPDATE line_settings SET allow_push=true WHERE line_account_id=?').run('acct-a');
  await s2.run();
  assert.equal(s2.calls.push.length, 1);
  assert.equal(s2.calls.push[0].to, 'Ucust1');
  assert.equal(s2.inbound().status, 'sent');
  const s3 = await setup(t);
  s3.setReplyStatus(500);
  await s3.webhook('ev-8', 'สวัสดีค่ะ');
  await s3.run();
  assert.equal(s3.calls.reply.length, 1);
  assert.deepEqual([s3.inbound().status, s3.inbound().send_phase], ['failed', 'uncertain']);
  assert.equal(s3.DB.sql.prepare("SELECT status FROM line_chats WHERE external_chat_id='Ucust1'").get().status, 'needs_human');
  await s3.run();
  assert.equal(s3.calls.reply.length, 1, 'an uncertain send is never retried automatically');
  assert.equal(s3.DB.sql.prepare('SELECT status FROM jobs').get().status, 'done');
});

test('trial is capped at 50 replies a month; business is unlimited (NAK-18 C5)', async t => {
  const s = await setup(t);
  const nowS = Math.floor(Date.now() / 1000);
  s.DB.sql.exec(`INSERT INTO users (id, created_at) VALUES ('trial-1', ${nowS - 60});`);
  const trial = (await lineoa.memberFeatures(s.env, 'trial-1')).find(f => f.key === 'landing.line_autoreply');
  assert.equal(trial.monthlyLimit, 50);
  assert.equal((await lineoa.memberFeatures(s.env, 'user-a')).find(f => f.key === 'landing.line_autoreply').monthlyLimit, null);
  for (let i = 0; i < 50; i++) assert.equal((await lineoa.useFeature(s.env, 'trial-1', 'landing.line_autoreply')).ok, true);
  const refused = await lineoa.useFeature(s.env, 'trial-1', 'landing.line_autoreply');
  assert.deepEqual([refused.ok, refused.reason], [false, 'quota']);
});
