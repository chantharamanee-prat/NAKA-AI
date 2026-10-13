-- LINE OA auto-reply, Stage 1+2 (design NAK-13 §2.3): the member's own LINE Official Accounts,
-- per-account settings, 1:1/group chats, message history with send state, and durable webhook receipts.
--
-- Runs as account_app with search_path = account; never names its schema (see 0002_shared.sql).
-- No new grants: only the landing reads these tables, so `npm run test:db` is unchanged.

-- The member's own LINE Official Account. One OA belongs to exactly one member.
CREATE TABLE line_accounts (
  id            text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id    text NOT NULL,                 -- LINE channel id (digits), shown to the member
  destination   text,                          -- bot user id ('U…') learned from the first verified webhook
  name          text NOT NULL DEFAULT '',
  secret_enc    text NOT NULL,                 -- channel secret, AES-GCM (src/social/crypto.ts)
  token_enc     text NOT NULL,                 -- channel access token, AES-GCM
  webhook_token text NOT NULL,                 -- 32 hex, the :token path segment; rotatable
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','error','revoked')),
  last_error    text,
  last_event_at bigint,
  created_at    bigint NOT NULL,
  updated_at    bigint NOT NULL,
  UNIQUE (channel_id),                         -- two tenants can never claim the same OA (cf. 'ambiguous_account')
  UNIQUE (webhook_token),
  UNIQUE (id, user_id)                         -- composite FK target, like social_accounts
);

CREATE TABLE line_settings (
  line_account_id text PRIMARY KEY,
  user_id         text NOT NULL,
  mode            text NOT NULL DEFAULT 'off'      CHECK (mode IN ('off','draft','auto')),
  group_mode      text NOT NULL DEFAULT 'mention'  CHECK (group_mode IN ('off','mention','mention_or_prefix')),
  keyword_prefix  text NOT NULL DEFAULT '',        -- used only when group_mode='mention_or_prefix'
  persona         text NOT NULL DEFAULT '',        -- member's system prompt, ≤ 4000 chars, DATA not instructions (§6)
  llm_config_id   bigint,                          -- studio ai_service_configs.id; NULL = studio's default text config
  llm_config_label text NOT NULL DEFAULT '',       -- display snapshot; no cross-schema FK exists or is allowed
  kb_source       text NOT NULL DEFAULT 'inbox_kb' CHECK (kb_source IN ('none','inbox_kb')),
  history_turns   bigint NOT NULL DEFAULT 6        CHECK (history_turns BETWEEN 0 AND 20),
  reply_language  text NOT NULL DEFAULT 'auto'     CHECK (reply_language IN ('auto','th')),
  allow_push      boolean NOT NULL DEFAULT false,  -- push costs the OA's LINE message quota
  rate_per_min    bigint NOT NULL DEFAULT 4        CHECK (rate_per_min BETWEEN 1 AND 30),
  rate_per_hour   bigint NOT NULL DEFAULT 60       CHECK (rate_per_hour BETWEEN 1 AND 600),
  revision        bigint NOT NULL DEFAULT 0,       -- fences an in-flight job against a settings change
  updated_at      bigint NOT NULL,
  FOREIGN KEY (line_account_id, user_id) REFERENCES line_accounts(id, user_id) ON DELETE CASCADE
);

CREATE TABLE line_chats (
  id               text PRIMARY KEY,
  line_account_id  text NOT NULL,
  user_id          text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('user','group','room')),
  external_chat_id text NOT NULL,              -- source.userId | groupId | roomId
  customer_name    text NOT NULL DEFAULT '',
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','needs_human','closed')),
  auto_paused      bigint NOT NULL DEFAULT 0 CHECK (auto_paused IN (0,1)),
  revision         bigint NOT NULL DEFAULT 0,
  last_message_at  bigint NOT NULL,
  last_customer_at bigint NOT NULL DEFAULT 0,
  last_inbound_id  text,
  window_start     bigint NOT NULL DEFAULT 0,  -- rate-limit window (unix seconds, truncated to the minute)
  sent_in_minute   bigint NOT NULL DEFAULT 0,
  hour_start       bigint NOT NULL DEFAULT 0,
  sent_in_hour     bigint NOT NULL DEFAULT 0,
  UNIQUE (line_account_id, kind, external_chat_id),
  UNIQUE (id, user_id),
  FOREIGN KEY (line_account_id, user_id) REFERENCES line_accounts(id, user_id) ON DELETE CASCADE
);

CREATE TABLE line_messages (
  id               text PRIMARY KEY,
  chat_id          text NOT NULL,
  user_id          text NOT NULL,
  direction        text NOT NULL CHECK (direction IN ('in','out')),
  external_id      text UNIQUE,                -- 'line:{channel_id}:{webhookEventId}'  ← the idempotency key
  event_type       text NOT NULL DEFAULT 'message',  -- message|follow|unfollow|join|leave|memberJoined|memberLeft
  body             text NOT NULL DEFAULT '',
  message_type     text NOT NULL DEFAULT 'text',
  sender_id        text,
  addressed        boolean NOT NULL DEFAULT true,    -- false: group message that did not mention us (context only)
  draft            text,
  confidence       text CHECK (confidence IN ('high','low')),
  handoff_reason   text,
  status           text NOT NULL CHECK (status IN ('received','pending','drafted','sent','skipped','failed')),
  approved_by      text,
  reply_token      text,                       -- single use, ~1 minute
  reply_token_until bigint,
  send_phase       text NOT NULL DEFAULT 'ready' CHECK (send_phase IN ('ready','sending','sent','uncertain')),
  send_started_at  bigint,
  send_via         text CHECK (send_via IN ('reply','push')),
  queue_token      text, queue_until bigint, job_id text,
  draft_lock       text, draft_until bigint,
  chat_revision    bigint, settings_revision bigint,
  created_at       bigint NOT NULL,
  message_at       bigint NOT NULL,
  sent_at          bigint,
  error            text,
  FOREIGN KEY (chat_id, user_id) REFERENCES line_chats(id, user_id) ON DELETE CASCADE
);

CREATE TABLE line_webhook_receipts (          -- durable body, so the 200 is honest (copy of inbox_webhook_receipts)
  id text PRIMARY KEY,                        -- sha256(raw body)
  line_account_id text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done')),
  cursor bigint NOT NULL DEFAULT 0,
  skipped bigint NOT NULL DEFAULT 0,
  error text, lease_id text, lease_until bigint,
  created_at bigint NOT NULL
);

CREATE INDEX idx_line_messages_pending ON line_messages (status, send_phase, created_at);
CREATE INDEX idx_line_messages_chat    ON line_messages (chat_id, created_at DESC);
CREATE INDEX idx_line_chats_account    ON line_chats (line_account_id, last_message_at DESC);
CREATE INDEX idx_line_receipts_pending ON line_webhook_receipts (status, created_at);

-- Gating
INSERT INTO features (key, app, label, quota_unit, sort_order) VALUES
  ('landing.line_autoreply', 'landing', 'ตอบแชท LINE OA อัตโนมัติ', 'ข้อความ', 145);
INSERT INTO plan_features (plan_id, feature_key, monthly_limit)
SELECT plan_id, 'landing.line_autoreply', NULL FROM plan_features WHERE feature_key = 'landing.inbox'
ON CONFLICT DO NOTHING;   -- same plans that already sell the chat bot: business, max (and trial)
-- CEO review (NAK-18 C5): trial is capped — a free 7-day account may not run unlimited LLM replies.
UPDATE plan_features SET monthly_limit = 50 WHERE plan_id = 'trial' AND feature_key = 'landing.line_autoreply';

INSERT INTO credit_prices (key, app, label, unit_label, credits, per_second, allow_per_second, sort_order) VALUES
  ('landing.line_autoreply', 'landing', 'ตอบแชท LINE OA อัตโนมัติ', 'ข้อความ', 0, false, false, 60);
