# LINE OA webhook — ingress, secrets, outbound (DevOps note for NAK-15)

Applies to the Docker deployment on the owner's host (root `docker-compose.yml`,
ADR-0002). Design: NAK-13 §2.4 (webhook flow), §2.5 (studio LLM call), §6 (security).
Key rotation procedure (all keys): `secret-rotation.md` — read that first; this
note covers only what is specific to the LINE OA auto-reply feature (NAK-12).

## 1. Public route — no proxy change needed (verified 2026-10-13)

- `naka-ai.com` terminates at nginx on this host and proxies **every path** to the
  landing container (`location / → http://127.0.0.1:8788`, `server_name naka-ai.com`,
  `/etc/nginx/sites-enabled/naka-ai.com`). There is no per-path allowlist, so
  `POST /webhook/line/{webhook_token}` reaches landing exactly like today's
  `POST /webhook/line` — no vhost edit, no reload, no Cloudflare rule.
- No redirect on the apex: only `www → apex` 301s. LINE never follows redirects,
  so member webhook URLs must use `https://naka-ai.com/webhook/line/{token}` (apex).
- Limits (design needs ≤ 256 KB body, 200 in a few seconds):
  `client_max_body_size 25m` ≫ 256 KB; `proxy_read_timeout 120s`; the handler
  returns 200 before doing work (`ctx.waitUntil`), so timeouts cannot bite.
- Verified: `POST 127.0.0.1:8788/webhook/line` with a bad signature → 401
  (route live); `GET https://naka-ai.com/api/health` → 200 end to end through
  Cloudflare + nginx. The per-account `:token` branch itself ships with Fullstack
  Stage 1 (NAK-19); when it lands, re-run the two probes plus one signed replay
  (duplicate POST → one receipt, §8 of the design).

## 2. Secrets — what must exist and where

| Key | Lives in | Status 2026-10-13 |
|---|---|---|
| `SOCIAL_TOKEN_KEY` (AES-GCM for `social_accounts.token_enc` **and** `line_accounts.secret_enc`/`token_enc`) | `apps/landing/.env.production`, env-only (LOCKED in `src/system/registry.ts`, cannot come from /admin/system/) | **Provisioned today** (was absent; container env length 0). Shape `^[A-Za-z0-9+/]{43}=$`, process sees 44 chars. Nothing could decrypt before, and `social_accounts` is empty, so nothing broke and nothing needs re-encrypting. |
| `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` (legacy global bot) | /admin/system/ (`system_settings`) via `withSettings()` — not in `.env.production` | Unchanged; legacy bot unaffected (still 401s bad signatures). |
| `STUDIO_ADMIN_TOKEN` (landing) = `ADMIN_TOKEN` (studio) | landing: `.env.production` or /admin/system/; studio: `.env.production` | Studio side present; **landing side still missing** (env length 0, not in `system_settings`). Only needed for Stage 3 (landing→studio LLM call, NAK-20). Pair them in one window before Stage 3 ships — see `secret-rotation.md` §2. |
| `ANTHROPIC_API_KEY` (Stage 2 `anthropic` backend) | env or /admin/system/ (`SETTINGS`, group `ai`) | Not checked into scope here; Fullstack Stage 2 needs it where the reply runs. Confirm before Stage 2 deploys. |

Rotation rule (Rollback-path-first): there is **no re-encryption tool**. Changing
`SOCIAL_TOKEN_KEY` orphan-every `*_enc` row until each member reconnects — CEO
sign-off + maintenance window required. The file backup is the rollback:
`apps/landing/.env.production.bak-YYYYMMDD` on the host, kept one backup cycle.

## 3. Outbound — api.line.me / api-data.line.me (verified 2026-10-13)

No egress proxy on this host; the containers share the host network path.
Probed from the host: `https://api.line.me/v2/bot/info` with a bad token → 401
(reachable, correctly rejected); `https://api-data.line.me/` → 302 (reachable).
Reply (`/message/reply`) and push (`/message/push`) use the same hosts, so no
firewall change is needed. If a future hardening adds egress rules, allowlist
both hosts on 443 or replies silently become `needs_human` chats.

## 4. Logging — tokens never printed (audited 2026-10-13)

- `src/line.ts`: failure paths log **status codes only** (`LINE reply failed…`,
  `res.status`); LINE error bodies are never logged (they echo customer text).
- `src/jobs.ts` `errorSummary()`: `Error name (+ status)` only; job input for
  `line_reply` carries `{ messageId, enqueueToken }`, never a secret (design §6.2).
- `src/social/crypto.ts`: decrypt failure throws a generic Thai message; the key
  and plaintext never appear in any log line. Startup logs show only
  `naka-ai landing on :8788 (role all)` — no secret names with values.
- Rule for future code: password/token-shaped values stay out of `console.*`,
  CI output, and ticket comments. A secret posted anywhere is treated as
  compromised: rotate per `secret-rotation.md`, then clean up.

## 5. Observability — where trouble shows up

- Signature-failure spike: `line_accounts.last_error` + `status='error'`
  (repeated bad secret or webhook-token probing); app logs `invalid signature` 401s.
- Uncertain sends: chat `needs_human`, message `send_phase='uncertain'` — member
  work list `GET /api/line/chats?status=needs_human`; admin LINE alert path for spikes.
- Queue health: back-office สถานะเซิร์ฟเวอร์ page (cron heartbeat); `docker logs
  naka-landing-1` for `queue` / `inbox` drain lines.

## 6. Rollback

- This note + the key provisioning: restore
  `apps/landing/.env.production.bak-20261013` and `docker compose up -d landing`
  (seconds of downtime; healthcheck `pg_isready`-gated postgres dependency).
  Blast radius of the key itself: zero while `social_accounts`/`line_accounts`
  hold no rows encrypted under a different key.
- The per-account webhook branch (Fullstack, not yet merged) rolls back by
  redeploying the previous `naka-landing` image; the proxy needs no change either way.

## 7. Left for Stage 6 (Tester + DevOps acceptance pass)

- [ ] Pair `STUDIO_ADMIN_TOKEN`/`ADMIN_TOKEN` before NAK-20 ships.
- [ ] Confirm `ANTHROPIC_API_KEY` where Stage 2 runs.
- [ ] Live replay test against prod (duplicate POST → one reply; expired reply
  token → push policy; revoked feature → bot stops) — Tester owns, DevOps assists.
