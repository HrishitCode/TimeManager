# Rebuilding Time Manager from scratch: a system design curriculum

You'll keep using v1 (this repo) every day while you build v2 from an empty folder. v1 is your
**reference implementation and your requirements doc**: whenever you're unsure what v2 should do, use v1.

The goal is not to re-type this code. It's to be able to explain, for every part of the system:
**what problem it solves → which options exist → which one we picked → why → when that choice breaks.**

How to use this guide:

1. Work through the parts in order. Each one ends with **Do** (build it) and **Break it** (prove the limit exists).
2. For every decision, write a short ADR (Architecture Decision Record) in `v2/docs/adr/NNN-title.md`:
   ```
   # 007 Timer state in its own table
   Context: …   Options: …   Decision: …   Consequences / when to revisit: …
   ```
   Writing them is the learning. Section 13 lists the v1 decisions as a starting set.
3. Keep a **friction log** from daily use of v1. Each entry is either a requirement or a design flaw for v2.

---

## Part 0: The system on one page (memorise this)

```
            ┌──────────── browser / phone (PWA) ────────────┐
            │  React UI ── useApi() polls every 5–60s       │
            └──────────────┬────────────────────────────────┘
                           │ HTTPS, cookie (or Bearer token)
            ┌──────────────▼────────────────────────────────┐
            │  Next.js route handlers (Vercel, serverless)  │
            │   route() → zod validation → service → db.ts  │
            └──────────────┬────────────────────────────────┘
                           │ SQL over a pooled connection
            ┌──────────────▼────────────────────────────────┐
            │  Postgres (Neon) — the single source of truth │
            │  users · auth_sessions · workspaces · members │
            │  plan_blocks · block_participants             │
            │  timers (live state) · time_entries (facts)   │
            └───────────────────────────────────────────────┘
```

Everything the product does reduces to **two sets of time intervals per person**:
- **Plan:** accepted blocks. What you said you'd do.
- **Reality:** time entries. What you actually did.

Reports are interval maths between those two sets. Hold onto this idea; most of v2's design follows from it.

---

## Part 1: Requirements and estimates (always the first step)

### Functional requirements (what v1 does today)
- Accounts, a shared workspace, invite links.
- Plan blocks on a calendar; invite partners; accept or decline; no overlapping blocks.
- Timer: start, pause, resume, stop, "I actually stopped at…"; manual logging.
- Opt time out of reports (office hours).
- Live "what is my partner doing"; daily and weekly comparison reports with verdicts.
- Works across devices.

### Non-functional requirements (decide these explicitly, because they drive the design)
| Property | v1 target | Why it matters here |
|---|---|---|
| **Durability** | Never lose tracked time | It's the product. Losing an hour of focus destroys trust. |
| **Correctness** | One timer per user, no overlapping blocks | Two devices and double taps must not corrupt state. |
| **Freshness** | Partner sees changes in < ~15s | Accountability needs "now". |
| **Latency** | Timer actions < 300ms | It's a button you press while impatient. |
| **Availability** | "Mostly up" | It's not a bank. One region is fine. |

### Back-of-envelope (do this by hand, then compare)
Pretend v2 has **10,000 users**, with **2,000 tabs open at peak**.

- **Writes.** About 30 timer actions and 10 block edits per user per day gives 400k writes/day, or roughly **5/s on average**. Peaks run about 10× that: **~50/s**. Postgres handles that trivially.
- **Storage.** About 15 time entries per user per day: 10k × 15 × 365 ≈ **55M rows/year**. At about 200 bytes each with indexes, that's **~11 GB/year**. Fine, but enough to need indexes and to stop scanning raw rows for yearly reports.
- **Polling (the surprise).** One open Today tab makes about 0.33 req/s:
  - timer every 5s: 0.2
  - status every 15s: 0.067
  - four other things once a minute: 0.067

  2,000 tabs × 0.33 ≈ **660 req/s**, most of them asking "anything new?" and getting "no". Each request also runs an auth lookup plus several queries, and `/api/status` runs a full day report *per member*.

  👉 **Reads from polling are 100× the real writes.** This single number justifies Part 6 (push instead of poll).

**Do:** write your own numbers for 2, 1,000, and 100,000 users. Note at which scale each part of v1 breaks.

---

## Part 2: The data model ("facts vs. state")

This is the most important part. Get the data model right and everything else is replaceable.

### Decision: the live timer and history are separate tables
- **Problem.** The original Supabase prototype stored one `sessions` row and **overwrote `started_at` on resume**. Every pause/resume silently deleted history.
- **Options.**
  1. One mutable row per session (the prototype). Simple, but it loses history.
  2. A mutable `timers` row plus append-only `time_entries` (v1).
  3. A full event log (`timer_events`: start/pause/resume/stop) with everything derived from it (event sourcing).
- **Chose (2).**
  - `timers` = **state**: at most one row per user (the primary key enforces it). It's what devices poll.
  - `time_entries` = **facts**: each closed segment of real time, written once. Reports read *only* facts.

  A crashed tab or a second device can at worst affect the live row, never history.
- **When to revisit.** If you want an audit trail ("who paused it, from which device"), or offline clients that send events later, go to (3). In v2, consider also storing `timer_events` and **deriving** both tables from them. That's a small event-sourcing system. Read DDIA ch. 11 ("Event Sourcing").

### Decision: the organiser is also a participant
- `plan_blocks` (one row per block) plus `block_participants` (user, status). **The owner always has an `accepted` row.**
- **Why.** "My calendar" becomes one uniform query: *blocks where I'm an accepted participant*. Without this you'd write `owner_id = me OR (exists participant…)` everywhere and get it wrong somewhere.
- **Alternative.** A `participant_ids uuid[]` column. Simpler writes, but no per-person status and no foreign keys, and querying "everything Ben accepted" is awkward.

### Decision: store instants in UTC; compute "days" in each person's time zone
- Columns are `timestamptz`; each user has an IANA `timezone`. A "day" in a report is *that user's* local midnight to midnight, and it's DST-safe (see `zonedMidnight`, tested against New York's 23-hour day).
- **Why.** Partners can live in different zones, people travel, and DST makes some days 23 or 25 hours. Storing local dates looks simpler and is always eventually wrong.

### Decision: UUID primary keys
- **Why.** They're unguessable in URLs, they can be generated on the client (useful for offline and idempotency), and they're safe to merge across databases.
- **Cost.** Random UUIDv4 values scatter B-tree inserts. **v2:** use UUIDv7 (time-ordered). Learn why with `EXPLAIN` and index bloat.

### Decision: `ON DELETE` behaviour encodes product rules
- User → everything `CASCADE` (deleting an account removes its data).
- Project → tasks, blocks and entries `SET NULL` (deleting a project keeps your history as "No project", so report totals don't change).
- **Lesson.** Referential actions *are* business logic. Decide them deliberately.

### Decision: opt-out is a flag, and an excluded block removes its whole window
- `include_in_reports` on blocks, entries and timers. An excluded *block* removes its window from both plan and reality, so office work tracked during office hours doesn't count.
- **Alternative.** A separate `report_exclusions(user, tstzrange)` table. That's cleaner if exclusions ever stop being tied to blocks (e.g. "always exclude 09:00–18:00 on weekdays").

### Decision: an entry stores both `task_id` and `project_id`
- Logging forgotten time lets you pick a **task**; the server copies that task's project onto the entry if you didn't choose one.
- **Why store `project_id` when it's derivable from the task?** It's a deliberate **snapshot**. Tasks can move between projects or be deleted, and "where did my time go last March" must not change when you reorganise tasks today. This is controlled denormalisation: history records what was true *at the time*.
- **The cost.** Two sources of truth that can disagree. v1 accepts that, because the entry is the historical fact and the task is current state. Same split as `timers` vs `time_entries`.
- **Exercise.** In v2 decide per column: snapshot (copy at write time) or reference (join at read time)? Do the same for names, colours and time zones.

### Decision: each user has a "day window"
- `users.day_start_min` / `day_end_min`, default 07:00–23:00, and the end may pass midnight. It defines **countable time** (Part 7).
- **Why on the user rather than in a calendar table?** It's a per-person preference that changes rarely. A real v2 would want per-weekday windows ("weekends 09:00–01:00"), which becomes a small table, and later something like recurring availability (RRULE again).

### v2 upgrades to the data model (each is a DB lesson)
| Upgrade | What you learn |
|---|---|
| `during tstzrange` columns instead of `starts_at`/`ends_at` | Range types, `&&`, `@>`, `range_agg` (Postgres 14+) |
| `EXCLUDE USING gist (user_id WITH =, during WITH &&)` on a per-user calendar table | Making the **database** forbid overlaps (see Part 3) |
| `CHECK` constraints for state machines (v1 already has `status='running' ⇔ segment_started_at is not null`) | Pushing invariants down to where they can't be bypassed |
| Composite indexes `(user_id, started_at)` | Index-only scans, column order, `EXPLAIN (ANALYZE, BUFFERS)` |
| Soft delete (`deleted_at`) vs. hard delete | Undo, audit, GDPR trade-offs |

**Do:** design the v2 schema **on paper first**, then in SQL, without looking at `db/migrations/001_init.sql`. Compare afterwards.
**Break it:** seed 1 year × 100 users (≈550k entries), then run the weekly report query with and without indexes, using `EXPLAIN ANALYZE`.

---

## Part 3: Concurrency and correctness

"Two requests at the same time" is where most real bugs live. v1 has examples of every pattern, including a bug.

### Pattern 1: lock the row, then decide (`SELECT … FOR UPDATE`)
- The timer service locks the user's `timers` row before reading it. Two devices pressing Pause run one after the other, not interleaved.
- Invite codes: `FOR UPDATE` on the invite row means one code can't be redeemed twice.

### Pattern 2: idempotent commands
- Pausing a paused timer is a no-op, not an error. Mobile networks retry and people double-tap. **An action that is safe to repeat is safe on a flaky network.**
- **v2.** Add **idempotency keys**: the client sends `Idempotency-Key: <uuid>`, and the server stores (key → response) and replays it on retry. This is how payment APIs work.

### Pattern 3: the server's clock is the truth
- The timer computes elapsed time from server timestamps. The client measures its own clock skew from `server_now` and corrects for it. Otherwise a phone with a wrong clock would show a wrong timer.

### Known races in v1 (your exercises)
1. **Overlapping blocks.** `createBlock` runs "is there an overlap?" and then `INSERT` in one transaction, but under **READ COMMITTED** two concurrent transactions can both see "no overlap" and both insert. This is a classic *write skew* (DDIA ch. 7).
   - Fixes, from weakest to strongest:
     - per-user advisory lock (`pg_advisory_xact_lock(hash(user_id))`)
     - `SERIALIZABLE` isolation plus a retry loop
     - an **exclusion constraint** (the database makes it impossible)
   - Trade-off: the constraint is per-row, but shared blocks belong to several calendars. That pushes you toward a `calendar_entries(user_id, block_id, during)` table. A good modelling exercise.
2. **First timer start.** `FOR UPDATE` can't lock a row that doesn't exist yet. Two simultaneous first starts both try `INSERT INTO timers` and one hits a primary-key violation (a 500 error).
   - Fix: `INSERT … ON CONFLICT DO NOTHING` before locking, or upsert.

**Do:** write a test that fires 20 concurrent overlapping `createBlock` calls against real Postgres (not PGlite, which has only one connection, so races can't happen there). Watch it fail. Fix it with an exclusion constraint. Write the ADR.

---

## Part 4: API design

### Decision: thin routes, fat services
- Each `route.ts` only parses and validates (zod), calls a service, and returns JSON. Business rules live in `lib/server/services/*`, which has no HTTP in it.
- **Why.** Services can be tested directly against a real database (see `tests/services.test.ts`), and the HTTP layer is replaceable. You can lift the services into a separate backend in v2 almost unchanged.

### Decision: the timer API is a *command* endpoint, not REST CRUD
- `POST /api/timer {action: "start" | "pause" | "resume" | "stop" | "set_include"}` instead of `PATCH /timer {status: "paused"}`.
- **Why.** The timer is a **state machine**, and each transition has side effects (closing a segment writes a `time_entry`). Commands say *what happened*. A generic PATCH invites invalid transitions.
  ```
  (none) ──start──▶ running ──pause──▶ paused
     ▲               │  ▲               │
     └────stop───────┘  └────resume─────┘   (stop from paused too)
  ```
- **v2.** Draw every state machine in the product (timer, invite, block participation) before coding.

### Decision: bound every query
- `/api/blocks` refuses ranges over 45 days. **Why:** the cost of a request must be bounded by the server, not by whatever the client asks for.

### v2 API work
- Write the contract first as **OpenAPI**, generate types for client and server, and version it.
- Consistent error shape: `{error, code, details}`. v1 has `{error}`, plus an `overlap` field on 409 conflicts.
- Pagination with cursors (for history lists).
- **Designing for a second client.** The Shortcuts/Apple Watch `toggle` endpoint is your first non-browser client. Notice how its needs (plain text, one call, token auth) differ from the web UI's.

---

## Part 5: Authentication and authorisation

### Decision: opaque session tokens, stored hashed
- Login creates 32 random bytes. The database stores only `sha256(token)`. The browser holds the token in an **httpOnly, SameSite=Lax** cookie.
- **Why not JWT?**
  - Opaque tokens are **revocable** (delete the row) and carry nothing secret.
  - JWTs avoid a database lookup per request but are hard to revoke before expiry.
  - At this scale the lookup is cheap.
  - **Learn:** when JWTs *are* right (many services verifying identity without sharing a database).
- **Why hash the token?** A leaked database dump must not contain live sessions. It's the same reason passwords are hashed.
- **Passwords:** scrypt (memory-hard, so GPUs struggle) with a per-user salt and a timing-safe compare.
- **Cookie vs. Bearer.** Browsers use the cookie; other clients (Shortcuts, a native app) send `Authorization: Bearer`. Same tokens, same table.
- **CSRF.** SameSite=Lax stops other sites' forms from carrying your cookie on POSTs. Learn what Lax still allows (top-level GET navigations), which is why GET must never change state.

### Decision: authorisation lives in queries
- Every query is scoped (`where user_id = $me`). Workspace visibility goes through one function, `visibleUserIds()`.
- **The irony to study:** Supabase protected data with Postgres **Row Level Security**. v1 dropped Supabase but RLS is a *Postgres* feature, not a Supabase one.
  - **v2:** set `app.user_id` per transaction and add RLS policies as **defence in depth**, so a forgotten `WHERE` can't leak your partner's data.

### v2 additions
- Rate limiting on login (token bucket per IP and per email).
- Password reset with signed, single-use, expiring tokens.
- **Personal access tokens:** scoped, named, revocable, and "last used at".
- Audit log of auth events.

---

## Part 6: Sync and real-time (the biggest architectural upgrade)

### Decision (v1): polling
- **Why it was right for v1.**
  - Zero infrastructure.
  - Works on serverless, where functions can't hold connections.
  - Stateless and self-healing: a missed update arrives on the next poll.
  - Fine for 2 users.
- **Why it breaks.** Part 1's estimate: about 660 req/s of mostly "nothing changed" at 2,000 tabs. Freshness is bounded by the interval: the timer is up to 5s stale, partner status up to 15s.

### Options for v2
| Technique | Direction | Notes |
|---|---|---|
| Long polling | server → client | Easy step up; still one request per update |
| **Server-Sent Events (SSE)** | server → client | Plain HTTP, auto-reconnect, perfect for "something changed" |
| WebSockets | both ways | More power, more complexity; not needed when writes go via REST |
| Push notifications (Web Push / APNs) | server → device, app closed | For reminders, not for live UI |

### Recommended v2 design: "events invalidate, REST reads"
```
write (REST) ─▶ Postgres ─▶ NOTIFY workspace_<id> ─▶ API server(s) ─▶ SSE ─▶ clients
                                                                      clients refetch via REST
```
- The event says *what changed* (`{type: "timer", user_id}`), not the data. The client refetches. The server stays the single source of truth, and a lost event costs one refetch, never corruption.
- **One server:** Postgres `LISTEN/NOTIFY` is enough.
- **Many servers:** each holds some SSE connections, so you need **fan-out**: Redis pub/sub (or NATS) with a channel per workspace. This is the classic "chat system" design, and worth sketching on paper.
- **Serverless caveat:** long-lived connections need a stateful tier (a container on ECS or Fly) or a managed service (API Gateway WebSockets, Ably, Pusher). This is a real platform decision; write the ADR.

### Offline (stretch)
- The client queues commands with idempotency keys and replays them on reconnect. The server decides conflicts (last write wins on the timer; validation on blocks).
- Think about trust: a client-supplied `started_at` for offline starts is an honesty and abuse vector. That's a good discussion for your ADR.

---

## Part 7: The read path and reports

### Decision: the comparison answers three separate questions
**Problem.** v1's first comparison was one composite score: 50% plan adherence, 20% punctuality, 30% tasks. A percentage hides *amount*. Someone who plans 30 minutes and keeps them scores 100; someone who works 6 unplanned hours scores 0. Both statements are true, and neither tells you who managed their time better. Different office hours made it worse: comparing raw hours is unfair when one person had 7h free and the other 16h.

**Chosen model.** Every report answers three questions, in order, and never folds them into a single number:

| # | Question | Metric(s) | Why it's separate |
|---|---|---|---|
| 1 | **How much time was there?** | `countable_min` = (day window ∪ anything planned or worked) − opted-out time, up to now | Context, not a contest. Normalises everything else. |
| 2 | **How much did each person work?** | `focus_min` (absolute) and `focus_share_pct` = focus ÷ countable | Absolute hours reward effort; the share is fair across unequal days. |
| 3 | **How disciplined were they?** | `discipline_score` (0–100) from: fulfilled 45 · planned enough 20 · on-time 15 · tasks 20 | "Did you make a real plan, and keep it?" Independent of volume. |

A **headline** then combines questions 2 and 3 explicitly, because they can disagree: *"Ben worked more (6h vs 2h 43m), but Asha was more disciplined (73 vs 0)."*

**Design notes worth an ADR:**
- **Countable time includes worked or planned time outside the window.** Otherwise working until 1am could push `focus_share` over 100%. The union keeps every ratio ≤ 100% by construction. An invariant is easier to guarantee than to check.
- **Discipline includes "planned enough"** (≥ 50% of countable time gets full marks). Without it, a tiny plan kept perfectly beats an honest full plan kept mostly. *Metrics shape behaviour; design them so the easy way to score well is the behaviour you actually want* (Goodhart's law).
- **Missing components rescale instead of scoring 0** (no tasks due → the other weights scale up). But "no plan at all" scores 0 on the plan parts, on purpose.
- **No discipline score before any countable time** (`null`, shown as "—"). Absence of data is not zero.
- **"Too close to call" thresholds** (`minGap`) stop the report crowning noise: 39% vs 38% is "even". *Smell to fix in v2:* the thresholds exist on the server (verdicts) **and** in the client (table highlights). Duplicated business rules drift apart. Have the server return the winner per row so there's a single source of truth.
- **Text personalisation** ("Asha" → "you", "was" → "were") is presentation, so it lives in the client (`lib/shared/personalize.ts`, tested). Server text stays name-based and cacheable for every viewer.

**Exercise.** Write the countable/work/discipline maths as one SQL query using `tstzmultirange` (`range_agg`, `-` for subtraction, `*` for intersection). Then compare readability and speed with the TS version.


### Decision (v1): compute on demand, in TypeScript, from raw intervals
- `lib/shared/report.ts` is a **pure function**: rows in, numbers out. It runs on every request.
- **Why it was right.**
  - Correctness first: one place for the logic, unit-tested with exact minute values.
  - The data is tiny.
  - No cache to invalidate.
  - The same code runs in the browser if needed.
- **When it breaks.**
  - Monthly and yearly reports scan thousands of rows per person, per request.
  - Every open Today tab recomputes it each minute.
  - `/api/status` computes a full day report *per member* every 15s per tab.

### Options
1. **Push the maths into SQL** (`range_agg`, `tstzmultirange`, `generate_series` for days). Less data over the wire. Learn which is clearer for you.
2. **Pre-computed rollups** (CQRS: a separate read model). A table `daily_stats(user_id, date, planned_min, focus_min, on_plan_min, …)`.
   - The hard part is **invalidation**. Late manual logs, edited blocks, opt-out toggles and time zone changes all change *past* days.
   - Pattern: on any write, mark `(user, local_date)` as dirty in an outbox table; a worker recomputes dirty days.
   - Weekly and monthly reports then sum 7–31 small rows.
3. **Cache** (Redis), keyed `report:{user}:{date}` and dropped when the day is marked dirty. Cheap, but you now have two invalidation paths.

**Do:**
1. Write the daily report as one SQL query and test it against the TS version on the same seed data. That's a *differential test*.
2. Then build `daily_stats` with dirty-day recomputation.
3. Measure p95 latency before and after with 500k rows.

---

## Part 8: Background work (reminders, digests, push)

v1 has none: reminders only fire while a tab is open. The original prototype had Vercel cron jobs and a dedupe table, `time_booking_reminders(booking_id, reminder_type) unique`. That was the right instinct.

### v2 design
```
EventBridge Scheduler / cron (every minute)
  └─▶ "find blocks starting in the next minute without a sent reminder"
        └─▶ enqueue jobs (SQS / pg-boss / BullMQ)
              └─▶ workers send Web Push / APNs / email
                    └─▶ insert into notifications_sent (block_id, user_id, kind) UNIQUE
```
- **At-least-once delivery plus an idempotent consumer ≈ exactly-once effect.** The UNIQUE constraint is the dedupe. Learn why "exactly-once" is mostly a myth (DDIA ch. 11).
- **Transactional outbox.** When a block is created, write the block *and* an `outbox` row in the same transaction; a relay publishes the outbox. You never send a reminder for a block that rolled back, and never lose one for a block that committed.
- **Time-zone-aware schedules.** "Send each user their daily report at 21:00 *their* time" means you schedule by user zone, not one global cron.
- **Push to closed apps.** Web Push (VAPID, a service worker; v1 already has the worker) for the PWA, APNs for a native or watch app.

---

## Part 9: Infrastructure and deployment

### Decision (v1): Vercel + Neon
- **Why.** Free, zero ops, `git push` deploys, preview URLs. Neon is serverless Postgres that scales to zero.
- **Why the *pooled* connection string?** Serverless spins up many short-lived function instances, and each wants database connections. A Postgres connection is a whole OS process (several MB), so hundreds of them hurt. A pooler (PgBouncer) multiplexes many clients onto few real connections.
  - **Learn:** session vs. transaction pooling, and why transaction pooling breaks session features like `SET` and prepared statements.
- **Why migrations auto-run under an advisory lock.** Convenient for a solo app: deploy and the schema follows. The lock stops two cold starts migrating at once.
  - **v2:** run migrations in CI *before* deploying, and learn **expand → migrate → contract** (add a column, backfill, switch reads, drop the old column) so deploys never break running code.
- **Why PGlite locally.** Real Postgres semantics with zero install, and the tests run against it in-memory.
  - **Caveat (learned the hard way):** it has one connection, so concurrency bugs can't show up there, and it didn't apply type parsers the same way as `pg`. **Test against real Postgres in CI** (a Docker service container).

### A v2 on AWS (draw it, price it, then decide)
```
Route 53 → CloudFront ─┬─▶ S3 (static frontend)
                       └─▶ ALB ─▶ ECS Fargate: API + SSE (2 tasks, 2 AZs)
                                     │         └─▶ ElastiCache Redis (pub/sub, rate limits)
                                     ▼
                         RDS Proxy ─▶ RDS Postgres (Multi-AZ, PITR backups)
EventBridge Scheduler ─▶ SQS ─▶ Lambda workers ─▶ SES (email) / APNs / Web Push
Secrets Manager (DATABASE_URL, VAPID keys) · CloudWatch logs/metrics/alarms
```
- Write it as **IaC** (CDK in TypeScript, or Terraform).
- **Price it honestly.** For 2 users this costs maybe 30–80× what Vercel + Neon does. The lesson is knowing *when* each piece earns its cost:
  - Multi-AZ: when downtime costs money.
  - Redis: when you have more than one API server.
  - Queues: when work must survive crashes and be retried.

---

## Part 10: Observability and reliability

- **Logs.** Structured JSON with a `request_id` on every line; v1's `route()` wrapper is the place to add it.
- **Metrics (RED).** Rate, Errors, Duration per endpoint. Watch p95 of `/api/reports` and `/api/timer`.
- **SLOs.** For example: "99.9% of timer actions succeed within 500ms over 30 days". Alerts fire on burning the error budget, not on every blip.
- **Backups.** Point-in-time recovery, plus a **restore drill**: actually restore yesterday's backup into a scratch database and run the report. An untested backup is a hope.
- **Load testing.** k6 against the timer and report endpoints, using the Part 1 numbers. Find the first bottleneck; it'll be polling or reports, as predicted.

---

## Part 11: Clients

- **API-first means clients are cheap.** The web PWA, Shortcuts (iPhone, Lock Screen, Apple Watch complication, Siri) and Android HTTP Shortcuts all use the same REST API with Bearer tokens.
- **Native, when it earns its place.** WidgetKit widgets and a Live Activity (a ticking timer on the Lock Screen or Dynamic Island), and a watchOS app with a real countdown. Live Activities can be updated by **push** (APNs), which ties back to Part 8.

---

## Part 12: Suggested build order (≈2–3 weeks, a few hours a day)

| Days | Build | Concepts | Read |
|---|---|---|---|
| 1 | Requirements, estimates, ADR template; redraw v1's architecture from memory | Functional vs. non-functional requirements, back-of-envelope | *System Design Interview* (Alex Xu) ch. 1–3 |
| 2–3 | v2 schema by hand: ranges, constraints, UUIDv7, indexes; seed 500k rows; report in SQL | Modelling, indexes, `EXPLAIN` | DDIA ch. 2–3; *Use The Index, Luke*; Postgres docs: range types, constraints |
| 4–5 | Standalone API service (Hono/Fastify in TS, or Go); OpenAPI; auth plus personal access tokens; RLS | API design, sessions vs. JWT, authorisation | OWASP ASVS (auth sections); Postgres RLS docs |
| 6 | Concurrency: the 20-parallel-creates test; fix with an exclusion constraint; idempotency keys | Isolation levels, write skew, idempotency | DDIA ch. 7 (Transactions) |
| 7–8 | Real-time: SSE plus LISTEN/NOTIFY, then two API instances with Redis pub/sub | Push vs. poll, fan-out, stateful tiers | DDIA ch. 11; "design a chat system" chapters |
| 9 | Read model: `daily_stats` with dirty-day recomputation, and a cache | CQRS, materialised views, invalidation | DDIA ch. 12 (derived data) |
| 10 | Jobs: outbox, scheduler → queue → worker, reminders via Web Push, daily digest email | At-least-once delivery, outbox, retries | DDIA ch. 11; AWS SQS docs |
| 11–12 | Deploy to AWS with CDK/Terraform; CI runs tests against real Postgres, then migrations, then deploy | IaC, environments, expand/contract | AWS Well-Architected (Reliability, Cost pillars) |
| 13 | Observability, SLOs, a k6 load test, a restore drill | RED metrics, SLOs, backups | Google SRE book, ch. 4 (SLOs) |
| 14+ | **Migrate yourself and your partner from v1 to v2**: export from Neon, transform, import, verify counts and report totals match, then cut over | ETL, data migration, cutover planning | |

The last row is the most "real job" part. Moving live users between systems is when everything you've learned meets reality:
- dual-run both versions and compare their reports (differential testing)
- plan the cutover
- have a rollback plan

---

## Part 13: The v1 decision log (seed your ADRs with these)

| # | Decision | Why (in one line) | Revisit when |
|---|---|---|---|
| 1 | Plain Postgres with raw SQL, no ORM, no BaaS | Understand every query; vendor-neutral (Supabase/Neon/RDS) | Schema churn makes hand-written SQL painful (then try a query builder like Kysely) |
| 2 | `timers` (state) + `time_entries` (append-only facts) | The prototype lost history by mutating a row | You need an audit trail or offline sync → event log |
| 3 | Organiser is an accepted participant | One uniform "my calendar" query | Never, really |
| 4 | UTC instants + per-user IANA zone | DST, travel, partners in different zones | Never |
| 5 | Overlap check in a transaction | Simple and correct for a single user tapping | Concurrent writers → exclusion constraint |
| 6 | `FOR UPDATE` + idempotent timer actions | Two devices and double taps can't corrupt state | Offline clients → idempotency keys |
| 7 | Opaque hashed session tokens in httpOnly cookies | Revocable, no secrets on the client, DB leak ≠ session leak | Many services need to verify identity → short-lived JWTs |
| 8 | Bearer header accepted too | Future non-browser clients (Shortcuts, watch) | Add scoped personal access tokens |
| 9 | Authorisation in queries via `visibleUserIds()` | One choke point for "who can see whom" | Add RLS as defence in depth |
| 10 | Thin routes, services hold the rules | Testable, transport-independent | Splitting into a separate backend: move services as-is |
| 11 | Timer as command endpoint | It's a state machine with side effects | Never |
| 12 | Polling 5–60s | Zero infrastructure, serverless-friendly, self-healing | Beyond tens of users, or when freshness matters → SSE + pub/sub |
| 13 | Reports computed per request in pure TS | Correct, tested, tiny data | Monthly/yearly views or many tabs → rollups / CQRS |
| 14 | Exclusion flag; excluded block removes its window | Matches intent ("office isn't judged") | Rule-based exclusions → separate exclusions table |
| 15 | Vercel + Neon pooled; migrations on first request under advisory lock | Free, zero ops, safe for a solo app | Team or production → migrations in CI, expand/contract |
| 16 | PGlite for dev and tests | Zero-install real Postgres | Concurrency tests → real Postgres in CI |
| 17 | PWA, no native app | One codebase on every phone | Live Activities, widgets, watch → native clients on the same API |
| 18 | Honesty-based tracking | Trust between two partners is the product | Bigger groups → anomaly flags, partner confirmation |
| 19 | Opt-out flag on blocks, entries and timer; excluded block removes its window | "Office isn't judged", and the excluded total stays visible to the partner | Rule-based exclusions → `report_exclusions` table |
| 20 | Delete project = `SET NULL` on its history (tasks optional) | Totals never change retroactively; archive remains for "hide" | Need undo → soft delete |
| 21 | Entry snapshots `project_id` from its task | History must not change when tasks are reorganised | Never; it's the point of a fact table |
| 22 | Comparison = countable time → work → discipline, plus headline; no single score | A percentage hides amount; unequal free time needs normalising | Groups > 2 → rankings per dimension, not one leaderboard |
| 23 | Per-user day window defines countable time | "24h minus office" would count sleep | Per-weekday windows / recurring availability |
| 24 | PWA + service worker; no caching of live data | Install on any phone; a stale timer is worse than an offline error | Offline mode → queue commands with idempotency keys |

---

## Part 14: "A better version" (product ideas worth designing for)

### Brainstorm: categorising work and an AI-written end-of-day report
These two ideas are a good system design case study, because "add AI" is mostly a **data-pipeline and trust** problem, not a prompt problem.

**1. Categorise first, deterministically where possible.**
- Start with **user-owned categories**: a `category` on projects (Deep work / Learning / Admin / Health / Social) plus optional per-task overrides. Free, instant, exact, and the user stays in control.
- Use an LLM only to **suggest** a category for uncategorised tasks and entry notes, as a background job: entry written → outbox → worker → model call → `suggested_category` + `confidence` stored → the user confirms with one tap. Never silently rewrite a user's data.
- Use **structured outputs** (`output_config.format` with a JSON schema whose `category` is an enum) so the model can only return a valid category. Validate anyway.
- **Cost.** Classifying a short title costs fractions of a cent. A small, cheap model such as Claude Haiku 5.5 is the natural fit for bulk tagging, though that's a quality and cost call to measure, not assume. Batch the night's uncategorised items with the Message Batches API (asynchronous, about 50% cheaper).

**2. The AI report: the numbers are computed, the model only narrates.**
```
nightly per user, in the user's own time zone (Part 8 scheduler)
  → build a compact JSON snapshot: countable/work/discipline for both people, block outcomes,
    categories, joint sessions, reflection notes (if shared), last 7 days' trend
  → one LLM call: "explain this day, compare fairly, suggest one change for tomorrow"
  → store in ai_reports(user_id, date, model, input_hash, text, created_at)
  → show on the Reports page; partner sees only what both opted to share
```
- **Never let the model compute the metrics.** It reads `report.ts` output. Arithmetic stays deterministic and tested; the LLM adds what code can't: *semantic* comparison ("Ben's 6h were all Leetcode; Asha split time between DSA and system design reading, which better matches her stated goal"), patterns across days, and a concrete suggestion.
- **Idempotency and caching.** Key the report by `input_hash`. If the day's data hasn't changed, don't regenerate. Late edits mark the day dirty (same mechanism as `daily_stats`, Part 7), and the report regenerates once.
- **Prompt caching.** Keep the instructions and rubric in a stable system prompt and put the day's JSON after it, so repeated nightly calls reuse the cached prefix.
- **Model choice.** Start with the most capable model (Claude Opus 5.5) for the narrative, where quality matters and volume is one call per person per day. Measure before considering a cheaper one. Rough scale: about 5k input and 800 output tokens per report is a few cents per report.
- **Privacy is a design input, not an afterthought.** Notes and task titles are personal. Decide per field what goes into the prompt, what the partner can see, and how to let a user opt out entirely. Write this ADR before any code.
- **Evaluate it like code.** Keep 20 real days as fixtures with "what a good report says" notes. Rerun them whenever you change the prompt or model. An AI feature without an eval is a demo.
- **Failure modes to design for.** Model timeouts (report generated later, not blocking the page), refusals or empty output (fall back to the deterministic headline), and cost runaway (per-user daily cap).


Each of these stresses a different part of the system, so they make good design exercises:

- **Recurring blocks** (`RRULE`): expand on read or materialise ahead of time? How do you handle exceptions ("skip this Tuesday")? This is a classic calendar design problem.
- **Goals per project** ("10h of DSA a week") with live progress. That's a read-model problem.
- **End-of-day reflection** (a short note plus a mood). It's a text-search and privacy problem: who can see it?
- **Nudges** ("Ben started your joint session"). A real-time plus push problem.
- **Groups larger than 2:** leaderboards and fair comparisons across time zones. Aggregation and fairness.
- **Streaks** and consistency metrics: how do they survive late edits and opt-outs? Invalidation again.

When you can explain for each of these which tables change, what the hot query is, what has to be real-time, and what breaks at 10,000 users, you've learned the system design this project was meant to teach.

---

## Part 15: Change log (improvement → where the design reasoning lives)

Every improvement made to v1 is recorded here with the section that explains it, so v2 can re-decide each one consciously.

| Date | Improvement | Design notes |
|---|---|---|
| 2026-11-15 | Rebuilt from the Supabase prototype: own Postgres schema, auth, workspaces, shared calendar, joint sessions, reports | Parts 0–9, decisions 1–18 |
| 2026-11-15 | Deployed on Vercel + Neon (pooled connection string) | Part 9 |
| 2026-11-16 | Installable on phones (PWA icons, service worker, notifications via the worker) | Part 11, decision 24 |
| 2026-11-16 | Opt any block, entry or timer out of reports (e.g. office hours) | Part 2, decision 19 |
| 2026-11-16 | Delete projects (history kept as "No project") | Part 2 (`ON DELETE`), decision 20 |
| 2026-11-16 | Fixed: PGlite ignored type parsers → local-only date bugs. Lesson: dev and prod drivers must be tested for identical output | Part 9 (PGlite caveat) |
| 2026-11-16 | Log forgotten time against a **task** (project inherited) | Part 2, decision 21 |
| 2026-11-16 | Comparison restructured: countable time → work → discipline, plus a headline; day window setting | Part 7, decisions 22–23 |
| 2026-11-16 | *Brainstorm only:* task categories + AI end-of-day report | Part 14 |

