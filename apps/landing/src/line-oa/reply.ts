import type { Env } from '../types';
import { JobDeferredError, type JobHandler } from '../jobs';
import { hasFeature } from '../entitlements';
import { escalation, HANDOFF_REPLY, validReply } from '../inbox/policy';
import { LINE_JOB_KIND, lineSettings, now, pauseLineChat, record, type LineAccount, type LineChat, type LineMessage } from './common';
import { generateLineReply, lineHistory, lineKnowledge } from './llm';
import { sendLineReply } from './send';

export function makeLineReplyHandler(env: Env): JobHandler {
  return async job => {
    let id: string; let enqueueToken: string;
    try {
      const input = JSON.parse(job.input);
      if (job.kind !== LINE_JOB_KIND || !record(input) || typeof input.messageId !== 'string' || typeof input.enqueueToken !== 'string') throw new Error();
      id = input.messageId; enqueueToken = input.enqueueToken;
    } catch { return { output: { status: 'skipped' } }; }
    // A crash after enqueue may leave job_id null; only the matching reservation may adopt it.
    await env.DB.prepare('UPDATE line_messages SET job_id=? WHERE id=? AND user_id=? AND queue_token=? AND job_id IS NULL')
      .bind(job.id, id, job.user_id, enqueueToken).run();
    const lock = crypto.randomUUID();
    const message = await env.DB.prepare(`UPDATE line_messages SET draft_lock=?,draft_until=? WHERE id=? AND user_id=? AND direction='in'
      AND status='pending' AND send_phase='ready' AND job_id=? AND queue_token=? AND (draft_until IS NULL OR draft_until<=?) RETURNING *`)
      .bind(lock, now() + 120, id, job.user_id, job.id, enqueueToken, now()).first<LineMessage>();
    if (!message) return { output: { status: 'skipped' } };
    try {
      const chat = await env.DB.prepare('SELECT * FROM line_chats WHERE id=? AND user_id=?').bind(message.chat_id, message.user_id).first<LineChat>();
      const account = chat && await env.DB.prepare(`SELECT a.* FROM line_accounts a JOIN users u ON u.id=a.user_id
        WHERE a.id=? AND a.user_id=? AND a.status='active' AND u.status='active'`)
        .bind(chat.line_account_id, message.user_id).first<LineAccount>();
      const settings = account ? await lineSettings(env, account.id, message.user_id) : null;
      if (!chat || !account || !settings || settings.mode === 'off' || chat.status === 'closed' || chat.kind !== 'user') {
        await env.DB.prepare("UPDATE line_messages SET status='skipped',error='automation_unavailable',draft_lock=NULL,draft_until=NULL WHERE id=? AND draft_lock=?")
          .bind(message.id, lock).run();
        return { output: { status: 'skipped' } };
      }
      // §9 gap #5, closed for this feature: a revoked plan stops the bot even mid-conversation.
      if (!(await hasFeature(env, message.user_id, 'landing.line_autoreply'))) {
        await env.DB.prepare("UPDATE line_messages SET status='skipped',error='feature_revoked',draft_lock=NULL,draft_until=NULL WHERE id=? AND draft_lock=?")
          .bind(message.id, lock).run();
        return { output: { status: 'skipped' } };
      }
      // Per-chat rate limit before the LLM call, so a hot chat does not burn drafts it cannot send.
      const minuteStart = now() - (now() % 60);
      const hourStart = now() - (now() % 3600);
      const inMinute = chat.window_start === minuteStart ? chat.sent_in_minute : 0;
      const inHour = chat.hour_start === hourStart ? chat.sent_in_hour : 0;
      if (inMinute >= settings.rate_per_min || inHour >= settings.rate_per_hour) {
        await env.DB.prepare('UPDATE line_messages SET draft_lock=NULL,draft_until=NULL WHERE id=? AND draft_lock=?')
          .bind(message.id, lock).run();
        throw new JobDeferredError(30);
      }
      // line_settings has no custom keywords yet: the required words + injection patterns decide.
      let reason = escalation(message.body, { mode: settings.mode, tone: '', escalate_keywords: '[]', revision: settings.revision });
      if (!message.body.trim()) reason = 'attachment_requires_human';
      if (!message.message_at) reason = 'invalid_event_time';
      const knowledge = await lineKnowledge(env, message.user_id, settings.kb_source);
      // kb_source='none' means the member answers from persona alone — without this guard the
      // 'none' option could never reply, since knowledge.kb is always empty for it.
      if (!reason && settings.kb_source !== 'none' && !knowledge.kb.length) reason = 'knowledge_missing';
      const history = await lineHistory(env, chat.id, message.user_id, message.id, settings.history_turns);
      let draft = reason ? { reply: HANDOFF_REPLY, confidence: 'low' as const, handoff: true, reason }
        : await generateLineReply(env, { question: message.body, persona: settings.persona,
            language: settings.reply_language, knowledge, history });
      // Numeric claims (prices, discounts, quantities) must occur in the supplied facts.
      const factsText = JSON.stringify({ kb: knowledge.kb, persona: settings.persona });
      if (!reason && [...draft.reply.matchAll(/\d+(?:[.,]\d+)*/g)].some(match => !factsText.includes(match[0])))
        draft = { reply: HANDOFF_REPLY, confidence: 'low', handoff: true, reason: 'ungrounded_number' };
      if (!validReply(draft.reply) && !draft.handoff) throw new Error('invalid_draft');
      const saved = await env.DB.prepare(`UPDATE line_messages SET status='drafted',draft=?,confidence=?,handoff_reason=?,chat_revision=?,settings_revision=?,
        draft_lock=NULL,draft_until=NULL,error=NULL WHERE id=? AND status='pending' AND draft_lock=? AND draft_until>? RETURNING id`)
        .bind(draft.reply, draft.handoff ? 'low' : draft.confidence, draft.handoff ? draft.reason || 'model_handoff' : null,
          chat.revision, settings.revision, message.id, lock, now()).first();
      if (!saved) return { output: { status: 'skipped' } };
      if (draft.handoff) {
        await pauseLineChat(env, chat.id, message.user_id);
        return { output: { status: 'needs_human' } };
      }
      // sendLineReply rechecks human takeover, settings revision, latest message and the reply window atomically.
      if (settings.mode === 'auto' && draft.confidence === 'high') {
        try { return { output: await sendLineReply(env, message.id, message.user_id) }; }
        catch { return { output: { status: 'needs_human' } }; }
      }
      return { output: { status: 'drafted' } };
    } catch (err) {
      if (err instanceof JobDeferredError) throw err;
      const exhausted = job.attempts >= job.max_attempts;
      await env.DB.prepare(`UPDATE line_messages SET status=?,error='draft_unavailable',draft_lock=NULL,draft_until=NULL
        WHERE id=? AND draft_lock=? AND send_phase='ready'`).bind(exhausted ? 'failed' : 'pending', message.id, lock).run();
      if (exhausted) await env.DB.prepare("UPDATE line_chats SET status='needs_human',auto_paused=1,revision=revision+1 WHERE id=? AND user_id=?")
        .bind(message.chat_id, message.user_id).run();
      // jobs.ts logs thrown errors. Never let SDK errors (request bodies/headers) escape this boundary.
      throw new Error('line_draft_unavailable');
    }
  };
}
