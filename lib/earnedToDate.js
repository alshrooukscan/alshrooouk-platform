// "Earned so far" grows day by day (Mohamed Said, 2 Nov 2026).
//
// payroll_trial_run's gross is the whole month's expected base: the roster
// hours x rate, or the fixed salary. That is right for the payslip, but read
// mid-month as "earned so far" it showed the full month after one shift
// (8 shifts x 10 h x 72 = 5,760 on 1 November). payroll_month.earned_to_date
// (migration 0132) is the same base counted only over the days already
// reached; this swaps it in and moves the net by the same difference. The
// full-month figure is kept as expected_gross.
export function applyEarnedToDate(row, month) {
  if (!row || !month || month.month_complete || month.earned_to_date == null) return row;
  const full = Number(row.gross || 0);
  const earned = Math.min(Number(month.earned_to_date || 0), full);
  return {
    ...row,
    expected_gross: full,
    gross: earned,
    indicative_net: Math.round((Number(row.indicative_net || 0) - (full - earned)) * 100) / 100,
  };
}
