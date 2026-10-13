import type { Env } from '../types';
import { encryptToken, lineContext } from '../social/crypto';
import { getBotInfo, verifyChannelToken } from '../line';
import { appOrigin, json, LineOaError, now, pauseLineChat, readJson } from './common';
export { LINE_JOB_KIND } from './common';
export { makeLineReplyHandler } from './reply';
export { handleTenantLineWebhook } from './webhook';
export { drainLine } from './queue';

const SECRET_RE = /^[0-9a-f]{32}$/i;

const hexToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');

const chatFields = `id,kind,customer_name AS customerName,status,last_message_at AS lastMessageAt,auto_paused AS autoPaused`;

async function route(request: Request, env: Env, url: URL, userId: string): Promise<Response> {
  const path = url.pathname.slice('/api/line'.length);
  const account = path.match(/^\/accounts\/([\w-]+)(\/rotate|\/settings)?$/);
  const chats = path.match(/^\/chats(?:\/([\w-]+)(\/handoff|\/resume)?)?$/);
  const allowed = path === '/accounts' ? 'GET, POST'
    : account ? (account[2] === '/settings' ? 'GET, PUT' : account[2] === '/rotate' ? 'POST' : 'GET, DELETE')
    : chats ? (chats[1] ? (chats[2] ? 'POST' : 'GET') : 'GET')
    : '';
  if (!allowed) throw new LineOaError(404, 'ไม่พบเส้นทาง');
  if (!allowed.split(', ').includes(request.method)) return json({ error: 'วิธีเรียกใช้งานไม่ถูกต้อง' }, 405, { Allow: allowed });

  if (path === '/accounts' && request.method === 'GET') {
    const rows = await env.DB.prepare(`SELECT id,channel_id AS channelId,destination,name,status,last_error AS lastError,
      last_event_at AS lastEventAt,created_at AS createdAt FROM line_accounts WHERE user_id=? ORDER BY created_at,id LIMIT 20`)
      .bind(userId).all();
    return json({ accounts: rows.results });
  }
  if (path === '/accounts' && request.method === 'POST') {
    const body = await readJson(request, 8192);
    const secret = typeof body.channelSecret === 'string' ? body.channelSecret.trim() : '';
    const token = typeof body.channelAccessToken === 'string' ? body.channelAccessToken.trim() : '';
    if (!SECRET_RE.test(secret)) throw new LineOaError(400, 'Channel Secret ต้องเป็นเลขฐาน 16 ยาว 32 ตัวอักษร');
    if (token.length < 10 || token.length > 2000 || /[\u0000-\u001f\u007f]/.test(token)) throw new LineOaError(400, 'Channel Access Token ไม่ถูกต้อง');
    // C1: the token proves ownership — channel_id comes from LINE's OAuth verify (the token's
    // client_id, digits), destination/name from bot/info. basicId is NOT the channel id (it is the
    // @-prefixed public id and can change), and nothing identity-related comes from member input,
    // so nobody can squat another OA's row and block the real owner via UNIQUE(channel_id).
    const [verified, info] = await Promise.all([verifyChannelToken(token), getBotInfo(token)]);
    if (!verified || !info) throw new LineOaError(400, 'ยืนยันกับ LINE ไม่สำเร็จ กรุณาตรวจสอบ Channel Access Token');
    const channelId = verified.channelId;
    const secretEnc = await encryptToken(env, secret, lineContext(userId, channelId));
    const tokenEnc = await encryptToken(env, token, lineContext(userId, channelId));
    const existing = await env.DB.prepare('SELECT id,user_id FROM line_accounts WHERE channel_id=?')
      .bind(channelId).first<{ id: string; user_id: string }>();
    if (existing && existing.user_id !== userId) throw new LineOaError(409, 'LINE OA นี้ถูกเชื่อมต่อแล้ว');
    if (existing) {
      // Same member, fresh credentials (rotated on the LINE side): update in place, keep chats and history.
      await env.DB.prepare(`UPDATE line_accounts SET secret_enc=?,token_enc=?,destination=?,name=?,
        status='active',last_error=NULL,updated_at=? WHERE id=? AND user_id=?`)
        .bind(secretEnc, tokenEnc, info.userId, info.displayName.slice(0, 200), now(), existing.id, userId).run();
      const webhookToken = (await env.DB.prepare('SELECT webhook_token FROM line_accounts WHERE id=?')
        .bind(existing.id).first<{ webhook_token: string }>())!.webhook_token;
      return json({ id: existing.id, channelId, name: info.displayName.slice(0, 200), reconnected: true,
        webhookUrl: `${appOrigin(env).origin}/webhook/line/${webhookToken}` });
    }
    const id = crypto.randomUUID();
    const webhookToken = hexToken();
    try {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO line_accounts
          (id,user_id,channel_id,destination,name,secret_enc,token_enc,webhook_token,created_at,updated_at)
          VALUES (?,?,?,?, ?,?,?,?, ?,?)`)
          .bind(id, userId, channelId, info.userId, info.displayName.slice(0, 200), secretEnc, tokenEnc,
            webhookToken, now(), now()),
        env.DB.prepare('INSERT INTO line_settings (line_account_id,user_id,updated_at) VALUES (?,?,?)')
          .bind(id, userId, now()),
      ]);
    } catch {
      // Lost a race with another connect for the same OA: whoever owns it keeps it, and the loser
      // learns nothing about whose it is. Anything else (DB down) must surface, not masquerade as 409.
      const raced = await env.DB.prepare('SELECT id,user_id FROM line_accounts WHERE channel_id=?')
        .bind(channelId).first<{ id: string; user_id: string }>();
      if (!raced) throw new LineOaError(503, 'เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่');
      if (raced.user_id !== userId) throw new LineOaError(409, 'LINE OA นี้ถูกเชื่อมต่อแล้ว');
      return json({ id: raced.id, channelId, reconnected: true,
        webhookUrl: `${appOrigin(env).origin}/webhook/line/${(await env.DB.prepare(
          'SELECT webhook_token FROM line_accounts WHERE id=?').bind(raced.id).first<{ webhook_token: string }>())!.webhook_token}` });
    }
    return json({ id, channelId, name: info.displayName.slice(0, 200),
      webhookUrl: `${appOrigin(env).origin}/webhook/line/${webhookToken}` }, 201);
  }
  if (account) {
    const found = await env.DB.prepare('SELECT id,channel_id,destination,name,status FROM line_accounts WHERE id=? AND user_id=?')
      .bind(account[1], userId).first<{ id: string; channel_id: string; destination: string | null; name: string; status: string }>();
    if (!found) throw new LineOaError(404, 'ไม่พบบัญชี LINE OA');
    if (account[2] === '/rotate' && request.method === 'POST') {
      const webhookToken = hexToken();
      await env.DB.prepare('UPDATE line_accounts SET webhook_token=?,updated_at=? WHERE id=? AND user_id=?')
        .bind(webhookToken, now(), found.id, userId).run();
      return json({ webhookUrl: `${appOrigin(env).origin}/webhook/line/${webhookToken}` });
    }
    if (account[2] === '/settings') {
      if (request.method === 'GET') {
        const settings = await env.DB.prepare(`SELECT mode,group_mode AS groupMode,keyword_prefix AS keywordPrefix,persona,
          llm_config_id AS llmConfigId,llm_config_label AS llmConfigLabel,kb_source AS kbSource,history_turns AS historyTurns,
          reply_language AS replyLanguage,allow_push AS allowPush,rate_per_min AS ratePerMin,rate_per_hour AS ratePerHour
          FROM line_settings WHERE line_account_id=? AND user_id=?`).bind(found.id, userId).first();
        return json(settings ?? { mode: 'off' });
      }
      const body = await readJson(request, 8192);
      const str = (v: unknown) => typeof v === 'string' ? v : null;
      const mode = str(body.mode), groupMode = str(body.group_mode), kbSource = str(body.kb_source), replyLanguage = str(body.reply_language);
      const prefix = str(body.keyword_prefix), persona = str(body.persona);
      const num = (v: unknown) => typeof v === 'number' && Number.isInteger(v) ? v : null;
      const historyTurns = body.history_turns === undefined ? null : num(body.history_turns);
      const rateMin = body.rate_per_min === undefined ? null : num(body.rate_per_min);
      const rateHour = body.rate_per_hour === undefined ? null : num(body.rate_per_hour);
      const allowPush = body.allow_push === undefined ? null : body.allow_push === true ? 1 : body.allow_push === false ? 0 : null;
      const llmConfigId = body.llm_config_id === undefined || body.llm_config_id === null ? null : num(body.llm_config_id);
      if ((mode !== null && !['off', 'draft', 'auto'].includes(mode)) ||
          (groupMode !== null && !['off', 'mention', 'mention_or_prefix'].includes(groupMode)) ||
          (kbSource !== null && !['none', 'inbox_kb'].includes(kbSource)) ||
          (replyLanguage !== null && !['auto', 'th'].includes(replyLanguage)) ||
          (prefix !== null && prefix.length > 40) || (persona !== null && persona.length > 4000) ||
          (historyTurns !== null && (historyTurns < 0 || historyTurns > 20)) ||
          (rateMin !== null && (rateMin < 1 || rateMin > 30)) || (rateHour !== null && (rateHour < 1 || rateHour > 600)) ||
          (body.allow_push !== undefined && allowPush === null) ||
          (body.llm_config_id !== undefined && body.llm_config_id !== null && llmConfigId === null))
        throw new LineOaError(400, 'ตรวจสอบการตั้งค่า โหมด คำสั่ง และขีดจำกัดการตอบ');
      const set: string[] = [], vals: unknown[] = [];
      const put = (col: string, v: unknown) => { if (v !== null && v !== undefined) { set.push(`line_settings.${col}=?`); vals.push(v); } };
      put('mode', mode); put('group_mode', groupMode); put('keyword_prefix', prefix); put('persona', persona);
      put('kb_source', kbSource); put('history_turns', historyTurns); put('reply_language', replyLanguage);
      put('rate_per_min', rateMin); put('rate_per_hour', rateHour);
      // allow_push is a boolean column: the adapter binds numbers as ::bigint, so compare to 1
      // instead of writing the integer straight into it (same pattern as addressed in events.ts).
      if (allowPush !== null && allowPush !== undefined) { set.push('line_settings.allow_push=(? = 1)'); vals.push(allowPush); }
      if (body.llm_config_id !== undefined) { set.push('line_settings.llm_config_id=?'); vals.push(llmConfigId); }
      if (!set.length) throw new LineOaError(400, 'ไม่มีค่าที่ต้องการเปลี่ยน');
      set.push('line_settings.revision=line_settings.revision+1', 'line_settings.updated_at=?'); vals.push(now());
      // Qualify the updated columns: the D1-on-Postgres adapter needs it in ON CONFLICT DO UPDATE.
      await env.DB.prepare(`INSERT INTO line_settings (line_account_id,user_id,updated_at) VALUES (?,?,?)
        ON CONFLICT(line_account_id) DO UPDATE SET ${set.join(',')}`)
        .bind(found.id, userId, now(), ...vals).run();
      return json({ ok: true });
    }
    if (request.method === 'GET') {
      // The member pastes this URL into the LINE Developers console, so the detail view must return
      // the real one (member session only). Forging a webhook still needs the channel secret for the
      // HMAC, which never leaves the server.
      const webhookToken = (await env.DB.prepare('SELECT webhook_token FROM line_accounts WHERE id=?')
        .bind(found.id).first<{ webhook_token: string }>())!.webhook_token;
      return json({ id: found.id, channelId: found.channel_id, name: found.name, status: found.status,
        webhookUrl: `${appOrigin(env).origin}/webhook/line/${webhookToken}` });
    }
    // C3: disconnect wipes the credentials — the row (and its chats, settings, receipts) goes away together.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM line_webhook_receipts WHERE line_account_id=?').bind(found.id),
      env.DB.prepare('DELETE FROM line_accounts WHERE id=? AND user_id=?').bind(found.id, userId),
    ]);
    return new Response(null, { status: 204 });
  }
  if (chats && !chats[1]) {
    const status = url.searchParams.get('status');
    if (status && !['open', 'needs_human', 'closed'].includes(status)) throw new LineOaError(400, 'สถานะไม่ถูกต้อง');
    const rows = await env.DB.prepare(`SELECT ${chatFields} FROM line_chats WHERE user_id=? AND (?::text IS NULL OR status=?)
      ORDER BY last_message_at DESC,id LIMIT 100`).bind(userId, status, status).all();
    return json({ chats: rows.results });
  }
  if (chats && chats[1] && !chats[2]) {
    const found = await env.DB.prepare(`SELECT ${chatFields} FROM line_chats WHERE id=? AND user_id=?`).bind(chats[1], userId).first();
    if (!found) throw new LineOaError(404, 'ไม่พบบทสนทนา');
    const messages = await env.DB.prepare(`SELECT id,direction,body,draft,confidence,handoff_reason AS handoffReason,status,
      sent_at AS sentAt,created_at AS createdAt,message_at AS messageAt,
      CASE WHEN send_phase IN ('sending','uncertain') THEN 'กรุณาตรวจสอบผลการส่งบน LINE ก่อนส่งใหม่'
      WHEN status='failed' THEN 'ดำเนินการไม่สำเร็จ กรุณาให้ทีมงานช่วยตรวจสอบ' ELSE NULL END AS error
      FROM line_messages WHERE chat_id=? AND user_id=? ORDER BY created_at DESC,id DESC LIMIT 100`).bind(chats[1], userId).all();
    return json({ chat: found, messages: messages.results.reverse() });
  }
  if (chats && chats[1] && chats[2]) {
    const found = await env.DB.prepare('SELECT id FROM line_chats WHERE id=? AND user_id=?').bind(chats[1], userId).first();
    if (!found) throw new LineOaError(404, 'ไม่พบบทสนทนา');
    if (chats[2] === '/handoff') { await pauseLineChat(env, chats[1], userId); return json({ status: 'needs_human' }); }
    // Resume reopens a paused chat; a closed chat (unfollow/leave) stays closed until the customer returns.
    const reopened = await env.DB.prepare(`UPDATE line_chats SET status='open',auto_paused=0,revision=revision+1
      WHERE id=? AND user_id=? AND status!='closed' RETURNING id`).bind(chats[1], userId).first();
    if (!reopened) throw new LineOaError(409, 'บทสนทนานี้ปิดแล้ว');
    return json({ status: 'open' });
  }
  throw new LineOaError(404, 'ไม่พบเส้นทาง');
}

export async function handleLineOa(request: Request, env: Env, url: URL, userId: string): Promise<Response | null> {
  if (url.pathname !== '/api/line' && !url.pathname.startsWith('/api/line/')) return null;
  let response: Response;
  try {
    if (!userId) throw new LineOaError(401, 'กรุณาเข้าสู่ระบบ');
    const origin = appOrigin(env).origin;
    if (url.origin !== origin || new URL(request.url).origin !== origin) throw new LineOaError(403, 'กรุณาใช้งานผ่านเว็บไซต์หลัก');
    if (['POST', 'PUT', 'DELETE'].includes(request.method) && (request.headers.get('Origin') !== origin || request.headers.get('Sec-Fetch-Site') === 'cross-site'))
      throw new LineOaError(403, 'คำขอไม่ถูกต้อง กรุณาลองจากเว็บไซต์');
    response = await route(request, env, url, userId);
  } catch (error) { response = json({ error: error instanceof LineOaError ? error.message : 'ระบบ LINE OA ขัดข้อง กรุณาลองใหม่ภายหลัง' }, error instanceof LineOaError ? error.status : 500); }
  response.headers.set('Cache-Control', 'no-store'); response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
