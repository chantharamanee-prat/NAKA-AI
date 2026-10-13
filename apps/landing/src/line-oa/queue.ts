import type { Env } from '../types';
import { enqueueJob } from '../jobs';
import { priceOf } from '../credit-prices';
import { releaseFeature, useFeature } from '../entitlements';
import { LINE_JOB_KIND, LINE_FEATURE_KEY, LINE_PRICE_KEY, now } from './common';
import { processLineReceipts } from './events';

// Queue admission is leased separately because enqueueJob and the line row cannot share a transaction.
// The enqueue token travels in job.input; a delayed/orphan job cannot process a newer reservation.
export async function enqueueLinePending(env: Env, maxMessages = 20): Promise<number> {
  let enqueued = 0;
  await env.DB.batch([
    env.DB.prepare(`UPDATE line_messages SET status='failed',error='send_outcome_unknown',send_phase='uncertain'
      WHERE send_phase='sending' AND send_started_at<=?`).bind(now() - 120),
    env.DB.prepare(`UPDATE line_chats SET status='needs_human',auto_paused=1 WHERE id IN
      (SELECT chat_id FROM line_messages WHERE send_phase='uncertain')`),
    // Adopt an orphan job left between enqueueJob success and storing job_id.
    env.DB.prepare(`UPDATE line_messages SET job_id=(SELECT j.id FROM jobs j WHERE j.kind=? AND j.user_id=line_messages.user_id
      AND json_extract(j.input,'$.messageId')=line_messages.id AND json_extract(j.input,'$.enqueueToken')=line_messages.queue_token
      ORDER BY j.created_at,j.id LIMIT 1) WHERE status='pending' AND job_id IS NULL AND queue_token IS NOT NULL`).bind(LINE_JOB_KIND),
    env.DB.prepare(`UPDATE line_messages SET status='failed',error='draft_job_failed',handoff_reason='draft_unavailable',confidence='low'
      WHERE status='pending' AND EXISTS(SELECT 1 FROM jobs WHERE jobs.id=line_messages.job_id AND jobs.status IN ('failed','done'))`),
    env.DB.prepare(`UPDATE line_chats SET status='needs_human',auto_paused=1 WHERE id IN
      (SELECT chat_id FROM line_messages WHERE error='draft_job_failed')`),
  ]);
  // Stage 2 answers 1:1 chats only (t.kind='user'); groups/rooms are stored, never enqueued — Stage 4 widens this.
  const candidates = await env.DB.prepare(`SELECT m.id FROM line_messages m
    JOIN line_chats c ON c.id=m.chat_id JOIN line_settings s ON s.line_account_id=c.line_account_id
    JOIN line_accounts a ON a.id=c.line_account_id JOIN users u ON u.id=m.user_id
    WHERE m.direction='in' AND m.status='pending' AND m.job_id IS NULL AND m.send_phase='ready' AND m.addressed
    AND c.kind='user' AND c.status!='closed'
    AND (m.queue_until IS NULL OR m.queue_until<=?) AND s.mode!='off' AND a.status='active' AND u.status='active'
    ORDER BY m.created_at,m.id LIMIT ?`)
    .bind(now(), maxMessages).all<{ id: string }>();
  for (const candidate of candidates.results) {
    const token = crypto.randomUUID();
    const claimed = await env.DB.prepare(`UPDATE line_messages SET queue_token=?,queue_until=? WHERE id=? AND status='pending'
      AND job_id IS NULL AND (queue_until IS NULL OR queue_until<=?) RETURNING user_id`)
      .bind(token, now() + 60, candidate.id, now()).first<{ user_id: string }>();
    if (!claimed) continue;
    const use = await useFeature(env, claimed.user_id, LINE_FEATURE_KEY, 1);
    if (!use.ok) {
      await env.DB.prepare("UPDATE line_messages SET queue_token=NULL,queue_until=?,error=? WHERE id=? AND queue_token=?")
        .bind(now() + 60, use.reason === 'quota' ? 'feature_quota' : 'feature_disabled', candidate.id, token).run();
      continue;
    }
    try {
      const cost = await priceOf(env.DB, LINE_PRICE_KEY, 0);
      const result = await enqueueJob(env.DB, { userId: claimed.user_id, kind: LINE_JOB_KIND, costCredits: cost,
        input: { messageId: candidate.id, enqueueToken: token }, maxAttempts: 3, countsTowardLimit: false });
      if (result.ok) {
        await env.DB.prepare('UPDATE line_messages SET job_id=? WHERE id=? AND queue_token=? AND job_id IS NULL')
          .bind(result.jobId, candidate.id, token).run();
        enqueued++;
      } else {
        await releaseFeature(env, claimed.user_id, LINE_FEATURE_KEY, 1, use.period);
        await env.DB.prepare("UPDATE line_messages SET queue_token=NULL,queue_until=?,error='queue_capacity' WHERE id=? AND queue_token=?")
          .bind(now() + 30, candidate.id, token).run();
      }
    } catch {
      // Keep token to recover an enqueue whose commit succeeded but response/next write was lost.
      await releaseFeature(env, claimed.user_id, LINE_FEATURE_KEY, 1, use.period).catch(() => undefined);
      await env.DB.prepare("UPDATE line_messages SET error='enqueue_retry' WHERE id=? AND queue_token=?")
        .bind(candidate.id, token).run();
    }
  }
  return enqueued;
}

/** Call every minute alongside runQueue, and after webhook durable receipt. Does not call an LLM. */
export async function drainLine(env: Env, { maxReceipts = 5, maxMessages = 20 } = {}): Promise<{ receipts: number; enqueued: number }> {
  if (!Number.isSafeInteger(maxReceipts) || maxReceipts < 0 || maxReceipts > 20 ||
      !Number.isSafeInteger(maxMessages) || maxMessages < 0 || maxMessages > 100) throw new RangeError('Invalid line drain limits');
  return { receipts: await processLineReceipts(env, maxReceipts), enqueued: await enqueueLinePending(env, maxMessages) };
}
