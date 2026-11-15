# Architecture notes & rebuild roadmap

This is the "vibe-coded but deliberately shaped" version: use it daily, notice what hurts, then rebuild it from scratch while studying system design, databases and AWS. Each section ends with **what to study / rebuild**.

## 1. The data model is the product

Two facts per person drive everything:

| Table | Meaning | Mutability |
|---|---|---|
| `plan_blocks` + `block_participants` | what you *intended* to do, and with whom | editable |
| `time_entries` | what you *actually* did (closed intervals) | append-only (deletable by owner) |

Plus `timers` (one row per user: the live, in-progress session) and the usual `users`, `auth_sessions`, `workspaces`, `workspace_members`, `workspace_invites`, `projects`, `tasks`.

Every metric is interval math over these two sets (`lib/shared/report.ts`):

- **planned** = union of accepted blocks, clipped to time that has already passed
- **focus** = union of focus entries
- **on-plan** = planned ∩ focus → **adherence** = on-plan ÷ planned
- **lateness** = first focus inside a block − block start
- **score** = 50% adherence + 20% on-time starts + 30% task follow-through (deliberately simple, so you can argue with it)

Why the prototype's model broke: it stored one `sessions` row and *overwrote* `started_at` on resume, so paused-then-resumed time vanished from history. Now pause/stop close a segment into `time_entries`; history is never rewritten.

> **Study:** normalisation vs. event logs; "facts vs. state"; event sourcing (time_entries is a mini event log, `timers` is a projection). Try: rewrite reports as SQL (`tstzrange`, `range_agg`, `generate_series`) and compare to the TS version. Add a GiST index on `tstzrange(starts_at, ends_at)` and an **exclusion constraint** to enforce "no overlapping blocks" in the database instead of in code.

## 2. Request path

```
Browser ──fetch (cookie)──▶ Next.js route handler ──▶ service (business rules) ──▶ db.ts ──▶ Postgres
   ▲                                                                                       │
   └──────────── poll every 5–60s (timer 5s, live status 15s, calendar 30–60s) ◀──────────┘
```

- **Auth**: email + scrypt password hash; login creates a random 32-byte token; only `sha256(token)` is stored; the token lives in an httpOnly `SameSite=Lax` cookie (or `Authorization: Bearer` for future native/CLI clients).
- **Cross-device sync** = polling the server of record. Simple, robust, cheap at 2 users.
- **Concurrency**: timer actions run in a transaction with `SELECT … FOR UPDATE` on the user's `timers` row and are idempotent (pausing a paused timer is a no-op), so two devices can't corrupt state. Block creation checks overlaps inside the same transaction.
- **Time zones**: each user has an IANA zone; "a day" in reports is that user's local midnight-to-midnight (DST-safe, tested).

> **Study:** sessions vs. JWTs (why opaque tokens are revocable); CSRF and SameSite; isolation levels (what `FOR UPDATE` buys you vs. `SERIALIZABLE`; the overlap check is racy under READ COMMITTED without a lock or constraint, so find the race and fix it); polling vs. long-polling vs. SSE vs. WebSockets; connection pooling on serverless (why Supabase/Neon give you a *pooler* URL).

## 3. Known limitations (things you'll feel using it)

| Limitation | Why it's OK for now | Better design |
|---|---|---|
| Polling for live state | 2 users, a few req/min | SSE/WebSocket push; Postgres `LISTEN/NOTIFY` or Redis pub/sub fan-out |
| Reports computed on every request | tiny data | nightly materialised daily rollups (`daily_stats` table) + incremental updates; cache |
| No reminders when the app is closed | in-app toast + browser notification only while a tab is open | Web Push (service worker + VAPID) or email via a queue + scheduled worker (cron → SQS → Lambda) |
| One workspace per user (UI) | MVP scope; schema already supports many | workspace switcher; roles/permissions |
| No recurring blocks | "Copy previous day" covers routines | RRULE storage + expansion, exceptions |
| Honesty-based | by design | streaks, photo/notes check-ins, partner "confirm", anomaly flags (e.g. 14h focus day) |
| No rate limiting on login | private app | token bucket per IP/email (Redis), lockout, audit log |
| No offline mode | needs network | service worker + local queue of timer actions, replayed with idempotency keys |
| No password reset / email verification | 2 known users | email provider + signed one-time tokens |
| Migrations are forward-only | fine solo | expand/contract migrations, rollback plan |
| `pg` TLS uses `rejectUnauthorized: false` | managed poolers present certs Node may not chain | pin the provider CA |

## 4. Rebuild roadmap (≈2 weeks, keep using this app meanwhile)

Each step is a chance to replace one layer and compare.

1. **Days 1–2: Database first.** Re-derive the schema yourself. Add an exclusion constraint for overlaps, `tstzrange` columns, and write the daily report as one SQL query. Learn `EXPLAIN ANALYZE`; seed 1 year × 10 users and index for the calendar and report queries.
2. **Days 3–4: API design.** Write the API as a contract (OpenAPI) first. Separate the backend from Next.js (e.g. a Fastify/Hono or Go service). Add idempotency keys on timer actions. Rate-limit auth.
3. **Days 5–6: Real-time.** Replace polling with SSE. Then think about how it scales past one server: sticky sessions vs. a pub/sub layer.
4. **Days 7–8: Background work.** Daily/weekly report emails and block-start reminders: scheduler → queue → worker, with retries and exactly-once-ish delivery (dedupe table, like the prototype's `time_booking_reminders`).
5. **Days 9–11: AWS (if useful).** RDS Postgres (or Aurora Serverless v2), the API on ECS Fargate or Lambda + API Gateway, EventBridge Scheduler → SQS → Lambda for reminders, SES for email, CloudFront for the frontend, Secrets Manager for `DATABASE_URL`. Write it as IaC (CDK/Terraform). Compare the cost and complexity with Vercel + Neon honestly.
6. **Days 12–14: Observability & reliability.** Structured logs, request IDs, metrics (p95 latency for `/api/reports`), backups + a restore drill, a load test (k6) on the timer endpoint.

## 5. Where to change things

- New metric → `computeMemberReport` in `lib/shared/report.ts` (+ a test in `tests/report.test.ts`), add a row in `ROWS` in `app/(app)/reports/page.tsx`.
- New table/column → new file `db/migrations/00N_*.sql` (never edit an applied one).
- Swap the database → only `lib/server/db.ts` knows about drivers.
