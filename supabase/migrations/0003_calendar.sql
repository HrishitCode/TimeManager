create table if not exists public.time_bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_time_bookings_user on public.time_bookings(user_id);
create index if not exists idx_time_bookings_starts_at on public.time_bookings(starts_at);

alter table public.time_bookings enable row level security;

drop policy if exists "bookings owner" on public.time_bookings;
create policy "bookings owner" on public.time_bookings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
