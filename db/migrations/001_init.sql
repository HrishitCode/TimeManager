-- Time Manager schema v1.
-- Plain Postgres (13+). No vendor extensions: runs on Supabase, Neon, RDS, or local PGlite.
-- Conventions: uuid PKs, timestamptz in UTC, child rows cascade with their owner.

-- ───────────────────────── identity ─────────────────────────
create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,            -- always stored lower-cased
  name          text not null,
  password_hash text not null,                   -- scrypt$N$r$p$salt$hash
  timezone      text not null default 'Asia/Kolkata', -- IANA name; defines "a day" for reports
  created_at    timestamptz not null default now()
);

-- Opaque session tokens. We store only sha256(token) so a DB leak doesn't leak live sessions.
create table auth_sessions (
  token_hash  text primary key,
  user_id     uuid not null references users(id) on delete cascade,
  user_agent  text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index auth_sessions_user_idx on auth_sessions(user_id);

-- ───────────────────────── workspaces ─────────────────────────
create table workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references users(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on workspace_members(user_id);

create table workspace_invites (
  code         text primary key,                 -- short shareable code
  workspace_id uuid not null references workspaces(id) on delete cascade,
  created_by   uuid references users(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_by      uuid references users(id) on delete set null,
  used_at      timestamptz
);

-- ───────────────────────── planning ─────────────────────────
create table projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  name        text not null,
  color       text not null default '#3b6fd8',
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
create index projects_user_idx on projects(user_id);

create table tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  project_id   uuid references projects(id) on delete set null,
  title        text not null,
  notes        text,
  status       text not null default 'todo' check (status in ('todo', 'done')),
  due_date     date,
  estimate_min int check (estimate_min is null or estimate_min > 0),
  completed_at timestamptz,
  created_at   timestamptz not null default now()
);
create index tasks_user_status_idx on tasks(user_id, status);

-- A block of planned time on the calendar. Shared sessions are blocks with >1 participant.
create table plan_blocks (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references users(id) on delete cascade,
  workspace_id uuid references workspaces(id) on delete set null,
  title        text not null,
  project_id   uuid references projects(id) on delete set null,
  task_id      uuid references tasks(id) on delete set null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  created_at   timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index plan_blocks_starts_idx on plan_blocks(starts_at);

-- Who is on a block. The owner always has an 'accepted' row, so
-- "my calendar" = blocks where I am an accepted participant.
create table block_participants (
  block_id     uuid not null references plan_blocks(id) on delete cascade,
  user_id      uuid not null references users(id) on delete cascade,
  status       text not null check (status in ('invited', 'accepted', 'declined')),
  responded_at timestamptz,
  primary key (block_id, user_id)
);
create index block_participants_user_idx on block_participants(user_id, status);

-- ───────────────────────── tracking ─────────────────────────
-- The live timer: at most one per user (the PK enforces it). Cross-device state lives here.
create table timers (
  user_id            uuid primary key references users(id) on delete cascade,
  project_id         uuid references projects(id) on delete set null,
  task_id            uuid references tasks(id) on delete set null,
  block_id           uuid references plan_blocks(id) on delete set null,
  label              text,
  mode               text not null default 'focus' check (mode in ('focus', 'break')),
  planned_sec        int check (planned_sec is null or planned_sec > 0),
  status             text not null check (status in ('running', 'paused')),
  session_started_at timestamptz not null,
  segment_started_at timestamptz,                -- null while paused
  accumulated_sec    int not null default 0,     -- closed segments so far
  version            int not null default 0,     -- optimistic concurrency between devices
  updated_at         timestamptz not null default now(),
  check ((status = 'running') = (segment_started_at is not null))
);

-- Immutable record of time actually spent. Every pause/stop closes one segment into a row.
-- Reports are computed purely from these intervals.
create table time_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  project_id  uuid references projects(id) on delete set null,
  task_id     uuid references tasks(id) on delete set null,
  block_id    uuid references plan_blocks(id) on delete set null,
  label       text,
  mode        text not null default 'focus' check (mode in ('focus', 'break')),
  source      text not null default 'timer' check (source in ('timer', 'manual')),
  started_at  timestamptz not null,
  ended_at    timestamptz not null,
  created_at  timestamptz not null default now(),
  check (ended_at > started_at)
);
create index time_entries_user_started_idx on time_entries(user_id, started_at);
