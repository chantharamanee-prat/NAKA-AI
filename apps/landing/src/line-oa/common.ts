import type { Env } from '../types';
export { appOrigin, AuthError as LineOaError, constantTimeEqual, json, now, readJson, sha256 } from '../auth/common';
import { AuthError, now } from '../auth/common';

export const LINE_JOB_KIND = 'line_reply';
export const LINE_FEATURE_KEY = 'landing.line_autoreply' as const;
export const LINE_PRICE_KEY = 'landing.line_autoreply' as const;
/** LINE only guarantees a reply token for about a minute; we stop trusting it after 50s. */
export const REPLY_TOKEN_TTL = 50;

export interface LineAccount {
  id: string; user_id: string; channel_id: string; destination: string | null; name: string;
  secret_enc: string; token_enc: string; webhook_token: string;
  status: 'active' | 'paused' | 'error' | 'revoked'; last_error: string | null; last_event_at: number | null;
}

export interface LineSettings {
  line_account_id: string; user_id: string; mode: 'off' | 'draft' | 'auto';
  group_mode: 'off' | 'mention' | 'mention_or_prefix'; keyword_prefix: string; persona: string;
  llm_config_id: number | null; llm_config_label: string; kb_source: 'none' | 'inbox_kb';
  history_turns: number; reply_language: 'auto' | 'th'; allow_push: number; rate_per_min: number;
  rate_per_hour: number; revision: number; updated_at: number;
}

export interface LineChat {
  id: string; line_account_id: string; user_id: string; kind: 'user' | 'group' | 'room';
  external_chat_id: string; customer_name: string; status: 'open' | 'needs_human' | 'closed';
  auto_paused: number; revision: number; last_message_at: number; last_customer_at: number;
  last_inbound_id: string | null; window_start: number; sent_in_minute: number;
  hour_start: number; sent_in_hour: number;
}

export interface LineMessage {
  id: string; chat_id: string; user_id: string; direction: 'in' | 'out'; external_id: string | null;
  event_type: string; body: string; message_type: string; sender_id: string | null;
  addressed: number; draft: string | null; confidence: 'high' | 'low' | null; handoff_reason: string | null;
  status: 'received' | 'pending' | 'drafted' | 'sent' | 'skipped' | 'failed';
  approved_by: string | null; reply_token: string | null; reply_token_until: number | null;
  send_phase: 'ready' | 'sending' | 'sent' | 'uncertain'; send_started_at: number | null;
  send_via: 'reply' | 'push' | null; queue_token: string | null; queue_until: number | null; job_id: string | null;
  draft_lock: string | null; draft_until: number | null;
  chat_revision: number | null; settings_revision: number | null;
  created_at: number; message_at: number; sent_at: number | null; error: string | null;
}

/** 'line:{channel_id}:{kind}:{external_chat_id}' — one chat per LINE conversation per account. */
export const chatKey = (channelId: string, kind: string, externalChatId: string) => `${channelId}:${kind}:${externalChatId}`;
/** 'line:{channel_id}:{webhookEventId}' — the idempotency key for one LINE event. */
export const lineExternalKey = (channelId: string, webhookEventId: string) => `line:${channelId}:${webhookEventId}`;

export async function lineSettings(env: Env, lineAccountId: string, userId: string): Promise<LineSettings> {
  return await env.DB.prepare('SELECT * FROM line_settings WHERE line_account_id = ? AND user_id = ?')
    .bind(lineAccountId, userId).first<LineSettings>()
    ?? { line_account_id: lineAccountId, user_id: userId, mode: 'off', group_mode: 'mention', keyword_prefix: '',
      persona: '', llm_config_id: null, llm_config_label: '', kb_source: 'inbox_kb', history_turns: 6,
      reply_language: 'auto', allow_push: 0, rate_per_min: 4, rate_per_hour: 60, revision: 0, updated_at: now() };
}

export async function readBytes(request: Request, max: number): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(request.headers.get('Content-Length') || 0) > max) throw new AuthError(413, 'ข้อมูลมีขนาดใหญ่เกินไป');
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError(400, 'ข้อมูลไม่ถูกต้อง');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length;
      if (size > max) { await reader.cancel(); throw new AuthError(413, 'ข้อมูลมีขนาดใหญ่เกินไป'); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

/** Pause one chat: the bot answers nothing there until the member resumes. */
export async function pauseLineChat(env: Env, chatId: string, userId: string): Promise<void> {
  await env.DB.prepare("UPDATE line_chats SET status='needs_human',auto_paused=1,revision=revision+1 WHERE id=? AND user_id=?")
    .bind(chatId, userId).run();
}

/** Handoff for one message: mark the draft and pause its chat in one batch. */
export async function markLineHandoff(env: Env, message: Pick<LineMessage, 'id' | 'chat_id' | 'user_id'>, reason: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("UPDATE line_messages SET handoff_reason=?,status=CASE WHEN status='pending' THEN 'drafted' ELSE status END,confidence='low' WHERE id=? AND user_id=? AND send_phase='ready'")
      .bind(reason, message.id, message.user_id),
    env.DB.prepare("UPDATE line_chats SET status='needs_human',auto_paused=1,revision=revision+1 WHERE id=? AND user_id=?")
      .bind(message.chat_id, message.user_id),
  ]);
}

export const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
export const lineId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_.\-=+/:]{1,128}$/.test(v);
