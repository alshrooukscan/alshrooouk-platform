-- Cover Shift (Mohamed Said, 9 Nov 2026): a second option next to Swap.
-- One employee hands one of their working days to a colleague who is free
-- that day, with nothing given back. Same flow as a swap: the colleague
-- agrees, then an admin approves, and only then does the roster change.
--
-- Pay follows the roster, which is exactly Mohamed's rule:
--   * the person covering gets the day at their normal rate (it is now a
--     scheduled day for them, not overtime);
--   * the person who handed it over is simply not paid for it, and it is not
--     an absence (no double deduction), because it was approved.

ALTER TABLE public.shift_swap_requests
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'swap';
ALTER TABLE public.shift_swap_requests
  DROP CONSTRAINT IF EXISTS shift_swap_kind_check;
ALTER TABLE public.shift_swap_requests
  ADD CONSTRAINT shift_swap_kind_check CHECK (kind IN ('swap', 'cover'));
ALTER TABLE public.shift_swap_requests ALTER COLUMN target_day_id DROP NOT NULL;
ALTER TABLE public.shift_swap_requests
  DROP CONSTRAINT IF EXISTS shift_swap_target_day_needed;
ALTER TABLE public.shift_swap_requests
  ADD CONSTRAINT shift_swap_target_day_needed CHECK (kind = 'cover' OR target_day_id IS NOT NULL);

-- One open cover request per day at a time.
CREATE UNIQUE INDEX IF NOT EXISTS shift_cover_one_pending_per_day
  ON public.shift_swap_requests (requester_day_id)
  WHERE kind = 'cover' AND status = 'pending';

-- Applies an approved cover atomically. The covering colleague may already
-- hold a "day off" row on that date (one row per person per date), so that
-- row is removed first, the working day moves to them, and the person who
-- handed it over gets a day-off row so the calendar still reads cleanly.
-- Returns 'ok', or the reason it could not be applied.
CREATE OR REPLACE FUNCTION public.apply_cover_shift(p_request uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r   public.shift_swap_requests%ROWTYPE;
  d   public.employee_schedule_days%ROWTYPE;
  clash public.employee_schedule_days%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.shift_swap_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND OR r.kind <> 'cover' THEN RETURN 'not a cover request'; END IF;

  SELECT * INTO d FROM public.employee_schedule_days WHERE id = r.requester_day_id FOR UPDATE;
  IF NOT FOUND OR d.employee_id <> r.requester_id OR d.is_day_off THEN
    RETURN 'schedule changed';
  END IF;

  SELECT * INTO clash FROM public.employee_schedule_days
   WHERE employee_id = r.target_id AND work_date = d.work_date FOR UPDATE;
  IF FOUND THEN
    IF NOT clash.is_day_off THEN RETURN 'colleague is already working that day'; END IF;
    DELETE FROM public.employee_schedule_days WHERE id = clash.id;
  END IF;

  UPDATE public.employee_schedule_days SET employee_id = r.target_id WHERE id = d.id;
  INSERT INTO public.employee_schedule_days (employee_id, work_date, is_day_off)
  VALUES (r.requester_id, d.work_date, true)
  ON CONFLICT (employee_id, work_date) DO NOTHING;
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.apply_cover_shift(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_cover_shift(uuid) TO service_role;
