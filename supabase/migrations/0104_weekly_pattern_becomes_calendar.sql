-- 0104: a weekly pattern is a roster too.
--
-- Shifts live in two places. employee_shifts holds the weekly pattern - Sunday
-- to Saturday, with start and end times - and employee_schedule_days holds the
-- actual calendar. Payroll reads the calendar only.
--
-- Doaa and Fatma have complete weekly patterns, five and six days, entered in
-- the obvious place. Neither has a single calendar row, so payroll saw no
-- roster, could not divide a salary by zero scheduled days, and fell back to
-- paying in full. They were told their roster was empty when it was not: it was
-- in the other table.
--
-- The calendar is generated from their pattern for September. Days already on
-- the calendar are left exactly as they are, so a shift someone deliberately
-- moved or swapped is never overwritten by the pattern it came from.
--
-- Only these two need it: the other six already have calendar rows.

create table if not exists schedule_days_generated_0104 as
  select * from employee_schedule_days where false;

with pattern as (
  select e.id as employee_id, d::date as work_date, s.start_time, s.end_time, s.is_day_off
  from employees e
  join generate_series(date '2026-09-01', date '2026-09-30', interval '1 day') d on true
  join employee_shifts s
    on s.employee_id = e.id
   and s.day_of_week = extract(dow from d)::int
  where e.is_active
    and not exists (
      select 1 from employee_schedule_days x
      where x.employee_id = e.id
        and x.work_date between date '2026-09-01' and date '2026-09-30')
),
created as (
  insert into employee_schedule_days (employee_id, work_date, start_time, end_time, is_day_off)
  select employee_id, work_date, start_time, end_time, is_day_off from pattern
  returning *
)
insert into schedule_days_generated_0104 select * from created;
