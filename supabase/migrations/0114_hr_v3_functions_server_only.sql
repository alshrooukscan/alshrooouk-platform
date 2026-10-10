-- 0114: the v3 functions are server-only, like the rest of payroll.
REVOKE ALL ON FUNCTION public.attendance_balance(uuid,text), public.attendance_days(uuid,date,date),
  public.employee_bonus_lines(uuid,text), public.employee_raw_data_bonus(uuid,text),
  public.employee_report_bonus_v3(uuid,text), public.payslip_gross_v3(uuid,text),
  public.detect_attendance_deductions(text), public.hr_exam_type_by_name(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_balance(uuid,text), public.attendance_days(uuid,date,date),
  public.employee_bonus_lines(uuid,text), public.employee_raw_data_bonus(uuid,text),
  public.employee_report_bonus_v3(uuid,text), public.payslip_gross_v3(uuid,text),
  public.detect_attendance_deductions(text), public.hr_exam_type_by_name(text)
  TO service_role;
-- employee_report_bonus keeps its previous grants (authenticated + service_role); it now reads the
-- server-only functions above, so authenticated callers fall back to an error rather than pay data.
REVOKE ALL ON TABLE public.employee_bonus_rates, public.exam_type_bundle_items, public.visit_components FROM anon, authenticated;
GRANT ALL ON TABLE public.employee_bonus_rates, public.exam_type_bundle_items, public.visit_components TO service_role;
