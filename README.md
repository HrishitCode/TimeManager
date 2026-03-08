# Personalized Pomodoro (TypeScript + Next.js)

A cross-device Pomodoro web app with manual timer controls, project playgrounds, task planning, and productivity insights.

## Features implemented

- Email/password auth with Supabase
- Manual timer controls: start, pause, resume, stop
- Cross-device timer state backed by `timer_states`
- Playgrounds as projects
- Task management for daily/future tasks
- Insights by day/week/month/year:
  - completion diligence
  - most productive hour
  - trend chart

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` using `.env.example`:

```bash
cp .env.example .env.local
```

3. Fill env vars from Supabase project settings.

4. Run SQL migrations in Supabase SQL editor:

- File: `supabase/migrations/0001_init.sql`
- File: `supabase/migrations/0002_overtime.sql` (required if `0001` was already applied earlier)
- File: `supabase/migrations/0003_calendar.sql` (required if `0001` was already applied earlier)
- File: `supabase/migrations/0004_task_scheduled_datetime.sql` (required if `0001` was already applied earlier)
- File: `supabase/migrations/0005_booking_reminders.sql` (required if `0001` was already applied earlier)
- File: `supabase/migrations/0006_morning_digest_logs.sql` (required for morning digest idempotency)

5. Start dev server:

```bash
npm run dev
```

## API endpoints

- `POST /api/timer/start`
- `POST /api/timer/pause`
- `POST /api/timer/resume`
- `POST /api/timer/stop`
- `GET /api/timer/state`
- `GET|POST /api/projects`
- `PATCH /api/projects/:id`
- `GET|POST /api/tasks`
- `PATCH /api/tasks/:id`
- `GET /api/insights?range=day|week|month|year&anchor=YYYY-MM-DD`
- `GET /api/reports/daily?date=YYYY-MM-DD`
- `GET|POST /api/calendar/day?date=YYYY-MM-DD`
- `DELETE /api/calendar/day/:id`
- `GET /api/reminders/run` (cron-triggered; requires `x-reminder-secret` header)
- `GET /api/reminders/morning-run` (cron-triggered; supports `Authorization: Bearer <CRON_SECRET>`)

## Reminder emails

- Configure `.env.local`:
  - `CRON_SECRET` (recommended for Vercel cron auth)
  - `RESEND_API_KEY`
  - `REMINDER_FROM_EMAIL`
  - `REMINDER_TO_EMAIL`
  - `REMINDER_CRON_SECRET` (backward-compatible with previous header auth)
- The repository includes `vercel.json` with:
  - 1-minute cron for `/api/reminders/run`
  - daily 07:00 IST digest cron (`01:30 UTC`) for `/api/reminders/morning-run`
- The endpoint sends:
  - 10-minute pre-start reminder
  - 1-minute post-start reminder if timer is still not running for that booked project/task
  - morning digest with today's schedule + yesterday summary + vs trailing average

## Tests

```bash
npm run test
```

## Notes

- Timer consistency uses optimistic concurrency via `state_version`.
- For production, rotate service role key and keep it server-only.
