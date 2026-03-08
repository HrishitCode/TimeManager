create table if not exists public.time_booking_reminders (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.time_bookings(id) on delete cascade,
  reminder_type text not null check (reminder_type in ('pre_start_10m', 'late_1m')),
  sent_at timestamptz not null default timezone('utc', now()),
  unique(booking_id, reminder_type)
);
