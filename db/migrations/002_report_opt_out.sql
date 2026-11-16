-- Let any stretch of time be left out of reports (e.g. office hours).
-- Default true: everything counts unless you say otherwise.
--   plan_blocks: an excluded block removes its whole window from your reports,
--                including any focus you tracked inside it.
--   time_entries / timers: an excluded entry is simply ignored.
alter table plan_blocks  add column include_in_reports boolean not null default true;
alter table time_entries add column include_in_reports boolean not null default true;
alter table timers       add column include_in_reports boolean not null default true;
