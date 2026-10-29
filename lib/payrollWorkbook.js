import * as XLSX from "xlsx";
import { supabaseAdmin } from "./supabaseAdmin";

// Monthly payroll export (Mohamed Said, 29 Oct 2026): pick the month, click
// Export, get the payroll workbook. Every figure comes from payroll_month, the
// same database function the Payslips page and the payslip itself use, so
// the file and the screen can never disagree.
//
// Rule of the clinic: each person is paid what is expected (fixed salary, or
// roster hours x rate). Every plus or minus is only proposed and needs an
// admin's approval; the report bonus is the one automatic exception.

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

const ITEM_LABEL = {
  absence: "خصم غياب",
  late: "خصم رصيد الوقت",
  early_leave: "انصراف بدري",
  visa: "خصم فيزا (دفعة مش متأكدة)",
  stock: "عجز مخزن",
  leave: "إجازة بدون إشعار",
};
const STATUS_AR = { pending: "مستني موافقة", approved: "اتوافق عليه", rejected: "مرفوض", waived: "اتلغى", carried_forward: "اترحّل" };

export async function payrollMonthData(period) {
  const { data: emps, error } = await supabaseAdmin
    .from("employees")
    .select("id, name, hr_id, hourly_rate, fixed_salary, attendance_exempt, enable_hybrid_variable_pay")
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error(error.message);
  const ids = emps.map((e) => e.id);

  const [months, trialRes, adjRes, dedRes, otRes] = await Promise.all([
    Promise.all(emps.map((e) => supabaseAdmin.rpc("payroll_month", { p_employee_id: e.id, p_period: period }).then((r) => r.data))),
    supabaseAdmin.rpc("payroll_trial_run", { p_period: period }),
    supabaseAdmin.from("payroll_adjustments").select("*").in("employee_id", ids),
    supabaseAdmin.from("payroll_deductions").select("*").in("employee_id", ids).eq("period", period),
    supabaseAdmin.from("overtime_decisions").select("*").in("employee_id", ids).eq("period", period),
  ]);
  if (trialRes.error) throw new Error(trialRes.error.message);
  const trial = Object.fromEntries((trialRes.data || []).map((t) => [t.employee_id, t]));
  const adjs = (adjRes.data || []).filter((a) => String(a.period).slice(0, 7) === period || a.period === period);
  const deds = dedRes.data || [];
  const ots = Object.fromEntries((otRes.data || []).map((o) => [o.employee_id, o]));

  const rows = [];
  const items = [];
  emps.forEach((e, i) => {
    const m = months[i] || {};
    const t = trial[e.id] || {};
    const myAdj = adjs.filter((a) => a.employee_id === e.id && a.status !== "rejected");
    const myDed = deds.filter((d) => d.employee_id === e.id && d.status !== "rejected" && !(d.status === "approved" && d.adjustment_id));
    const ot = ots[e.id];

    // what is still waiting for a decision
    let pending = 0;
    for (const a of myAdj) {
      const signed = a.kind === "bonus" ? Number(a.amount) : -Number(a.amount);
      if (a.status === "pending") pending += signed;
      items.push({
        "الموظف": e.name,
        "البند": a.source === "perfect_attendance" ? "بونص حضور كامل" : a.source === "overtime" ? "أوفرتايم" : a.source?.startsWith("deduction:") ? ITEM_LABEL[a.source.slice(10)] || a.label : a.label,
        "المبلغ": r2(signed),
        "الحالة": STATUS_AR[a.status] || a.status,
        "تفاصيل": [a.note, a.occurred_on, a.created_by_name ? `سجّله ${a.created_by_name}` : null].filter(Boolean).join(" · "),
      });
    }
    for (const d of myDed) {
      if (d.status === "pending") pending -= Number(d.amount);
      items.push({ "الموظف": e.name, "البند": ITEM_LABEL[d.kind] || d.kind, "المبلغ": -r2(d.amount), "الحالة": STATUS_AR[d.status] || d.status, "تفاصيل": d.reason || "" });
    }
    const otValue = Number(m.overtime_value || 0);
    if (!ot && otValue > 0) {
      pending += otValue;
      items.push({ "الموظف": e.name, "البند": "أوفرتايم", "المبلغ": r2(otValue), "الحالة": STATUS_AR.pending,
        "تفاصيل": `رصيد +${m.overtime_minutes} دقيقة × سعر الدقيقة × 2. يتوافق عليه من صفحة Payslips` });
    } else if (ot && ot.status === "waived") {
      items.push({ "الموظف": e.name, "البند": "أوفرتايم", "المبلغ": 0, "الحالة": STATUS_AR.waived, "تفاصيل": ot.note || "" });
    }

    const flags = [];
    if (m.attendance_exempt) flags.push("معفي من البصمة: بياخد الأساسي من غير بنود حضور");
    if (m.no_roster && !m.attendance_exempt) flags.push("مالوش جدول للشهر ده");
    if (Number(m.needs_review_days) > 0) flags.push(`${m.needs_review_days} يوم من غير بصمة انصراف (${m.needs_review_dates})`);
    if (Number(m.future_days) > 0) flags.push(`${m.future_days} يوم في الجدول لسه ماجاش`);
    if (m.absent_dates) flags.push(`غياب: ${m.absent_dates}`);
    if (m.extra_dates) flags.push(`أيام برة الجدول: ${m.extra_dates}`);
    if (Number(t.advance_taken) > 0) flags.push(`سلفة هتتخصم ${r2(t.advance_taken)}`);

    rows.push({
      "الموظف": e.name,
      "الكود": e.hr_id || "",
      "النوع": m.pay_basis === "hourly" ? "بالساعة" : "ثابت",
      "سعر الساعة": Number(e.hourly_rate || 0) || null,
      "المتوقع (أساسي)": r2(m.base),
      "خصومات / إضافات يدوية": r2(m.manual_adjustments),
      "الأساسي بعد اليدوي": r2(Number(m.base || 0) + Number(m.manual_adjustments || 0)),
      "أيام الجدول": Number(m.scheduled_days || 0),
      "تأخير (دقيقة)": Number(m.late_minutes || 0),
      "مشي بدري (دقيقة)": Number(m.early_leave_minutes || 0),
      "مجي بدري + قعاد (دقيقة)": Number(m.credit_minutes || 0),
      "أيام برة الجدول (دقيقة)": Number(m.extra_minutes || 0),
      "رصيد الوقت (دقيقة)": Number(m.net_minutes || 0),
      "أوفرتايم / خصم وقت": r2(m.time_value),
      "أيام غياب": Number(m.absent_days || 0),
      "خصم الغياب": -r2(m.absence_deduction),
      "بونص حضور كامل": r2(m.perfect_attendance_bonus),
      "بونص تقارير داخلية": r2(m.report_bonus_internal),
      "بونص تقارير خارجية": r2(m.report_bonus_external),
      "بونص Raw data": r2(m.raw_data_bonus),
      "خصم فيزا مستني": -r2(myDed.filter((d) => d.kind === "visa" && d.status === "pending").reduce((s, d) => s + Number(d.amount), 0)),
      "سلف": -r2(t.advance_taken),
      "الصافي باللي اتوافق عليه": r2(t.indicative_net),
      "مستني موافقة": r2(pending),
      "الصافي لو اتوافق على كله": r2(Number(t.indicative_net || 0) + pending),
      "ملاحظات": flags.join(" · "),
    });
  });
  return { rows, items };
}

export async function payrollWorkbook(period, staffName) {
  const { rows, items } = await payrollMonthData(period);
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };

  const ws = XLSX.utils.json_to_sheet(rows);
  const cols = Object.keys(rows[0] || {});
  // a totals row, as formulas, so the file still adds up after edits
  const totalRow = rows.length + 2;
  const sumCols = ["المتوقع (أساسي)", "خصومات / إضافات يدوية", "الأساسي بعد اليدوي", "أوفرتايم / خصم وقت", "خصم الغياب", "بونص حضور كامل", "بونص تقارير داخلية",
    "بونص تقارير خارجية", "بونص Raw data", "خصم فيزا مستني", "سلف", "الصافي باللي اتوافق عليه", "مستني موافقة", "الصافي لو اتوافق على كله"];
  XLSX.utils.sheet_add_aoa(ws, [["الإجمالي"]], { origin: `A${totalRow}` });
  sumCols.forEach((c) => {
    const idx = cols.indexOf(c);
    if (idx < 0) return;
    const L = XLSX.utils.encode_col(idx);
    ws[`${L}${totalRow}`] = { t: "n", f: `SUM(${L}2:${L}${rows.length + 1})` };
  });
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRow - 1, c: cols.length - 1 } });
  ws["!cols"] = cols.map((c) => ({ wch: c === "ملاحظات" ? 70 : c === "الموظف" ? 26 : Math.max(12, c.length + 2) }));
  XLSX.utils.book_append_sheet(wb, ws, "المرتبات");

  const wsI = XLSX.utils.json_to_sheet(items.length ? items : [{ "الموظف": "", "البند": "مفيش بنود", "المبلغ": 0, "الحالة": "", "تفاصيل": "" }]);
  wsI["!cols"] = [{ wch: 26 }, { wch: 26 }, { wch: 12 }, { wch: 14 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, wsI, "بنود الموافقة");

  const notes = [
    ["القواعد (محمد سعيد، 29 أكتوبر 2026)"],
    ["كل موظف يقبض المتوقع: الثابت كامل، أو ساعات الجدول × سعر الساعة."],
    ["أي زيادة أو نقص بيتعرض بس، ومابينزلش على القسيمة غير بموافقة (Payslips للأوفرتايم والبونص، Deductions للخصومات)."],
    ["رصيد الوقت = مجي بدري + قعاد بعد الميعاد (بحد أقصى ساعة لكل واحدة في اليوم) + الأيام برة الجدول − كل دقيقة تأخير (من غير فترة سماح) − كل دقيقة مشي بدري."],
    ["الرصيد الموجب أوفرتايم بالضعف، والسالب خصم بالضعف."],
    ["الغياب يوم بيومين، ويوم واحد لو فيه إذن متوافق عليه بتاريخ اليوم ده."],
    ["الحضور الكامل: ولا دقيقة تأخير ولا مشي بدري ولا غياب = 10% من الثابت أو من أجر ساعات الجدول، بعد الخصومات اليدوية."],
    ["بونص التقارير بيتصرف لوحده. التقارير الخارجية ليها سعر منفصل في بروفايل الموظف (الافتراضي صفر)."],
    ["المعفيين من البصمة بياخدوا الأساسي من غير بنود حضور."],
    [""],
    ["الشهر", period],
    ["اتطلع", new Date().toLocaleString("en-GB", { timeZone: "Africa/Cairo" })],
    ["بواسطة", staffName || ""],
  ];
  const wsN = XLSX.utils.aoa_to_sheet(notes);
  wsN["!cols"] = [{ wch: 110 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, wsN, "ملاحظات");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
