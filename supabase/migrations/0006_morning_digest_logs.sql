create table if not exists public.daily_digest_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  digest_date date not null,
  sent_at timestamptz not null default timezone('utc', now()),
  unique(user_id, digest_date)
);

create index if not exists idx_daily_digest_logs_user_date
  on public.daily_digest_logs(user_id, digest_date);

alter table public.daily_digest_logs enable row level security;

drop policy if exists "daily digest logs owner" on public.daily_digest_logs;
create policy "daily digest logs owner"
  on public.daily_digest_logs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
