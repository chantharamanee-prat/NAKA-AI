import type { Env } from '../types';
import { decryptToken } from '../social/crypto';
import { getBotInfo } from '../line';
import { lineContext } from '../social/crypto';
import { lineExternalKey, lineId, now, record, REPLY_TOKEN_TTL, type LineAccount, type LineChat } from './common';

export interface LineEvent {
  channelId: string; webhookEventId: string; destination: string; kind: 'user' | 'group' | 'room';
  externalChatId: string; senderId: string; customerName: string; eventType: string;
  body: string; messageType: string; addressed: boolean; replyToken: string | null;
  time: number; redelivery: boolean;
}

function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return 0;
  const seconds = Math.floor(value / 1000);
  return seconds > now() + 60 ? 0 : Math.min(seconds, now());
}

/** Is this group/room message addressed to our OA (Stage 4 decides the reply; storage already marks it)? */
export function groupAddressed(message: Record<string, any>, destination: string, groupMode: string, prefix: string): boolean {
  if (groupMode === 'off') return false;
  const mentionees = Array.isArray(message?.mention?.mentionees) ? message.mention.mentionees : [];
  // `isSelf` is only present on newer payloads, and a mentionee can lack `userId` when the
  // mentioned user has not added the OA — belt and braces, because the failure mode is spam.
  if (mentionees.some((m: any) => m?.isSelf === true)) return true;
  if (destination && mentionees.some((m: any) => typeof m?.userId === 'string' && m.userId === destination)) return true;
  if (groupMode === 'mention_or_prefix' && prefix && typeof message?.text === 'string' &&
      message.text.trimStart().toLowerCase().startsWith(prefix.toLowerCase())) return true;
  return false;
}

// Payloads checked against the LINE Messaging API webhook reference; unsupported events are ignored.
export function normalizeLineEvents(payload: unknown, group: { groupMode: string; prefix: string } = { groupMode: 'mention', prefix: '' }): LineEvent[] {
  if (!record(payload) || typeof payload.destination !== 'string' || !Array.isArray(payload.events)) return [];
  const destination = payload.destination;
  const events: LineEvent[] = [];
  for (const raw of payload.events) {
    if (!record(raw) || typeof raw.type !== 'string' || !record(raw.source) || typeof raw.source.type !== 'string') continue;
    const kind = raw.source.type;
    if (kind !== 'user' && kind !== 'group' && kind !== 'room') continue;
    const externalChatId = kind === 'user' ? raw.source.userId : kind === 'group' ? raw.source.groupId : raw.source.roomId;
    if (!lineId(externalChatId)) continue;
    const webhookEventId = typeof raw.webhookEventId === 'string' && /^[A-Za-z0-9-]{1,128}$/.test(raw.webhookEventId) ? raw.webhookEventId : null;
    if (!webhookEventId) continue;
    const senderId = typeof raw.source.userId === 'string' && lineId(raw.source.userId) ? raw.source.userId : '';
    const time = timestamp(raw.timestamp);
    const redelivery = record(raw.deliveryContext) && raw.deliveryContext.isRedelivery === true;
    if (raw.type === 'message') {
      const message = record(raw.message) ? raw.message : {};
      const messageType = typeof message.type === 'string' ? message.type : '';
      const text = messageType === 'text' && typeof message.text === 'string' ? message.text.slice(0, 5000) : '';
      const addressed = kind === 'user' ? true : groupAddressed(message, destination, group.groupMode, group.prefix);
      events.push({ channelId: '', webhookEventId, destination, kind, externalChatId, senderId,
        customerName: '', eventType: 'message', body: text, messageType: messageType || 'unknown',
        addressed, replyToken: typeof raw.replyToken === 'string' && raw.replyToken ? raw.replyToken : null,
        time, redelivery });
      continue;
    }
    if (['follow', 'unfollow', 'join', 'leave', 'memberJoined', 'memberLeft'].includes(raw.type)) {
      events.push({ channelId: '', webhookEventId, destination, kind, externalChatId, senderId,
        customerName: '', eventType: raw.type, body: '', messageType: 'event',
        addressed: false, replyToken: typeof raw.replyToken === 'string' && raw.replyToken ? raw.replyToken : null,
        time, redelivery });
      continue;
    }
    // postback, beacon, unsend, videoPlayComplete and everything else: ignored.
  }
  return events;
}

async function storeEvent(env: Env, account: LineAccount, event: LineEvent): Promise<string | null> {
  const key = lineExternalKey(account.channel_id, event.webhookEventId);
  if (await env.DB.prepare('SELECT id FROM line_messages WHERE external_id=?').bind(key).first()) return null;
  const messageAt = event.time || now();
  let chat = await env.DB.prepare('SELECT * FROM line_chats WHERE line_account_id=? AND kind=? AND external_chat_id=?')
    .bind(account.id, event.kind, event.externalChatId).first<LineChat>();
  if (!chat) {
    const id = crypto.randomUUID();
    await env.DB.prepare(`INSERT OR IGNORE INTO line_chats
      (id,line_account_id,user_id,kind,external_chat_id,status,last_message_at,last_customer_at)
      VALUES (?,?,?, ?,?, 'open', ?, ?)`).bind(id, account.id, account.user_id, event.kind, event.externalChatId, messageAt, messageAt).run();
    chat = await env.DB.prepare('SELECT * FROM line_chats WHERE id=?').bind(id).first<LineChat>();
    if (!chat) return 'storage_retry';
  }
  if ((event.eventType === 'unfollow' || event.eventType === 'leave' || event.eventType === 'memberLeft') && chat.status !== 'closed') {
    await env.DB.prepare("UPDATE line_chats SET status='closed',revision=revision+1 WHERE id=? AND user_id=?").bind(chat.id, account.user_id).run();
  } else if ((event.eventType === 'follow' || event.eventType === 'join') && chat.status === 'closed') {
    await env.DB.prepare("UPDATE line_chats SET status='open',auto_paused=0,revision=revision+1 WHERE id=? AND user_id=?").bind(chat.id, account.user_id).run();
  }
  // Non-text 1:1 messages (usually payment slips) hand off, like the legacy bot does.
  const nonText = event.eventType === 'message' && event.kind === 'user' && event.messageType !== 'text';
  const notAddressed = event.eventType === 'message' && !event.addressed;
  const status = event.eventType === 'message' && event.addressed && event.kind === 'user'
    ? nonText ? 'drafted' : 'pending'
    : 'skipped';
  const handoff = nonText ? 'attachment_requires_human' : null;
  const error = notAddressed ? 'not_addressed' : nonText ? 'attachment_requires_human' : null;
  const id = crypto.randomUUID();
  const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO line_messages
    (id,chat_id,user_id,direction,external_id,event_type,body,message_type,sender_id,addressed,status,
     handoff_reason,reply_token,reply_token_until,created_at,message_at,error)
    VALUES (?,?,?,'in',?,?,?,?,?, (? = 1),?, ?,?, ?, ?,?, ?)`)
    .bind(id, chat.id, account.user_id, key, event.eventType, event.body, event.messageType,
      event.addressed && event.senderId ? event.senderId : null,
      event.addressed ? 1 : 0, status, handoff,
      // C4: the reply token is a credential — only a 1:1/group message can spend one, and the send
      // claim NULLs it. follow/join tokens would linger unused, so they are never stored.
      event.eventType === 'message' ? event.replyToken : null,
      event.replyToken && event.eventType === 'message' ? messageAt + REPLY_TOKEN_TTL : null,
      now(), messageAt, error).run();
  if (!inserted.meta.changes) return null;
  await env.DB.prepare(`UPDATE line_chats SET last_message_at=GREATEST(last_message_at,?),revision=revision+1,
    last_inbound_id=CASE WHEN ?>=last_customer_at THEN ? ELSE last_inbound_id END,
    last_customer_at=GREATEST(last_customer_at,?)
    WHERE id=?`).bind(messageAt, messageAt, id, messageAt, chat.id).run();
  if (nonText) await env.DB.prepare("UPDATE line_chats SET status='needs_human',auto_paused=1,revision=revision+1 WHERE id=? AND user_id=?")
    .bind(chat.id, account.user_id).run();
  return null;
}

export async function processLineReceipts(env: Env, maxReceipts = 5): Promise<number> {
  let processed = 0;
  for (let i = 0; i < maxReceipts; i++) {
    const lease = crypto.randomUUID();
    const row = await env.DB.prepare(`UPDATE line_webhook_receipts SET lease_id=?,lease_until=? WHERE id=(
      SELECT id FROM line_webhook_receipts WHERE status='pending' AND (lease_until IS NULL OR lease_until<=?) ORDER BY created_at,id LIMIT 1)
      AND status='pending' AND (lease_until IS NULL OR lease_until<=?) RETURNING id,line_account_id,body,cursor`)
      .bind(lease, now() + 60, now(), now()).first<{ id: string; line_account_id: string; body: string; cursor: number }>();
    if (!row) break;
    try {
      const account = await env.DB.prepare(`SELECT a.* FROM line_accounts a JOIN users u ON u.id=a.user_id
        WHERE a.id=? AND a.status='active' AND u.status='active'`).bind(row.line_account_id).first<LineAccount>();
      if (!account) {
        await env.DB.prepare('UPDATE line_webhook_receipts SET status=?,body=?,lease_id=NULL,lease_until=NULL WHERE id=? AND lease_id=?')
          .bind('done', '', row.id, lease).run();
        processed++;
        continue;
      }
      const settings = await env.DB.prepare('SELECT group_mode,keyword_prefix FROM line_settings WHERE line_account_id=? AND user_id=?')
        .bind(account.id, account.user_id).first<{ group_mode: string; keyword_prefix: string }>();
      const groupMode = settings?.group_mode ?? 'mention';
      const prefix = settings?.keyword_prefix ?? '';
      const parsed: unknown = JSON.parse(row.body);
      // normalizeLineEvents takes this account's group settings; the receipt belongs to one account.
      const events = normalizeLineEvents(record(parsed) ? parsed : {}, { groupMode, prefix });
      const end = Math.min(events.length, row.cursor + 20);
      for (let cursor = row.cursor; cursor < end; cursor++) {
        const skipped = await storeEvent(env, { ...account, channel_id: account.channel_id }, withChannel(events[cursor], account));
        const updated = await env.DB.prepare(`UPDATE line_webhook_receipts SET cursor=?,skipped=skipped+?,error=COALESCE(?,error)
          WHERE id=? AND lease_id=? RETURNING id`).bind(cursor + 1, skipped ? 1 : 0, skipped, row.id, lease).first();
        if (!updated) break;
      }
      await env.DB.prepare(`UPDATE line_webhook_receipts SET status=?,body=CASE WHEN ?=1 THEN '' ELSE body END,
        lease_id=NULL,lease_until=NULL,error=CASE WHEN ?=1 THEN 'unsupported_event' ELSE error END WHERE id=? AND lease_id=?`)
        .bind(end === events.length ? 'done' : 'pending', end === events.length ? 1 : 0, events.length === 0 ? 1 : 0, row.id, lease).run();
      processed++;
    } catch {
      await env.DB.prepare("UPDATE line_webhook_receipts SET error='storage_retry',lease_id=NULL,lease_until=? WHERE id=? AND lease_id=?")
        .bind(now() + 60, row.id, lease).run();
    }
  }
  return processed;
}

function withChannel(event: LineEvent, account: LineAccount): LineEvent {
  return { ...event, channelId: account.channel_id };
}

/** Re-check the stored destination against a live LINE call (C2-safe: read-only, never changes status). */
export async function refreshDestination(env: Env, account: LineAccount): Promise<void> {
  try {
    const token = await decryptToken(env, account.token_enc, lineContext(account.user_id, account.channel_id));
    const info = await getBotInfo(token);
    if (info && info.userId !== account.destination) {
      await env.DB.prepare('UPDATE line_accounts SET destination=?,updated_at=? WHERE id=? AND user_id=?')
        .bind(info.userId, now(), account.id, account.user_id).run();
    }
  } catch { /* best effort; the webhook's own destination check stays authoritative */ }
}
