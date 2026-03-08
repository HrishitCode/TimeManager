alter table public.sessions
  add column if not exists overtime_sec int not null default 0,
  add column if not exists accepted_overtime boolean not null default false;
