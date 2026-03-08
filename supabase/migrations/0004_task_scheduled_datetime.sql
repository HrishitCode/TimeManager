alter table public.tasks
  alter column scheduled_for type timestamptz
  using case
    when scheduled_for is null then null
    else (scheduled_for::timestamp at time zone 'utc')
  end;
