import { supabaseAdmin } from "./supabaseAdmin";

// Supabase caps a single request, so anything that could exceed one page is
// walked. A financial export that silently stopped at 1,000 rows would be worse
// than no export at all - it would look complete and be wrong.
async function fetchAll(build, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

const money = (v) => Number(v || 0);
const dateOnly = (v) => (v ? String(v).slice(0, 10) : "");

// Every report is declared here: what it is called, which group it belongs to,
// whether it takes a date range, and how its rows are built.
export const REPORTS = {
  // ---------------------------------------------------------------- FINANCIAL
  revenue_by_visit: {
    group: "Financial",
    label: "Revenue by visit",
    description: "Every visit in the period with what was charged, discounted and collected.",
    dated: true,
    async rows({ from, to }) {
      const visits = await fetchAll(() =>
        supabaseAdmin
          .from("visits")
          .select("exam_date, scan_types, amount_due, amount_paid, discount_pct, payment_status, patients(name, mobile), doctors(name, clinic_code), branches(name)")
          .gte("exam_date", from)
          .lte("exam_date", to)
          .order("exam_date")
      );
      return visits.map((v) => ({
        Date: dateOnly(v.exam_date),
        Patient: v.patients?.name || "",
        Mobile: v.patients?.mobile || "",
        Doctor: v.doctors?.name || "",
        Clinic: v.doctors?.clinic_code || "",
        Branch: v.branches?.name || "",
        Scans: (v.scan_types || []).join(", "),
        "Discount %": money(v.discount_pct),
        "Amount due": money(v.amount_due),
        "Amount paid": money(v.amount_paid),
        Outstanding: money(v.amount_due) - money(v.amount_paid),
        Status: v.payment_status || "",
      }));
    },
  },

  payments_ledger: {
    group: "Financial",
    label: "Payments received",
    description: "The payment ledger itself — every amount received, by method and collector.",
    dated: true,
    async rows({ from, to }) {
      const pays = await fetchAll(() =>
        supabaseAdmin
          .from("visit_payments")
          .select("paid_at, amount, payment_method, created_by_name, visits(exam_date, patients(name))")
          .gte("paid_at", from)
          .lte("paid_at", `${to}T23:59:59`)
          .order("paid_at")
      );
      return pays.map((p) => ({
        "Paid at": dateOnly(p.paid_at),
        Patient: p.visits?.patients?.name || "",
        "Visit date": dateOnly(p.visits?.exam_date),
        Amount: money(p.amount),
        Method: p.payment_method || "",
        "Collected by": p.created_by_name || "",
      }));
    },
  },

  outstanding: {
    group: "Financial",
    label: "Money owed",
    description: "Unpaid and part-paid visits, oldest first, with how long they have been outstanding.",
    dated: false,
    async rows() {
      const visits = await fetchAll(() =>
        supabaseAdmin
          .from("visits")
          .select("exam_date, amount_due, amount_paid, payment_status, patients(name, mobile), doctors(name, clinic_code)")
          .neq("payment_status", "paid")
          .order("exam_date")
      );
      const today = new Date();
      return visits
        .filter((v) => money(v.amount_due) - money(v.amount_paid) > 0)
        .map((v) => ({
          "Visit date": dateOnly(v.exam_date),
          "Days outstanding": Math.floor((today - new Date(v.exam_date)) / 86400000),
          Patient: v.patients?.name || "",
          Mobile: v.patients?.mobile || "",
          Doctor: v.doctors?.name || "",
          "Amount due": money(v.amount_due),
          Paid: money(v.amount_paid),
          Owed: money(v.amount_due) - money(v.amount_paid),
        }));
    },
  },

  discounts: {
    group: "Financial",
    label: "Discounts given",
    description: "Every discounted visit and what the discount was worth, to see where value is going.",
    dated: true,
    async rows({ from, to }) {
      const visits = await fetchAll(() =>
        supabaseAdmin
          .from("visits")
          .select("exam_date, discount_pct, amount_due, scan_types, patients(name), doctors(name, clinic_code)")
          .gt("discount_pct", 0)
          .gte("exam_date", from)
          .lte("exam_date", to)
          .order("discount_pct", { ascending: false })
      );
      return visits.map((v) => {
        const pct = money(v.discount_pct);
        const due = money(v.amount_due);
        // amount_due is already discounted, so the list price is recovered from it.
        const list = pct >= 100 ? due : due / (1 - pct / 100);
        return {
          Date: dateOnly(v.exam_date),
          Patient: v.patients?.name || "",
          Doctor: v.doctors?.name || "",
          Clinic: v.doctors?.clinic_code || "",
          Scans: (v.scan_types || []).join(", "),
          "Discount %": pct,
          "List price": Math.round(list),
          Charged: due,
          "Value discounted": Math.round(list - due),
        };
      });
    },
  },

  cash_by_employee: {
    group: "Financial",
    label: "Cash collected per employee",
    description: "Who took what money in, so cash in hand can be reconciled against a person.",
    dated: true,
    async rows({ from, to }) {
      const pays = await fetchAll(() =>
        supabaseAdmin
          .from("visit_payments")
          .select("paid_at, amount, payment_method, created_by_name")
          .gte("paid_at", from)
          .lte("paid_at", `${to}T23:59:59`)
      );
      const byPerson = {};
      for (const p of pays) {
        const who = p.created_by_name || "(not recorded)";
        const method = p.payment_method || "Unknown";
        byPerson[who] = byPerson[who] || { who, total: 0, methods: {} };
        byPerson[who].total += money(p.amount);
        byPerson[who].methods[method] = (byPerson[who].methods[method] || 0) + money(p.amount);
      }
      return Object.values(byPerson)
        .sort((a, b) => b.total - a.total)
        .map((r) => ({
          "Collected by": r.who,
          "Total collected": Math.round(r.total),
          Cash: Math.round(r.methods.Cash || 0),
          Visa: Math.round(r.methods.Visa || 0),
          Wallet: Math.round(r.methods.Wallet || 0),
          Instapay: Math.round(r.methods.Instapay || 0),
          Other: Math.round(
            r.total - (r.methods.Cash || 0) - (r.methods.Visa || 0) - (r.methods.Wallet || 0) - (r.methods.Instapay || 0)
          ),
        }));
    },
  },

  // -------------------------------------------------------------- OPERATIONAL
  doctor_performance: {
    group: "Operational",
    label: "Doctor referrals",
    description: "Referrals per doctor with revenue, distinct patients and average discount.",
    dated: true,
    async rows({ from, to }) {
      const visits = await fetchAll(() =>
        supabaseAdmin
          .from("visits")
          .select("patient_id, amount_due, amount_paid, discount_pct, doctors(name, clinic_code, phone)")
          .gte("exam_date", from)
          .lte("exam_date", to)
      );
      const byDoc = {};
      for (const v of visits) {
        if (!v.doctors) continue;
        const k = v.doctors.name;
        byDoc[k] = byDoc[k] || { name: k, clinic: v.doctors.clinic_code, phone: v.doctors.phone, visits: 0, patients: new Set(), due: 0, paid: 0, disc: [] };
        byDoc[k].visits++;
        byDoc[k].patients.add(v.patient_id);
        byDoc[k].due += money(v.amount_due);
        byDoc[k].paid += money(v.amount_paid);
        byDoc[k].disc.push(money(v.discount_pct));
      }
      return Object.values(byDoc)
        .sort((a, b) => b.paid - a.paid)
        .map((d) => ({
          Doctor: d.name,
          Clinic: d.clinic || "",
          Phone: d.phone || "",
          Visits: d.visits,
          "Distinct patients": d.patients.size,
          "Revenue collected": Math.round(d.paid),
          "Average per visit": Math.round(d.paid / d.visits),
          "Average discount %": Math.round((d.disc.reduce((s, x) => s + x, 0) / d.disc.length) * 10) / 10,
        }));
    },
  },

  scan_demand: {
    group: "Operational",
    label: "Scan type demand",
    description: "Which scans are actually being sold, and what each earns.",
    dated: true,
    async rows({ from, to }) {
      const visits = await fetchAll(() =>
        supabaseAdmin.from("visits").select("scan_types, amount_paid").gte("exam_date", from).lte("exam_date", to)
      );
      const byType = {};
      for (const v of visits) {
        const types = v.scan_types || [];
        if (!types.length) continue;
        // A visit can carry several scans; its revenue is split across them so
        // the totals still add up to the real figure.
        const share = money(v.amount_paid) / types.length;
        for (const t of types) {
          byType[t] = byType[t] || { type: t, count: 0, revenue: 0 };
          byType[t].count++;
          byType[t].revenue += share;
        }
      }
      return Object.values(byType)
        .sort((a, b) => b.count - a.count)
        .map((t) => ({
          "Scan type": t.type,
          Times: t.count,
          "Revenue (split across multi-scan visits)": Math.round(t.revenue),
          "Average": Math.round(t.revenue / t.count),
        }));
    },
  },

  report_turnaround: {
    group: "Operational",
    label: "Report turnaround",
    description: "How long reports take from scan to delivery, and which are still outstanding.",
    dated: true,
    async rows({ from, to }) {
      const visits = await fetchAll(() =>
        supabaseAdmin
          .from("visits")
          .select("exam_date, scanned, scanned_at, report_done, report_done_at, report_done_by_name, patients(name), doctors(name)")
          .gte("exam_date", from)
          .lte("exam_date", to)
          .order("exam_date")
      );
      return visits.map((v) => {
        let days = "";
        if (v.scanned_at && v.report_done_at) {
          days = Math.round(((new Date(v.report_done_at) - new Date(v.scanned_at)) / 86400000) * 10) / 10;
        }
        return {
          "Visit date": dateOnly(v.exam_date),
          Patient: v.patients?.name || "",
          Doctor: v.doctors?.name || "",
          Scanned: v.scanned ? "Yes" : "No",
          "Report done": v.report_done ? "Yes" : "No",
          "Report by": v.report_done_by_name || "",
          "Days to report": days,
        };
      });
    },
  },

  // ----------------------------------------------------------------------- HR
  attendance: {
    group: "HR",
    label: "Attendance",
    description: "Every clock event in the period, with how the face check went.",
    dated: true,
    async rows({ from, to }) {
      const ev = await fetchAll(() =>
        supabaseAdmin
          .from("timeclock_events")
          .select("event_time, event_type, face_match_status, employees(name, hr_id)")
          .gte("event_time", from)
          .lte("event_time", `${to}T23:59:59`)
          .order("event_time")
      );
      return ev.map((e) => ({
        Date: dateOnly(e.event_time),
        Time: String(e.event_time).slice(11, 19),
        Employee: e.employees?.name || "",
        "HR ID": e.employees?.hr_id || "",
        Event: e.event_type,
        "Face check": e.face_match_status || "",
      }));
    },
  },

  payroll_adjustments: {
    group: "HR",
    label: "Deductions and bonuses",
    description: "Everything applied to a payslip, with who applied it and why.",
    dated: false,
    async rows({ period }) {
      let q = () => supabaseAdmin.from("payroll_adjustments").select("*, employees(name, hr_id)").order("created_at");
      if (period) {
        const p = period;
        q = () => supabaseAdmin.from("payroll_adjustments").select("*, employees(name, hr_id)").eq("period", p).order("created_at");
      }
      const rows = await fetchAll(q);
      return rows.map((a) => ({
        Period: a.period,
        Employee: a.employees?.name || "",
        "HR ID": a.employees?.hr_id || "",
        Kind: a.kind,
        Rule: a.label,
        Amount: money(a.amount),
        "Occurred on": dateOnly(a.occurred_on),
        Note: a.note || "",
        "Applied by": a.created_by_name || "",
      }));
    },
  },

  // -------------------------------------------------------------------- STOCK
  stock_levels: {
    group: "Stock",
    label: "Stock levels",
    description: "Current quantity against reorder level, so shortfalls are visible.",
    dated: false,
    async rows() {
      const items = await fetchAll(() =>
        supabaseAdmin.from("stock_items").select("name, item_code, category, qty_remaining, reorder_level, purchase_price, sale_price").order("category").order("name")
      );
      return items.map((i) => {
        const qty = Number(i.qty_remaining || 0);
        const reorder = Number(i.reorder_level || 0);
        return {
          Item: i.name,
          Code: i.item_code || "",
          Category: i.category || "",
          Quantity: qty,
          "Reorder level": reorder,
          Status: qty < 0 ? "NEGATIVE" : qty === 0 ? "Out of stock" : qty <= reorder ? "Low" : "OK",
          "Purchase price": money(i.purchase_price),
          "Sale price": money(i.sale_price),
          // Valued at what it cost, not what it sells for - stock on hand is
          // money spent, not revenue not yet earned.
          "Value on hand": Math.round(qty * money(i.purchase_price)),
        };
      });
    },
  },

  doctor_orders: {
    group: "Stock",
    label: "Doctor stock orders",
    description: "Orders placed by doctors with their status and what is still owed.",
    dated: false,
    async rows() {
      const orders = await fetchAll(() =>
        supabaseAdmin
          .from("dental_orders")
          .select("created_at, status, payment_status, total_amount, amount_paid, pay_later, note, doctors(name, clinic_code)")
          .order("created_at", { ascending: false })
      );
      return orders.map((o) => ({
        Date: dateOnly(o.created_at),
        Doctor: o.doctors?.name || "",
        Clinic: o.doctors?.clinic_code || "",
        Status: o.status,
        Payment: o.payment_status || "",
        "Pay later": o.pay_later ? "Yes" : "No",
        Total: money(o.total_amount),
        Paid: money(o.amount_paid),
        Owed: money(o.total_amount) - money(o.amount_paid),
        Note: o.note || "",
      }));
    },
  },

  // ------------------------------------------------------------- DATA QUALITY
  data_gaps: {
    group: "Data quality",
    label: "Data gaps",
    description: "Patients with no mobile, no Drive folder, or no login — the records that quietly break things.",
    dated: false,
    async rows() {
      const patients = await fetchAll(() =>
        supabaseAdmin.from("patients").select("id, name, mobile, drive_folder_id, last_visit_date").order("name")
      );
      const auths = await fetchAll(() => supabaseAdmin.from("patient_auth").select("patient_id"));
      const hasLogin = new Set(auths.map((a) => a.patient_id));
      return patients
        .filter((p) => !p.mobile || p.mobile === "0" || !p.drive_folder_id || !hasLogin.has(p.id))
        .map((p) => ({
          Patient: p.name,
          Mobile: p.mobile && p.mobile !== "0" ? p.mobile : "MISSING",
          "Drive folder": p.drive_folder_id ? "Yes" : "MISSING",
          "Portal login": hasLogin.has(p.id) ? "Yes" : "MISSING",
          "Last visit": dateOnly(p.last_visit_date),
        }));
    },
  },

  shared_drive_folders: {
    group: "Data quality",
    label: "Patients sharing a Drive folder",
    description: "Where several patient records point at one folder — duplicates, or two real people whose scans land together.",
    dated: false,
    async rows() {
      const patients = await fetchAll(() =>
        supabaseAdmin
          .from("patients")
          .select("id, name, mobile, drive_folder_id, last_visit_date")
          .not("drive_folder_id", "is", null)
          .order("drive_folder_id")
      );
      const byFolder = {};
      for (const p of patients) {
        (byFolder[p.drive_folder_id] = byFolder[p.drive_folder_id] || []).push(p);
      }
      const out = [];
      for (const [folder, group] of Object.entries(byFolder)) {
        if (group.length < 2) continue;
        const mobiles = new Set(group.map((g) => g.mobile).filter(Boolean));
        for (const p of group) {
          out.push({
            "Drive folder": folder,
            "Patients sharing it": group.length,
            // Same name and same number reads as a duplicate record; different
            // numbers mean these are probably different people.
            "Likely": mobiles.size === 1 ? "Duplicate record" : "Different people",
            Patient: p.name,
            Mobile: p.mobile || "",
            "Last visit": dateOnly(p.last_visit_date),
            "Folder link": `https://drive.google.com/drive/folders/${folder}`,
          });
        }
      }
      return out;
    },
  },

  unattributed_cash: {
    group: "Data quality",
    label: "Unattributed cash",
    description: "Payments with no collector recorded — money that cannot be reconciled to a person.",
    dated: false,
    async rows() {
      const pays = await fetchAll(() =>
        supabaseAdmin
          .from("visit_payments")
          .select("paid_at, amount, payment_method, created_by_name, visits(exam_date, patients(name))")
          .is("created_by_name", null)
          .order("paid_at", { ascending: false })
      );
      return pays.map((p) => ({
        "Paid at": dateOnly(p.paid_at),
        Patient: p.visits?.patients?.name || "",
        "Visit date": dateOnly(p.visits?.exam_date),
        Amount: money(p.amount),
        Method: p.payment_method || "",
      }));
    },
  },
};

export function reportList() {
  return Object.entries(REPORTS).map(([key, r]) => ({
    key,
    group: r.group,
    label: r.label,
    description: r.description,
    dated: !!r.dated,
  }));
}
