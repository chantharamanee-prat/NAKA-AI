# Secret rotation — NAKA-AI landing + studio (DevOps-owned note for NAK-22)

Applies to the Docker deployment (root `docker-compose.yml`, ADR-0002).
Secrets are environment-injected only — never committed, never printed in
logs, CI output, or tickets. Presence check that prints nothing secret:

  grep -c "^SOCIAL_TOKEN_KEY=.\+" apps/landing/.env.production
  grep -c "^STUDIO_ADMIN_TOKEN=.\+" apps/landing/.env.production
  grep -c "^ADMIN_TOKEN=.\+" apps/studio/.env.production

(A count of 1 = present. Do not `cat` these files into a ticket.)

## 1. SOCIAL_TOKEN_KEY (landing, env-only)

Base64 of exactly 32 random bytes (`openssl rand -base64 32`). LOCKED in
`src/system/registry.ts`: it cannot be set from /admin/system/, it must be
in `apps/landing/.env.production` (prod) or `.env` (dev).

What it protects:

- `account.social_accounts.token_enc` (Meta page tokens, AES-GCM) — today.
- `account.line_accounts.secret_enc` + `line_accounts.token_enc` (member
  LINE channel secret + access token) — after the LINE OA auto-reply
  feature (NAK-12) ships.
- Signed clip URLs: derived from this key with HKDF
  (`docs/social-integration-status.md`). Rotating the key invalidates old
  URLs; clients get fresh ones, no database rewrite needed for those.

Rotation consequences (say plainly):

- **There is no re-encryption tool.** Every `*_enc` value above becomes
  undecryptable the moment the key changes. Each Meta page must reconnect
  and each LINE OA must re-enter its secret/token (that re-encrypts under
  the new key). Until a member does, their auto-reply stays silent and
  `line_accounts.last_error` records the decrypt failure.
- So: rotate only with CEO sign-off (Rollback-path-first lens), announce a
  maintenance window, and treat "restore the old value" as the rollback.

Procedure:

1. Back up the current value somewhere off-repo (host secret store).
   The backup IS the rollback: putting it back restores everything.
2. `NEW_KEY=$(openssl rand -base64 32)` on the host; verify shape
   `[[ $NEW_KEY =~ ^[A-Za-z0-9+/]{43}=$ ]]`.
3. Write it into `apps/landing/.env.production` (replace the line, keep
   the `SOCIAL_TOKEN_KEY=` name), `docker compose up -d landing`, and
   confirm `docker logs` shows the normal startup lines only
   (`naka-ai landing on :8788 …`, no secret names).
4. Reconnect one Meta page / one test LINE OA, confirm encrypt+decrypt
   round-trips, then tell members to reconnect theirs.
5. Keep the old value for one backup cycle (`BACKUP_KEEP_DAYS`, 14 days
   default) before destroying it.

## 2. STUDIO_ADMIN_TOKEN (landing) = ADMIN_TOKEN (studio)

One credential, two files. Landing sends it as `X-Admin-Token` to
`STUDIO_INTERNAL_URL` (compose sets `http://studio:5679`); studio's
`adminGuard` (`apps/studio/backend/src/core/auth/admin.ts`, timing-safe
compare, ≥ 16 chars) enforces it on `/api/v1/system/*` — including the
Stage 3 LLM endpoints. It may live in `apps/landing/.env.production` or
in /admin/system/ (`system_settings`); `.env.production` wins at process
start, so keep exactly one source to avoid split-brain.

Rotation (both sides, one window):

1. Generate (`openssl rand -hex 24`), write the SAME value into
   `apps/studio/.env.production` (`ADMIN_TOKEN=…`) and
   `apps/landing/.env.production` (`STUDIO_ADMIN_TOKEN=…`).
2. `docker compose up -d studio landing`; open the back office
   “ระบบ Studio” page — a token mismatch answers 502
   (“ไม่รับโทเคน … ตรงกับ ADMIN_TOKEN ของ studio”).
3. Rollback: previous values + restart both containers.

Stage 3 (NAK-20) cannot work in prod until this pair matches; on
2026-10-13 prod had studio `ADMIN_TOKEN` set but landing
`STUDIO_ADMIN_TOKEN` in neither `.env.production` nor
`system_settings`.

## 3. Keys that are NOT rotated here

- `SESSION_SECRET`, `SETTINGS_KEY`, Stripe/Meta/OAuth secrets: rotate per
  their own docs; `SETTINGS_KEY` has the same no-re-encryption property
  for encrypted settings — same backup-first rule applies.
- Root `.env` DB passwords (`ACCOUNT_DB_PASSWORD`, …): baked into
  `infra/postgres/init/` on first volume init; changing one later needs
  `ALTER ROLE` inside Postgres, not just the file (Idempotent-and-
  repeatable lens: init scripts run once on an empty volume).
