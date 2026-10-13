import type { Env } from '../types';
import { decryptToken, lineContext } from '../social/crypto';
import { verifySignature } from '../line';
import { featureOn } from '../system/store';
import { LineOaError, now, readBytes, sha256, type LineAccount } from './common';
import { drainLine } from './queue';

const LINE_WEBHOOK_MAX_BYTES = 256 * 1024; // LINE payloads are small; anything larger is refused unread

/** POST /webhook/line/:token — one URL per member OA. Order: size → account → HMAC(raw) → parse → destination → receipt → 200. */
export async function handleTenantLineWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response | null> {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/webhook\/line\/([0-9a-f]{32})$/);
  if (!match || request.method !== 'POST') return null;
  try {
    // 1. Size first, no DB write.
    let bytes: Uint8Array;
    try {
      bytes = await readBytes(request, LINE_WEBHOOK_MAX_BYTES);
    } catch (err) {
      if (err instanceof LineOaError && err.status === 413) return new Response('payload too large', { status: 413 });
      throw err;
    }
    // 2. Account lookup by webhook_token; unknown token gets a generic 404 with no further work.
    const account = await env.DB.prepare(`SELECT a.* FROM line_accounts a JOIN users u ON u.id=a.user_id
      WHERE a.webhook_token=? AND u.status='active'`).bind(match[1]).first<LineAccount>();
    if (!account) return new Response('not found', { status: 404 });
    // 3. HMAC over the raw bytes, before parsing. A bad signature records last_error but — C2 —
    // never disables the account: anyone who learns the webhook URL could otherwise switch the bot off.
    const secret = await decryptToken(env, account.secret_enc, lineContext(account.user_id, account.channel_id));
    if (!(await verifySignature(bytes, request.headers.get('x-line-signature'), secret))) {
      await env.DB.prepare('UPDATE line_accounts SET last_error=?,updated_at=? WHERE id=? AND user_id=?')
        .bind('invalid_signature', now(), account.id, account.user_id).run();
      return new Response('invalid signature', { status: 401 });
    }
    // 4. Parse only after authenticating the original bytes, never reserialized JSON.
    let raw: string;
    let destination: string;
    try {
      raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
      const value: unknown = JSON.parse(raw);
      if (typeof (value as { destination?: unknown }).destination !== 'string' || !Array.isArray((value as { events?: unknown }).events)) throw new Error();
      destination = (value as { destination: string }).destination;
    } catch { return new Response('bad payload', { status: 400 }); }
    if (!account.destination) {
      await env.DB.prepare('UPDATE line_accounts SET destination=?,last_event_at=?,updated_at=? WHERE id=? AND user_id=?')
        .bind(destination, now(), now(), account.id, account.user_id).run();
    } else if (destination !== account.destination) {
      await env.DB.prepare('UPDATE line_accounts SET last_error=?,updated_at=? WHERE id=? AND user_id=?')
        .bind('destination_mismatch', now(), account.id, account.user_id).run();
      return new Response('invalid signature', { status: 401 });
    }
    // 5. Feature switch off: 200 and drop, so LINE does not retry forever.
    if (!featureOn(env, 'FEATURE_LINE_AUTOREPLY')) return new Response('ok');
    // 6. Durable receipt. A database failure returns 503 so LINE retries safely.
    await env.DB.prepare('INSERT OR IGNORE INTO line_webhook_receipts (id,line_account_id,body,created_at) VALUES (?,?,?,?)')
      .bind(await sha256(raw), account.id, raw, now()).run();
    await env.DB.prepare("UPDATE line_accounts SET last_error=NULL,last_event_at=?,updated_at=? WHERE id=? AND user_id=?")
      .bind(now(), now(), account.id, account.user_id).run();
    ctx.waitUntil(drainLine(env, { maxReceipts: 1, maxMessages: 5 }).catch(() => undefined));
    return new Response('ok');
  } catch (error) {
    // DB failure = 503 so LINE retries; never log the body (it carries customer text).
    return new Response('webhook unavailable', { status: error instanceof LineOaError ? error.status : 503 });
  }
}
