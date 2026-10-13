# ภาพรวม Architecture ปัจจุบัน (ใช้ตัดสินใจก่อน implement feature)

**สถานะ:** 2026-10-12 · ตรงกับโค้ดบน `main` ที่ commit `8ae0bb38`
**ใช้เมื่อไร:** ก่อนเริ่มเขียนฟีเจอร์ใหม่ เพื่อตอบ 3 คำถาม — ฟีเจอร์นี้อยู่แอปไหน, แตะอะไรบ้าง, มีกฎอะไรที่ห้ามพลาด
**เอกสารนี้ไม่แทน:** `CLAUDE.md` ของแต่ละแอป (รายละเอียดการเขียนโค้ด) และ `docs/adr/` (เหตุผลของการตัดสินใจ) — เอกสารนี้คือแผนที่ที่ชี้ไปหาสองอย่างนั้น

---

## 1. แผนที่ระบบ

```
                            ลูกค้า (เบราว์เซอร์, Thai-first)
                                       │
         ┌─────────────────────────────┴─────────────────────────────┐
         ▼                                                           ▼
┌────────────────────────────────┐                   ┌────────────────────────────────┐
│ apps/landing  — naka-ai.com     │                   │ apps/studio  — Naka Studio      │
│ "ศูนย์บัญชี" (account hub)       │                   │ "เครื่องผลิต" (production engine)│
│                                │                   │                                │
│ Worker code รันบน Node + Docker │                   │ Hono (:5679) + Nuxt SPA         │
│ src/index.ts = chain เดียว      │                   │ core/ + modules/<7 เมนู>        │
│ public/ = HTML/CSS/JS ล้วน      │                   │ frontend/menus/<7 เมนู> (layers)│
│ cron * * * * * ใน process       │                   │ timer ของแต่ละ module           │
│                                │                   │                                │
│ บัญชี · ล็อกอิน · แพ็กเกจ        │                   │ Drama · Marketer · Product      │
│ เครดิต · Stripe · ใบเสร็จ        │                   │ Studio · Seller · Viral Clone   │
│ social · inbox · หลังร้าน        │                   │ Live · Social Auto Reply        │
└──────────────┬─────────────────┘                   └─────────────┬──────────────────┘
               │  role account_app                                 │  role studio_app
               ▼                                                   ▼
      ┌───────────────────────────── PostgreSQL 17 (database naka) ─────────────────────────┐
      │  schema account   ← landing เป็นเจ้าของ   │  schema studio  ← studio เป็นเจ้าของ       │
      │  schema reporting ← view อ่านอย่างเดียว (reporting_ro) สำหรับรายงานข้ามแอป           │
      └──────────────────────────────────────────────────────────────────────────────────────┘
                                       │
                            backup: pg_dump ทุก 24 ชม. (infra/backup/)
```

ทั้งหมดอยู่บน **host เดียว ด้วย `docker compose` ที่ root** — services: `postgres`, `landing`, `studio`, `backup` (ADR-0002, ADR-0004) ไม่มี RabbitMQ ไม่มี Redis: คิวงานอยู่ใน Postgres

---

## 2. ใครรับผิดชอบอะไร (กฎข้อแรกของการตัดสินใจ)

| เรื่อง | เจ้าของ | ห้าม |
|---|---|---|
| ตัวตนสมาชิก, session, ล็อกอินทุกแบบ | landing | studio ห้ามมีระบบล็อกอินของตัวเองในโหมดสมาชิก |
| แพ็กเกจ, การจ่ายเงิน, Stripe, ใบเสร็จ | landing | studio ห้ามแตะเรื่องเงินตรง ๆ |
| ยอดเครดิต + ledger | landing | studio เรียกได้เฉพาะ 3 function (`hold_credits` / `commit_hold` / `refund_hold`) |
| สิทธิ์ของแพ็กเกจ (entitlements) + โควตารายเดือน | landing | studio เรียกได้เฉพาะ `member_features` / `use_feature` / `release_feature` |
| ราคาเครดิตของแต่ละงาน | landing (`account.credit_prices`) | studio อ่านได้ (SELECT) เขียนไม่ได้ |
| แอดมินหลังร้าน (คนเดียว, Google ใน `ADMIN_EMAILS`) | landing | - |
| การผลิตสื่อ: ภาพ, วิดีโอ, ffmpeg, agent, สตอรีบอร์ด | studio | landing ห้ามอ่านตารางของ studio ตรง ๆ |
| ไฟล์สื่อที่ผลิต + workspace ของ agent | studio (volume `naka-drama-studio_naka-data`) | - |

**ทิศทางที่อนุญาต:** `account` เปิดประตูให้ `studio` (grant) — **ไม่ใช่ทางกลับ** ถ้า landing ต้องการข้อมูลของ studio ให้เรียก HTTP admin endpoint ของ studio เท่านั้น (ดู §4 ช่องทาง C)

---

## 3. เส้นทางของ request

### landing — chain เดียวใน `apps/landing/src/index.ts`

```
withSettings(env)            ← ค่าจาก /admin/system/ ทับ env (ทุก request และทุก cron tick)
  → www → APP_ORIGIN redirect
  → closedFeature            ← สวิตช์ FEATURE_* ปิดพื้นที่ทั้งระบบ → 503
  → handleStudioSso          ← server-to-server ไม่มี Origin จึงอยู่ก่อน handleAuth
  → handleAuth               ← /api/auth/*
  → ตรวจตาม prefix: /api/{affiliate,social,marketer,inbox,billing,receipts,works,me/*,onboarding}
                     /webhook/{stripe,meta,line}  ← ตรวจลายเซ็นของผู้ส่ง ไม่ใช้ session
                     /api/admin/*
  → ไม่ตรง → env.ASSETS.fetch (ไฟล์ static ใน public/)
```

กฎในแต่ละ prefix: request ที่เปลี่ยนข้อมูลและใช้ session ต้องมี `Origin` ตรงกับ origin ของตัวเอง → ไม่ตรงคือ 403
`requireUser(request, env)` คือตัวเช็ค session; `hasFeature` / `featureRefusal` คือตัวเช็คสิทธิ์

### studio — middleware stack ใน `apps/studio/backend/src/index.ts`

```
Basic Auth (เฉพาะโหมดผู้ใช้คนเดียว)  → cors → requestLogger → errorHandler
/api/v1/* :  requireSession      ← SSO session cookie 12 ชม. (หรือ X-Admin-Token)
             ownership           ← ทุก id ที่ request อ้าง ต้องเป็นของสมาชิกคนนั้น ไม่ใช่ → 404 E_FORBIDDEN_OWNER
             entitlementGuard    ← prefix ไม่อยู่ในแพ็กเกจ → 403 E_FEATURE_DISABLED
             adminGuard          ← API ตั้งค่าระบบ เฉพาะแอดมิน
  → core routes (tasks, upload, ai-configs, style-presets, prompts, agent, skills, settings, system, cinematic-techniques)
  → module routes (วนตาม src/modules.ts)
  → /static = DATA_ROOT · /admin → 301 /settings · อื่น ๆ = ไฟล์ของ frontend build
```

### 7 เมนูของ studio และ prefix ของมัน

| module | route prefix | feature key | import เมนูอื่นได้ |
|---|---|---|---|
| `drama` | `/dramas` `/episodes` `/storyboards` `/scenes` `/characters` `/props` `/merge` | `studio.drama` | — |
| `marketer` | `/campaigns` `/trending-videos` `/gallery` `/marketer` | `studio.marketer` | — |
| `product-studio` | `/studio` | `studio.product_studio` | `marketer` |
| `seller` | `/seller` | `studio.seller` | `marketer`, `product-studio` |
| `viral-clone` | `/clone` | `studio.viral_clone` | `product-studio` |
| `live` | `/live` | `studio.live` | — |
| `social` | `/social` | `studio.social` | — |

กฎนี้ถูกบังคับด้วย test `tests/module-boundaries.test.mjs` (รันใน CI): `core/` ห้าม import เมนู, เมนู import เมนูอื่นได้เฉพาะผ่าน `index.ts` และเฉพาะคู่ในตารางนี้

---

## 4. ช่องทางข้ามแอป — มีแค่ 4 ช่อง ห้ามสร้างช่องที่ 5 โดยไม่มี ADR

| | ช่องทาง | ใช้ทำอะไร | โค้ด |
|---|---|---|---|
| **A** | **SSO ผ่าน HTTP** — one-time code 60 วินาที → session cookie 12 ชม. | สมาชิกเข้า studio ด้วยบัญชี naka-ai | landing `src/auth/studio.ts` · studio `src/core/auth/naka-sso.ts` · test สัญญา `backend/tests/naka-sso.test.ts` · doc `apps/landing/docs/studio-sso.md` |
| **B** | **SQL function + view ใน schema `account`** (grant ให้ `studio_app`) | เครดิต: `hold_credits`/`commit_hold`/`refund_hold` · สิทธิ์: `member_features`/`use_feature`/`release_feature` · อ่าน: `users_public`, `credit_prices` | `apps/landing/migrations/pg/0002_shared.sql`, `0003_entitlements.sql`, `0006_credit_prices.sql` |
| **C** | **HTTP admin endpoint ของ studio** (`X-Admin-Token`, server→server, ไม่ follow redirect) | หลังร้านอ่านสถานะ studio: `/api/v1/system/overview`, `/api/v1/system/member-works`, `/api/v1/tasks/:id/cancel` | landing `src/admin/studio-system.ts`, `src/me/works.ts` · studio `src/core/routes/system.ts` |
| **D** | **view ใน schema `reporting`** (อ่านอย่างเดียว) | รายงานข้ามแอป: `revenue_by_day`, `credits_used_by_user`, `active_subscriptions` | `infra/postgres/init/03-reporting.sql` |

**ข้อห้ามที่สำคัญ:** ไม่มี foreign key ข้าม schema · studio อ่าน/เขียนตาราง `account` ตรง ๆ ไม่ได้ (role ปิดไว้ และมี test ที่ `infra/postgres/tests/` ยืนยัน) · test สัญญา SSO อ่าน source ของ landing ในโค้ดชุดนี้ → **แก้ SSO ต้องแก้สองฝั่งใน commit เดียวกัน**

### ลำดับเมื่อ studio สร้างงานที่มีค่าใช้จ่าย (จำลำดับนี้ให้ได้)

```
1. useVideoQuota        ← นับโควตา ก่อน
2. taskCredits          ← อ่านราคา (นอก transaction)
3. transaction เดียว:  INSERT sys_task → hold_credits(owner, credits, 'studio:<kind>:<task id>')
4. เครดิตไม่พอ → ok=false → rollback + คืนโควตา → E_CREDITS_INSUFFICIENT
5. จบงาน: completed → commit_hold · failed/cancelled/deleted → refund_hold · unknown → ถือค้างไว้
```
คนที่จ่ายและคนที่ถูกนับโควตา = **เจ้าของโปรเจกต์** (`owner_user_id` ที่ stamp ลงงาน) เสมอ รายละเอียด: `docs/credit-pricing.md`

---

## 5. งานเบื้องหลัง — สองกลไก ไม่เหมือนกัน

| | landing | studio |
|---|---|---|
| กลไก | ตาราง `jobs` + lease/fencing, cron `* * * * *` ใน process | `sys_task` / `pipeline_tasks` + promise ในหน่วยความจำ + กู้งานตอนบูต |
| ลงทะเบียนงานใหม่ | `jobHandlers(env)` ใน `src/jobs.ts` ตาม `kind` | `StudioModule.failStale` / `resume` / `start` ของแต่ละเมนู (`src/modules.ts` = ลำดับการกู้) |
| ควบคุมความล้มเหลว | `PermanentJobError` = ไม่ retry · `JobDeferredError` = retry ทีหลัง · เครดิตคืนครั้งเดียวเมื่อ fail ถาวร | `startTask` = mutex ต่อ key (กัน "already running") · adapter ของ provider |
| งานที่ cron ทำ | queue, โพสต์ social, billing (หมดอายุ + เติมเครดิตรายเดือน), backfill ใบเสร็จ, drain inbox, sync trending (นาทีที่ 7) — แต่ละอันเป็น `ctx.waitUntil` ของตัวเอง | poller ของ social ทุก 5 นาที (`modules/social/services/poller.ts`) |

**ผลต่อการตัดสินใจ:** งานเบื้องหลังที่เกี่ยวกับ **บัญชี/เงิน/ข้อความลูกค้า** → ทำเป็น job kind ใน landing · งานที่เกี่ยวกับ **การผลิตสื่อ** → ทำเป็น task/module timer ใน studio
studio ยังเป็น **instance เดียว** (คิวอยู่ในหน่วยความจำ) — การแยก render container รออยู่ใน ADR-0004 Phase 3 (pg-boss)

---

## 6. ตารางตัดสินใจ: ฟีเจอร์แบบนี้ → ทำที่ไหน แตะอะไร

| อยากทำ | ทำที่ | checklist |
|---|---|---|
| **เมนูผลิตสื่อใหม่ของ studio** | studio | ① `src/modules/<menu>/` + `index.ts` ที่ export `StudioModule` ② ลงทะเบียนใน `src/modules.ts` (ตำแหน่งในลิสต์ = ลำดับการกู้งาน) ③ `ALLOWED` ใน `tests/module-boundaries.test.mjs` ④ `ROUTE_FEATURES` ใน `core/auth/entitlements.ts` ⑤ แถว feature ใน `apps/landing/migrations/pg/0003_entitlements.sql` ⑥ `frontend/menus/<menu>/` + `MENUS` ใน `menus/index.ts` ⑦ `menuAllowed` ของ sidebar |
| **พื้นที่ใหม่บน naka-ai.com** | landing | ① `src/<area>/index.ts` ที่ export `handleX(request, env, url, …)` คืน `null`/`Response` ② เสียบใน chain ของ `src/index.ts` ③ เช็ค `Origin` ถ้าเปลี่ยนข้อมูล ④ `requireUser` ⑤ หน้า HTML ใน `public/<area>/` ⑥ feature key ถ้าต้องคุมตามแพ็กเกจ |
| **ตารางใหม่** | เจ้าของข้อมูล | landing: `apps/landing/migrations/pg/NNNN_*.sql` (SQL ยังเขียนแบบ SQLite `?` ได้) · studio: `apps/studio/backend/migrations/pg/NNNN_*.sql` **+ แก้ `schema.ts` ให้ตรง** · ไฟล์ที่ apply แล้วห้ามแก้ · studio: ตาราง top-level ต้องมี `owner_user_id` + entry ใน `OWNER_SQL`/`PATH_KINDS` + filter ใน list query |
| **ค่าตั้งค่าใหม่ / สวิตช์ปิด-เปิด** | landing | `src/system/registry.ts` (เท่านั้นที่แก้ได้จาก `/admin/system/`) · อ่านด้วย `featureOn(env, "FEATURE_…")` · doc `apps/landing/docs/system-control.md` |
| **สิทธิ์/โควตาใหม่ของแพ็กเกจ** | landing (SQL) | แถวใน migration `features` + `plan_features` → จุดที่เรียก `useFeature` ก่อน `enqueueJob` และ `releaseFeature` เมื่องานเริ่มไม่ได้ · ฝั่ง studio เพิ่มใน `ROUTE_FEATURES` · doc `docs/entitlements.md` |
| **งานใหม่ที่ต้องหักเครดิต** | ทั้งสอง | แถวใน `account.credit_prices` (migration) + หน้าแอดมิน → เรียก `taskCredits` + `holdTaskCredits` ที่ **จุดสร้างงาน** · 0 = ฟรี ไม่สร้าง hold · ปัดขึ้นเป็นจำนวนเต็มเสมอ |
| **provider AI เจ้าใหม่** | studio | adapter ใน `core/ai/adapters` (ภาพ: openai/gemini/volcengine · วิดีโอ: volcengine/minimax) · config เก็บในตาราง `ai_service_configs` ตั้งจาก `/settings?tab=ai` **ไม่ใช่ไฟล์ config** |
| **เครื่องมือใหม่ให้ AI agent** | studio | `modules/<menu>/agent-tools.ts` เรียก `registerAgentTools(type, tools)` ตอน import + service ของเมนูต้อง import ไฟล์นั้นก่อนรัน agent · prompt/skill แก้ออนไลน์ได้ที่ `backend/workspace/` |
| **ช่องทางโซเชียลใหม่** | ขึ้นกับงาน | ตอบคอมเมนต์อัตโนมัติ → adapter ใน `studio/modules/social` (`types.ts`, `registry.ts`) · โพสต์ตามเวลา/inbox → `landing/src/social`, `landing/src/inbox` |
| **หน้า/ตัวเลขใหม่ในหลังร้าน** | landing | `public/admin/` + `src/admin/*` · ข้อมูลของ studio ต้องผ่านช่องทาง C เท่านั้น |
| **รายงานข้ามแอป** | SQL | view ใน `infra/postgres/init/03-reporting.sql` + re-run หลัง migration ที่เปลี่ยนตารางที่มันอ่าน |

---

## 7. กฎที่พลาดบ่อย (อ่านก่อนเขียนโค้ด)

**landing — adapter D1-บน-Postgres (`src/db/pg-d1.ts`)**
เขียน SQL แบบเดิมได้ แต่สิ่งเหล่านี้ **ไม่ทำงาน**: `MIN/MAX(a,b)` แบบ scalar (ใช้ `LEAST/GREATEST`), integer เป็น boolean (ใช้ `?N = 1`), `IS ?` (ใช้ `IS NOT DISTINCT FROM`), `changes()`, `PRAGMA`, `sqlite_master`, `printf`, `? IS NULL` ที่ไม่ระบุ type (ใช้ `?::text IS NULL`), ชื่อ column เปล่าใน `ON CONFLICT DO UPDATE` (ต้อง qualify)
**ทุก write ถูก serialize ด้วย advisory lock เดียว** (`WRITE_LOCK_KEY` 72040002) เพราะการเช็คโควตา/ยอดเขียนเป็น statement เดียวแบบ `INSERT … SELECT … WHERE count < limit` — ถ้าเปลี่ยน key นี้ต้อง migrate function เครดิตไปพร้อมกัน

**studio — concurrency**
ทุก DB call คือ I/O จริง อ่านแล้วเขียนต่อกัน **ถูกแทรกได้** (ต่างจาก better-sqlite3 เดิม) วิธีแก้: statement เดียว (`ON CONFLICT`, `UPDATE … WHERE … RETURNING`) หรือ `db.transaction` + `pg_advisory_xact_lock` ที่ **ทุก query ต้องผ่าน `tx`** (PGlite มี connection เดียว: query บน `db` ตัวนอกระหว่าง transaction เปิดอยู่ = รอตลอดไป) · test: `tests/concurrency.test.ts`

**studio — งบจำนวน query**
`tests/query-budget.test.ts` กำหนดเพดาน statement/row ของ endpoint ที่โดนบ่อย: ห้าม `db.select().from(table)` แล้วกรองใน JS (อ่านแถวของสมาชิกคนอื่นทั้งหมด) · ใช้ `inArray(…ids)`, รวม read ที่ไม่ขึ้นแก่กันใน `Promise.all` เดียว, batch การ lookup ต่อชิ้น · column ที่ใช้กรองต้องมี index ใน migration

**studio — ownership**
ตาราง top-level ทุกตารางมี `owner_user_id` (stamp จาก AsyncLocalStorage ตอน insert) ลูกไล่ผ่าน parent · ลืม entry ใน `OWNER_SQL`/`PATH_KINDS` = ข้อมูลรั่วข้ามสมาชิก

**ทั้งสองแอป — Drizzle บน Postgres ไม่มี `.get()/.all()/.run()`**: ใช้ `const [row] = await db.select()…`, id จาก `.returning({ id })` + `insertedId`, boolean เป็น `true/false`

**UI:** landing มี design brief บังคับ (`.ui-craft/brief.md`, `tokens.md`) — ขาว/โคบอลต์, ไทยมาก่อน, **ห้ามใส่ตัวเลข proof/ราคา/integration ที่ไม่มีจริง** · studio ใช้ CSS ล้วน ไม่มี UI framework

---

## 8. ทดสอบและ deploy

| | คำสั่ง | หมายเหตุ |
|---|---|---|
| landing | `npm run test:landing` (root) | `node --test`, Postgres ใน process ด้วย PGlite — ไม่ต้องใช้ Docker |
| landing (ของจริง) | `npm run test:pg` ใน `apps/landing` | ต้องมี `TEST_DATABASE_URL` |
| studio backend | `cd apps/studio/backend && npx tsx --test tests/*.test.ts tests/*.test.mjs` | `DATABASE_URL=pglite://memory` |
| studio frontend | `cd apps/studio/frontend && node --test tests/*.test.mjs` | |
| สิทธิ์ของ DB | `npm run test:db` (root) | PGlite, ยืนยันว่าแต่ละ role แตะได้แค่ schema ของตัวเอง |
| CI | `.github/workflows/`: `landing-ci.yml`, `studio-ci.yml`, `db-ci.yml` | แต่ละตัวรันเฉพาะเมื่อไฟล์ของตัวเองเปลี่ยน |
| deploy | `docker compose up -d --build` ที่ root (ทีละแอป: `… --build studio`) | ไม่มี `npm` workspace ร่วม — `npm ci` ใน app (หรือ sub-app) ที่ทำงานด้วย |

migration ของทั้งสองแอป apply **ตอนบูต** ใต้ advisory lock ไฟล์ละครั้ง → การ deploy คือการ restart container ไม่มีขั้นตอน migrate แยก

---

## 9. ช่องว่างที่ต้องรู้ก่อนวางแผน (ข้อจำกัดจริงของวันนี้)

| # | เรื่อง | ผลต่อการตัดสินใจ |
|---|---|---|
| 1 | **ADR-0004 Phase 3 ยังไม่จบฝั่ง studio** — `studio.users` ยังเป็นสำเนา (ยังไม่ใช้ view `account.users_public`), คิวงานยังอยู่ในหน่วยความจำ (ยังไม่ใช้ pg-boss) | ชื่อ/อีเมลที่เปลี่ยนบน landing ยังไม่ตามไป studio · studio ขยายเป็นหลาย instance ยังไม่ได้ |
| 2 | **studio รัน instance เดียว** | ฟีเจอร์ที่ render หนักจะชนกับ request ปกติ ถ้าจะแยก worker ต้องทำข้อ 1 ก่อน |
| 3 | **hold เครดิตของงานสถานะ `unknown` ไม่มี cron คืนอัตโนมัติ** | ตอนนี้แอดมินยกเลิกเองจาก `/admin/studio-system/` ถ้าฟีเจอร์ใหม่ทำให้ `unknown` เยอะ ต้องทำ sweep ก่อน |
| 4 | **งานข้อความ (LLM) ของ studio ยังไม่คิดเครดิต** | ฟีเจอร์ที่เป็น LLM ล้วนจะฟรีโดยปริยาย ถ้าไม่เพิ่มแถวใน `credit_prices` |
| 5 | **งานเบื้องหลังของ landing ไม่เคารพการปิดสิทธิ์ย้อนหลัง** — ตอบ inbox/โพสต์ตามเวลา ยังทำงานต่อสำหรับลูกค้าที่ถูกปิดฟีเจอร์ภายหลัง (ปิดแค่การสั่งงานใหม่ผ่าน API) | ฟีเจอร์ที่คิดเงินตามการใช้จริงต้องเช็คสิทธิ์ที่ตัว job ด้วย ไม่ใช่ที่ route เท่านั้น |
| 6 | **`studio.live` (AI Live) อยู่ในโครงแล้ว แต่ไม่มีแพ็กเกจเริ่มต้นใดรวมไว้ ยกเว้น business/max** | ถ้าจะโปรโมต ต้องตัดสินใจเรื่องแพ็กเกจ |

---

## 10. ไปอ่านที่ไหนต่อ

| อยากรู้ | ไฟล์ |
|---|---|
| วิธีเขียนโค้ดในแต่ละแอป | `apps/landing/CLAUDE.md` · `apps/studio/CLAUDE.md` |
| เหตุผลของโครงปัจจุบัน | `docs/adr/0001` (ขอบเขตบริการ) · `0002` (Docker) · `0003` (modules ของ studio) · `0004` (DB ร่วม, คิว) |
| สิทธิ์และโควตา | `docs/entitlements.md` |
| เครดิตและราคา | `docs/credit-pricing.md` |
| SSO | `apps/landing/docs/studio-sso.md` |
| ค่าตั้งค่าระบบ | `apps/landing/docs/system-control.md` |
| หลังร้าน | `apps/landing/docs/admin-backoffice.md` |
| ความปลอดภัย (ตรวจล่าสุด) | `apps/landing/docs/security-audit-2026-10.md` |
| คำศัพท์ของ studio | `apps/studio/CONTEXT.md` |

**เมื่อแก้โครง** — ถ้าการตัดสินใจขัดกับ ADR ใด ให้เขียน ADR ใหม่ใน `docs/adr/` ก่อนลงมือ อย่าแก้ ADR เดิมเงียบ ๆ
