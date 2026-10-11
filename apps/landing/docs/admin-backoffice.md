# หลังร้าน naka-ai (`/admin/`)

All pages share one design (`public/admin/admin.css`) and one shell (`public/admin/admin-shell.js`).
The shell gives every page a grouped sidebar on desktop and a tab bar on phones. Every API under
`/api/admin/*` passes `checkAdmin` (`src/admin/auth.ts`): an admin Google account listed in
`ADMIN_EMAILS` with a sign-in less than 12 hours old, or the `ADMIN_TOKEN` break-glass token.

## Pages

| Group | Page | Path | API |
|---|---|---|---|
| งานประจำวัน | ภาพรวม | `/admin/` | `GET /api/admin/overview` |
| | จัดการลูกค้า | `/admin/customers/` (`?customer=<id>` opens one) | `/api/admin/customers/*` |
| | การเงิน | `/admin/payments/` (filters in the query string) | `GET /api/admin/payments`, `GET /api/admin/payments.csv` |
| | งานที่ล้มเหลว | `/admin/jobs/` (`?days=1\|7\|30`) | `GET /api/admin/jobs` |
| ระบบ | ระบบ Studio | `/admin/studio-system/` | `/api/admin/studio-system/*` |
| | ตั้งค่าระบบ | `/admin/system/` | `/api/admin/system/*` |
| | แจ้งเตือน LINE | `/admin/alerts/` | `/api/admin/alerts/*` |
| | ประวัติการจัดการ | `/admin/audit/` | `GET /api/admin/audit` |
| | บอทขายของ LINE | `/admin/bot/` (was `/admin/` until the overview took that path) | `/api/admin/products`, `orders`, … |

On phones the tab bar shows the four daily pages. The rest open from "เพิ่มเติม", a bottom sheet
built on the native `<dialog>`.

## How the numbers are counted (`src/admin/insights.ts`)

- **Days and months are Thailand days (UTC+7)**, as in `infra/postgres/init/03-reporting.sql`.
- **Revenue** counts successful payments only, on the day they were paid (`paid_at`, falling back to
  `created_at`). The payments list and the CSV filter on the day each payment was *created*.
- **Packages in force** follow the billing rule: `status = 'active'`, and `expires_at` is empty or in the
  future. The free plan is not counted as a package.
- **Credits used** are holds minus refunds (`job_hold`/`job_refund` for naka-ai,
  `studio_hold`/`studio_refund` for the studio). An open hold counts as used, matching
  `reporting.credits_used_by_user`.
- **Waiting payments** are `pending` payments that have not passed `expires_at`. A pending payment past
  its expiry shows as "หมดเวลา (รออัปเดต)" until the billing cron marks it expired.
- **Failed naka-ai jobs** come from `jobs` (status `failed`). "Refunded" means a `job_refund` ledger row
  exists. `failJob` writes that row once, when the last attempt fails.
- **Failed studio tasks** come from the studio's own `GET /api/v1/system/failed-tasks` (admin only,
  called server to server with `STUDIO_ADMIN_TOKEN`). The studio stores the naka-ai user id in
  `owner_user_id`, and the page shows the customer's name next to it. Prompts never leave the studio.
  An older studio has no such route and answers with its HTML app. The page then says the studio needs
  updating; it never treats a missing answer as "nothing failed".

## CSV export

`GET /api/admin/payments.csv` applies the same filters as the list and returns at most 10,000 rows.
A larger result is refused with 413 ("เลือกช่วงวันที่ให้สั้นลง").

- The file starts with a UTF-8 BOM so Excel reads Thai correctly.
- Times are in Thailand time.
- A cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'`, so a
  customer's display name cannot run as a spreadsheet formula (OWASP CSV injection).

## LINE alerts (`src/admin/alerts.ts`, migration `0007_admin_alerts.sql`)

Admins receive alerts through the shop's own LINE OA (`LINE_CHANNEL_ACCESS_TOKEN`, webhook `/webhook/line`).

- **Pairing:** "เพิ่มผู้รับ" makes a six-digit code that is valid for ten minutes, and only its SHA-256 is stored.
  - The admin sends `แจ้งเตือน 123456` to the OA. The webhook adds that LINE account and replies.
  - This works even while the shop bot (`FEATURE_LINE_BOT`) is off.
  - Every wrong code counts against all open codes, and five wrong codes close them.
  - `หยุดแจ้งเตือน` from a recipient removes them. From anyone else it is an ordinary chat message.
- **The check** runs from the cron every five minutes and sends **one** message per run.
  - **Rules:** failed jobs (naka-ai and studio, last 30 minutes), naka-studio unreachable or holding
    "unknown" tasks, queued jobs waiting more than 15 minutes, failed payments (last 30 minutes), and
    optionally every successful payment.
  - **Repeats:** a problem that is still there is repeated after two hours.
  - **Recovery:** the studio and the queue also announce when they are back to normal.
  - **Payments:** successful payments are announced once each. Payments made before anyone paired are
    never replayed.
- **Cost:** every alert is a LINE push message and counts against the OA plan's monthly message quota.
- **Audit:** changes are recorded in `system_audit` under area `alert`: codes made, recipients added
  or removed, rules changed, and test messages.

## History of admin actions (`src/admin/audit.ts`)

`GET /api/admin/audit` merges `admin_audit` (one customer) and `system_audit` (settings, plans, studio
cancels, alerts), newest first, 50 per page. It filters by source, actor or a search. Neither table is ever
updated or deleted. Secret settings appear only as their last four characters.

## Site content (`src/content/*`, migration `0008_site_content.sql`, page `/admin/content/`)

**Showcase clips.** The cards written in `public/index.html` (`#reel`) stay there. A row in
`showcase_clips` can:
- hide a card;
- give it a place in the order;
- add an uploaded clip (MP4 up to 40 MB plus a JPG/PNG/WebP poster up to 3 MB). File types are checked
  from the file's bytes. Uploads are stored in `MEDIA` and served from `/showcase-media/showcase/<uuid>.*`
  with byte ranges.

`/` therefore goes to the Worker first (`run_worker_first` in wrangler.jsonc, the same rule in
`server/node.ts`). The server rewrites the gallery and the counts on its tabs.
- With no rows, or if the table cannot be read, the page is served exactly as written.
- The home page has no ETag, so a browser never keeps an old gallery after a 304.

**Announcements.** One line at the top of the pages that load `/account-menu.js` (home, `/app/`, login).
- **Which one shows:** the newest active announcement within its time window.
- **Public read:** `GET /api/announcement` is public, cached for 60 s, and still answers in maintenance
  mode.
- **Closing:** a customer can close an announcement for themselves (localStorage). A new announcement
  shows again.
- **Links:** must start with `https://` or be a page on this site.

All changes are recorded in `system_audit` under area `content`.

## Discount codes (`src/billing/coupons.ts`, migration `0009_coupons_staff.sql`)

Owners create codes on การเงิน → โค้ดส่วนลด.

- **What a code does:** takes 1 to 90 percent, or a fixed number of baht, off one checkout.
- **Optional limits:** some packages only, monthly or yearly only, a time window, a total number of uses,
  and a number of uses per customer.
- **Where customers use it:** they enter the code on `/app/billing/`. `POST /api/billing/coupon` shows the
  price after the discount.
- **The price:** fixed when the payment row is created, and Stripe is asked for exactly that amount. The
  payment stores `coupon_code` and `discount_satang`. The price never goes below 10 baht (Stripe's minimum
  for THB).
- **Counting uses:** a use counts while its payment is paid, or pending and not yet expired. A checkout
  left unpaid gives the use back by itself.
- **Race safety:** the code is checked again inside the `INSERT` of the payment, so two checkouts cannot
  both take the last use.
- **Where codes show:** in the payments list and the CSV. Codes only matter while online payment
  (`FEATURE_PAYMENTS` plus the Stripe keys) is switched on.

## Roles (`src/admin/auth.ts`, `src/admin/staff.ts`)

- **Owners** are the Google accounts in `ADMIN_EMAILS`, plus the `ADMIN_TOKEN` break-glass. They can do
  everything.
- **Support staff:** owners add them on `/admin/staff/`. Staff sign in with Google the same way. The
  server allows them, through `supportMay()`:
  - reading the back office, except the secret settings, the staff list and the LINE alerts;
  - customer care: credits, account status, password reset and per-customer features (not giving a
    package);
  - the LINE bot's products, orders and chats;
  - cancelling a stuck studio task.
- **Everything else** is refused with 403 (`reason: "role"`). That covers settings, prices, discount codes,
  site content, alerts, staff, and the bot's legacy unaudited credit route.
- **The menu** hides owner-only pages for support staff.
- **Removing staff** takes effect at their next request.

## Customer care tools (`src/admin/customer-tools.ts`, migration `0010_customer_tools.sql`)

**Notes and tags (โน้ตและป้าย).**
- Admins see them; the customer does not.
- Tags appear in the customer list, and `?tag=` filters the list.
- Support staff may add and remove both.

**Customer CSV.** `GET /api/admin/customers.csv?q=&tag=` gives the list as a CSV with the same search,
up to 20,000 rows. It uses the same Excel and formula safety as the payments CSV.

**Bulk credits (owners only).** `POST /api/admin/customers/bulk-credits` takes either `{ userIds }` (the
boxes picked in the list) or `{ tag }`, plus an amount and a reason.
- Each customer gets their own audit row and their own `grant` in the ledger, all in one transaction.
- The rows of one batch share a `bulk` id.
- One request covers at most 1,000 customers. Unknown or closed accounts are refused.

**PDPA (ข้อมูลส่วนบุคคล tab, owners only).**
- **Export:** `POST /:id/export { note }` downloads everything about the customer as JSON.
  - It covers their identities, packages, payments, receipts, credits, jobs, AI videos, uploads, pages,
    posts, inbox, features, admin notes and admin history.
  - It includes naka-studio's counts and latest works.
  - It never includes password hashes, sessions or page tokens.
  - The export is recorded in the customer's history (`export`).
- **Erase:** `GET /:id/erase-preview` shows what goes and what stays. `POST /:id/erase { confirm: <id>, note }`
  then erases.
  1. **Studio first.** naka-studio's `POST /api/v1/system/erase-member` deletes every row the member made,
     top-level and children (the studio has no foreign keys), in one statement, then their files under the
     storage folder. If the studio cannot be reached, nothing here changes.
  2. **naka-ai.** Identities, passwords, sessions, pages, posts, inbox, jobs, AI videos, uploads (and their
     `MEDIA` files), features, notes, tags and the package are deleted.
  3. **Kept for accounting and tax:** payments, receipts, the credit ledger and the admin history. The
     account keeps its id, loses its name and is closed. A pending payment is expired.
  4. **Record:** an `erase` entry lists what was removed and kept. A second erase is refused.
- Customer data outside these systems is not covered, for example LINE chats with the shop bot (keyed by
  LINE user id) or copies at Stripe.

## Reports (`src/admin/reports.ts`, page `/admin/reports/`)

`GET /api/admin/reports?months=2..24` reports by Thailand month.
- **Per month:** new customers, first-time payers, paying customers, revenue (counted on the day paid),
  packages that ended without renewal, and credits used (naka-ai and studio).
- **Funnel:** of the customers who signed up in the window, how many used credits and how many paid.
- **Usage:** metered feature use per month (`feature_usage`), and naka-ai jobs by kind with their
  failures.
- **Top customers:** the ten who paid the most.
- **Monthly revenue in force:** the packages active now, with a yearly package counted as a twelfth of
  ten months' price.

## Server status and backups (`src/admin/server-status.ts`, `server/server-info.ts`, page `/admin/server/`)

- **Cron:** every run writes a `cron` heartbeat (`runtime_heartbeats`, migration `0011`). More than three
  minutes without one shows as stopped.
- **The machine:** the Node server passes `env.SERVER_INFO` (process, disks, backups). There is none on
  Cloudflare, and the page says so.
- **Database:** total size, size per schema, the biggest naka-ai tables and the number of connections.
- **Backups:** the `backup` service in docker-compose.yml (`infra/backup/backup.sh`) works like this:
  - It runs `pg_dump` of the whole database every `BACKUP_EVERY_HOURS` (default 24) into the `pg-backups`
    volume, and keeps `BACKUP_KEEP_DAYS` (default 14).
  - A dump is written as `.partial` and renamed only when complete. Owners and grants are kept.
  - `last.json` records the latest run.
  - The landing mounts the volume read-only (`BACKUP_DIR`). The page warns when the newest backup is older
    than 36 hours or the last run failed.
  - Restore as the page shows: `docker compose exec backup pg_restore -d naka --clean --if-exists /backups/<file>`
    with the apps stopped. This was rehearsed in a throwaway container: each app owned its tables again and
    could read them.
  - Copy the volume off the machine too: a backup on the same disk does not survive the disk.
