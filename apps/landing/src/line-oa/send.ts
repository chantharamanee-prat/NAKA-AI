import type { Env } from '../types';
import { decryptToken, lineContext } from '../social/crypto';
import { LineOaError, now, type LineAccount, type LineChat, type LineMessage, type LineSettings } from './common';
import { publicSafe, validReply } from '../inbox/policy';

const LINE_API = 'https://api.line.me/v2/bot';
const MAX_TEXT = 5000; // LINE limit per text message

function toMessages(text: string) {
  const chunks: string[] = [];
  for (let i = 0; i < text.length && chunks.length < 5; i += MAX_TEXT) chunks.push(text.slice(i, i + MAX_TEXT));
  return chunks.map((t) => ({ type: 'text', text: t }));
}

async function postLine(token: string, path: '/message/reply' | '/message/push', payload: unknown): Promise<number | null> {
  try {
    const res = await fetch(`${LINE_API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    // Status only: LINE error bodies can echo customer text, so they are never logged.
    return res.ok ? 200 : res.status;
  } catch {
    return null; // network failure: the send may still have landed — the outcome is uncertain
  }
}

/**
 * Send one drafted 1:1 reply through the tenant OA. The claim is a single conditional
 * UPDATE … RETURNING (§2.7): it re-checks the chat revision, the settings revision and the
 * stored token, and it enforces the per-chat rate limit in the same statement. After the
 * claim an uncertain outcome is never retried automatically — the message goes
 * send_phase='uncertain' and the chat goes needs_human.
 */
export async function sendLineReply(env: Env, messageId: string, userId: string): Promise<{ status: string }> {
  const message = await env.DB.prepare("SELECT * FROM line_messages WHERE id=? AND user_id=? AND direction='in'")
    .bind(messageId, userId).first<LineMessage>();
  if (!message) throw new LineOaError(404, 'ไม่พบข้อความ');
  if (message.status === 'sent') return { status: 'sent' }; // repeated handling is harmless
  if (message.status !== 'drafted' || message.send_phase !== 'ready') throw new LineOaError(409, 'ข้อความนี้ยังไม่พร้อมส่งหรือส่งไปแล้ว');
  const chat = await env.DB.prepare('SELECT * FROM line_chats WHERE id=? AND user_id=?').bind(message.chat_id, userId).first<LineChat>();
  if (!chat || chat.status === 'closed') throw new LineOaError(409, 'บทสนทนานี้ปิดแล้ว');
  if (chat.kind !== 'user') return { status: 'drafted' }; // Stage 2 answers 1:1 only; Stage 4 sends the rest
  const account = await env.DB.prepare(`SELECT a.* FROM line_accounts a JOIN users u ON u.id=a.user_id
    WHERE a.id=? AND a.user_id=? AND a.status='active' AND u.status='active'`)
    .bind(chat.line_account_id, userId).first<LineAccount>();
  if (!account) throw new LineOaError(409, 'กรุณาเชื่อมต่อ LINE OA ใหม่');
  const settings = await env.DB.prepare('SELECT * FROM line_settings WHERE line_account_id=? AND user_id=?')
    .bind(account.id, userId).first<LineSettings>();
  const reply = message.draft;
  if (!validReply(reply)) throw new LineOaError(400, 'กรุณาระบุคำตอบไม่เกิน 1,000 ไบต์');
  if (chat.kind !== 'user' && !publicSafe(reply)) throw new LineOaError(400, 'ข้อความกลุ่มห้ามมีข้อมูลส่วนตัว');
  // Reply token usable, or push allowed — otherwise the window is gone and the message stays unanswered, not wrong.
  // (A missing settings row fails the claim below, which requires mode='auto'.)
  const viaReply = !!message.reply_token && (message.reply_token_until ?? 0) > now();
  const via: 'reply' | 'push' | null = viaReply ? 'reply'
    : (settings && settings.allow_push && chat.status === 'open' ? 'push' : null);
  if (!via) {
    await env.DB.prepare("UPDATE line_messages SET status='skipped',error='reply_window_expired' WHERE id=? AND user_id=? AND send_phase='ready'")
      .bind(message.id, userId).run();
    return { status: 'skipped' };
  }
  const token = await decryptToken(env, account.token_enc, lineContext(userId, account.channel_id));
  const minuteStart = now() - (now() % 60);
  const hourStart = now() - (now() % 3600);
  const rateMin = settings?.rate_per_min ?? 4;
  const rateHour = settings?.rate_per_hour ?? 60;
  // C4: the reply token is a credential — NULL it at the claim whether we use it or not.
  const claimed = await env.DB.prepare(`WITH chat AS (
      UPDATE line_chats SET
        window_start=CASE WHEN window_start<? THEN ? ELSE window_start END,
        sent_in_minute=CASE WHEN window_start<? THEN 1 ELSE sent_in_minute+1 END,
        hour_start=CASE WHEN hour_start<? THEN ? ELSE hour_start END,
        sent_in_hour=CASE WHEN hour_start<? THEN 1 ELSE sent_in_hour+1 END
      WHERE id=? AND status='open' AND auto_paused=0 AND revision=? AND last_inbound_id=?
        AND (CASE WHEN window_start<? THEN 0 ELSE sent_in_minute END)<?
        AND (CASE WHEN hour_start<? THEN 0 ELSE sent_in_hour END)<?
      RETURNING id)
    UPDATE line_messages SET send_phase='sending',send_started_at=?,send_via=?,reply_token=NULL
    WHERE id=? AND user_id=? AND status='drafted' AND send_phase='ready'
    AND EXISTS(SELECT 1 FROM chat)
    AND EXISTS(SELECT 1 FROM line_accounts WHERE id=? AND status='active' AND token_enc=?)
    AND EXISTS(SELECT 1 FROM line_settings WHERE line_account_id=? AND mode='auto' AND revision=?)
    RETURNING id`)
    .bind(minuteStart, minuteStart, minuteStart, hourStart, hourStart, hourStart,
      chat.id, message.chat_revision, message.id, minuteStart, rateMin, hourStart, rateHour,
      now(), via, message.id, userId, account.id, account.token_enc, account.id, message.settings_revision).first();
  if (!claimed) return { status: 'drafted' };
  const payload = via === 'reply'
    ? { replyToken: message.reply_token, messages: toMessages(reply.trim()) }
    : { to: chat.external_chat_id, messages: toMessages(reply.trim()) };
  let outcome = await postLine(token, via === 'reply' ? '/message/reply' : '/message/push', payload);
  // A refused reply (e.g. token already used) may still go out as a push when the member allows it.
  if (via === 'reply' && outcome !== 200 && outcome !== 429 && outcome !== null && (outcome < 500 || outcome >= 600) &&
      settings?.allow_push && chat.status === 'open') {
    outcome = await postLine(token, '/message/push', { to: chat.external_chat_id, messages: toMessages(reply.trim()) });
    if (outcome === 200) await env.DB.prepare("UPDATE line_messages SET send_via='push' WHERE id=? AND send_phase='sending'").bind(message.id).run();
  }
  if (outcome === 200) {
    const key = `line:${account.channel_id}:out:${message.id}`;
    await env.DB.batch([
      env.DB.prepare("UPDATE line_messages SET status='sent',send_phase='sent',sent_at=?,error=NULL WHERE id=? AND send_phase='sending'")
        .bind(now(), message.id),
      env.DB.prepare(`INSERT OR IGNORE INTO line_messages
        (id,chat_id,user_id,direction,external_id,event_type,body,message_type,status,sent_at,created_at,message_at,send_phase)
        VALUES (?,?,?,'out',?,'message',?,'text','sent',?,?,?,'sent')`)
        .bind(crypto.randomUUID(), chat.id, userId, key, reply.trim(), now(), now(), now()),
      env.DB.prepare('UPDATE line_chats SET last_message_at=GREATEST(last_message_at,?) WHERE id=? AND user_id=?').bind(now(), chat.id, userId),
    ]);
    return { status: 'sent' };
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE line_messages SET status='failed',send_phase='uncertain',error='send_outcome_unknown' WHERE id=? AND send_phase='sending'").bind(message.id),
    env.DB.prepare("UPDATE line_chats SET status='needs_human',auto_paused=1,revision=revision+1 WHERE id=? AND user_id=?").bind(chat.id, userId),
  ]);
  throw new LineOaError(502, 'ยังยืนยันผลการส่งไม่ได้ กรุณาตรวจสอบบทสนทนาบน LINE ก่อนส่งใหม่');
}
