-- Each person's "day window": the hours they could reasonably plan or work (default 07:00–23:00).
-- Countable time = day window (plus any time actually planned or worked outside it) − opted-out time.
-- Stored as minutes after local midnight; end may pass midnight (e.g. 1500 = 01:00 next day) for night owls.
alter table users
  add column day_start_min int not null default 420,
  add column day_end_min   int not null default 1380;

alter table users
  add constraint users_day_window_chk
  check (day_start_min >= 0 and day_start_min < 1440 and day_end_min > day_start_min and day_end_min - day_start_min <= 1440);
