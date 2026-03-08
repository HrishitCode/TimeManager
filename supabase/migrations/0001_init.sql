create extension if not exists "pgcrypto";

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text not null default '#2364aa',
  created_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text,
  kind text not null check (kind in ('daily', 'future')),
  scheduled_for timestamptz,
  priority int,
  status text not null default 'todo' check (status in ('todo', 'done', 'skipped')),
  recurrence_date date,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.pomodoro_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  focus_minutes int not null default 25,
  short_break_minutes int not null default 5,
  long_break_minutes int not null default 15,
  long_break_every int not null default 4,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  project_id uuid not null references public.projects(id) on delete cascade,
  mode text not null check (mode in ('focus', 'short_break', 'long_break')),
  status text not null check (status in ('running', 'paused', 'completed', 'stopped')),
  started_at timestamptz not null,
  paused_at timestamptz,
  ended_at timestamptz,
  planned_duration_sec int not null,
  actual_duration_sec int not null default 0,
  overtime_sec int not null default 0,
  accepted_overtime boolean not null default false
);

create table if not exists public.timer_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_session_id uuid references public.sessions(id) on delete set null,
  state_version int not null default 0,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by_device_id text not null
);

create table if not exists public.time_bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.time_booking_reminders (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.time_bookings(id) on delete cascade,
  reminder_type text not null check (reminder_type in ('pre_start_10m', 'late_1m')),
  sent_at timestamptz not null default timezone('utc', now()),
  unique(booking_id, reminder_type)
);

create index if not exists idx_projects_user on public.projects(user_id);
create index if not exists idx_tasks_user on public.tasks(user_id);
create index if not exists idx_tasks_project on public.tasks(project_id);
create index if not exists idx_sessions_user on public.sessions(user_id);
create index if not exists idx_sessions_started_at on public.sessions(started_at);
create index if not exists idx_time_bookings_user on public.time_bookings(user_id);
create index if not exists idx_time_bookings_starts_at on public.time_bookings(starts_at);

alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.pomodoro_configs enable row level security;
alter table public.sessions enable row level security;
alter table public.timer_states enable row level security;
alter table public.time_bookings enable row level security;

drop policy if exists "projects owner" on public.projects;
drop policy if exists "tasks owner" on public.tasks;
drop policy if exists "config owner" on public.pomodoro_configs;
drop policy if exists "sessions owner" on public.sessions;
drop policy if exists "timer owner" on public.timer_states;
drop policy if exists "bookings owner" on public.time_bookings;

create policy "projects owner" on public.projects for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tasks owner" on public.tasks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "config owner" on public.pomodoro_configs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "sessions owner" on public.sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "timer owner" on public.timer_states for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "bookings owner" on public.time_bookings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
