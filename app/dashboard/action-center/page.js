"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { theme } from "../../../lib/theme";
import { usePermissions } from "../../../lib/usePermissions";
import { formatMoney, formatVisitDateTime } from "../../../lib/format";

const STOCK_FIELD_LABEL = { qty_remaining: "Quantity", purchase_price: "Purchase price", sale_price: "Sale price" };
import { logActivity } from "../../../lib/activityLog";
import { syncPatientLastVisitDate } from "../../../lib/syncPatientLastVisitDate";
import { useAutoRefresh } from "../../../lib/useAutoRefresh";
import VerifyPill from "../../../components/VerifyPill";
import { useT, tx, Ltr } from "../../../lib/i18n";

const BRAND_LABEL = { scan: "Scan", dental_stock: "Dental Stock", el3awama_stock: "El3awama Stock" };
const TYPE_LABEL = {
  cash_out: "Cash Out",
  cash_transfer: "Cash Transfer",
  cash_collection: "Cash Collection",
  brand_transfer: "Brand Transfer",
  stock_sale: "Stock Sale",
  visit_collection: "Visit Collection",
  cash_conversion: "Cash to Digital",
};
// vodafone_cash is the retired key for the same thing; both render as Wallet
const PAYMENT_LABEL = { cash: "Cash", visa: "Visa", instapay: "InstaPay", wallet: "Wallet", vodafone_cash: "Wallet" };

const FIELD_LABELS = {
  exam_date: "Visit Date",
  scan_types: "Scan Types",
  doctor_id: "Referring Doctor",
  branch_id: "Branch",
  amount_due: "Amount Due",
  discount_pct: "Discount %",
  discount_reason: "Discount Reason",
  notes: "Notes",
};

// The one place every pending admin approval and every assigned task shows
// up - replaces the standalone Expenses Confirmation Queue (folded in here,
// not run as a second, separate queue) and adds a simple task-assignment
// mechanism, since nothing like that existed anywhere on the platform.
export default function ActionCenterPage() {
  const { t, tCode, isAr } = useT();
  const { isAdmin, loading: permsLoading, profile } = usePermissions();
  useAutoRefresh(["visits", "reports"], () => { load(); });
  const [myTasks, setMyTasks] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [approvalFilter, setApprovalFilter] = useState("pending");
  const [visitEdits, setVisitEdits] = useState([]);
  const [excuses, setExcuses] = useState([]);
  // Cash transfers addressed to whoever is signed in. Everyone sees these,
  // admin or not: the person receiving the money is the only one who can say
  // it actually reached them.
  const [myTransfers, setMyTransfers] = useState([]);
  const [visitEditFilter, setVisitEditFilter] = useState("pending");
  const [staffList, setStaffList] = useState([]);
  const [branchMap, setBranchMap] = useState({});
  const [doctorMap, setDoctorMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState({ done: 0, total: 1, label: "Starting", finishedAt: null, failed: [] });
  const [busyId, setBusyId] = useState(null);
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [swaps, setSwaps] = useState([]);
  const [clockFixes, setClockFixes] = useState([]);
  const [alerts, setAlerts] = useState({ stockZero: 0, stockLow: 0, overdueReports: 0 });
  const [attExceptions, setAttExceptions] = useState([]);
  // Card payments Paymob could not account for. They keep their method and
  // wait here for a decision rather than being changed automatically.
  const [cardReviews, setCardReviews] = useState([]);
  const [stockChanges, setStockChanges] = useState([]);
  // Returns from customers waiting for an admin (migration 0111). Nothing
  // goes back into stock or comes off an account until approved here.
  const [saleReturns, setSaleReturns] = useState([]);
  const [returnNote, setReturnNote] = useState({});
  // InstaPay receipts waiting for an admin to confirm the money arrived
  // (0126). There is no gateway to check them against automatically.
  const [instapay, setInstapay] = useState([]);

  useEffect(() => {
    if (!permsLoading && profile) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permsLoading, profile, approvalFilter, visitEditFilter]);

  async function decideInstapay(item, approve) {
    if (!approve && !confirm(item.kind === "card"
      ? tx("Mark {amount} EGP from {name} as NOT paid by card? Correct its payment method afterwards.", { amount: formatMoney(item.amount), name: item.payer })
      : tx("Mark {amount} EGP from {name} as NOT received?", { amount: formatMoney(item.amount), name: item.payer }))) return;
    setBusyId(item.id);
    const fn = item.kind === "card" ? "verify_card_manual" : "verify_instapay";
    const { error } = await supabase.rpc(fn, { p_source: item.source, p_id: item.id, p_approve: approve });
    setBusyId(null);
    if (error) { alert(error.message); return; }
    setInstapay((list) => list.filter((x) => !(x.id === item.id && x.kind === item.kind)));
  }

  async function decideStockChange(id, status) {
    setBusyId(id);
    const { error } = await supabase.rpc("decide_stock_change", {
      p_id: id,
      p_status: status,
      p_by_id: profile?.id || null,
      p_by_name: profile?.name || "",
      p_note: null,
    });
    setBusyId(null);
    if (error) { alert(error.message); return; }
    load();
  }

  async function decideSaleReturn(id, status) {
    setBusyId(id);
    const { error } = await supabase.rpc("decide_sale_return", { p_id: id, p_status: status, p_note: returnNote[id] || null });
    setBusyId(null);
    if (error) { alert(error.message); return; }
    load();
  }

  async function decideCardReview(reviewId, action) {
    setBusyId(reviewId);
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch("/api/paymob/reviews", {
      method: "POST",
      headers: { Authorization: `Bearer ${sess.session?.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ reviewId, action }),
    });
    setBusyId(null);
    if (res.ok) load();
  }

  async function decideSwap(requestId, action) {
    setBusyId(requestId);
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch("/api/admin/shift-swaps", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token}` },
      body: JSON.stringify({ requestId, action }),
    });
    const result = await res.json();
    if (!res.ok) alert(result.error ? tx(result.error) : tx("Could not update that swap."));
    setBusyId(null);
    load();
  }

  async function decideException(id, approve) {
    setBusyId(id);
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch("/api/hr/payroll", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token}` },
      body: JSON.stringify({ action: "decide_exception", id, approve }),
    });
    if (!res.ok) { const e = (await res.json()).error; alert(e ? tx(e) : tx("Could not update that.")); }
    setBusyId(null);
    load();
  }

  async function decideClockFix(requestId, action) {
    setBusyId(requestId);
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch("/api/admin/timeclock-corrections", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token}` },
      body: JSON.stringify({ requestId, action }),
    });
    const r = await res.json();
    if (!res.ok) alert(r.error ? tx(r.error) : tx("Could not update that request."));
    setBusyId(null);
    load();
  }

  // Loading bar (30 Oct 2026): every section reports in as it arrives, so it
  // is obvious when everything is retrieved rather than guessing whether an
  // empty list means "nothing pending" or "not loaded yet".
  async function load() {
    setLoading(true);
    const sections = isAdmin ? 10 : 2;
    let done = 0;
    setProgress({ done: 0, total: sections, label: "Starting", finishedAt: null, failed: [] });
    const failed = [];
    const track = async (label, fn) => {
      try { await fn(); } catch (e) { failed.push(label); }
      done += 1;
      setProgress((p) => ({ ...p, done, label: `${label} loaded`, failed: [...failed] }));
    };
    const { data: sess } = await supabase.auth.getSession();
    const auth = { headers: { Authorization: `Bearer ${sess.session?.access_token}` } };

    const jobs = [];
    jobs.push(track(isAdmin ? "Tasks, approvals, excuses and visit edits" : "Your tasks", async () => {
      const promises = [
        supabase.from("tasks").select("*").eq("assigned_to_id", profile.id).order("created_at", { ascending: false }),
      ];
      if (isAdmin) {
        // Approvals only: visit collections and counter sales are money
        // arriving, recorded as it arrives, and never wait for a decision.
        promises.push(
          supabase
            .from("expense_transactions")
            .select("*, from_employee:from_employee_id(name), to_employee:to_employee_id(name), paymob:paymob_transactions!expense_transactions_paymob_transaction_id_fkey(id, amount, card_last4, created_at_paymob)")
            .eq("status", approvalFilter)
            .is("source_payment_id", null)
            .not("type", "in", "(visit_collection,stock_sale)")
            .order("created_at", { ascending: false })
        );
        promises.push(supabase.from("staff_profiles").select("id, name").order("name"));
        promises.push(
          supabase
            .from("excuse_submissions")
            .select("*, employees(name), excuse_rules(name)")
            .eq("status", "pending")
            .order("created_at", { ascending: false })
        );
        promises.push(
          supabase
            .from("visit_edit_requests")
            .select("*, visits(patient_id, patients(name))")
            .eq("status", visitEditFilter)
            .order("created_at", { ascending: false })
        );
        promises.push(supabase.from("branches").select("id, name"));
        promises.push(supabase.from("doctors").select("id, name, clinic_name"));
      }
      const results = await Promise.all(promises);
      setMyTasks(results[0].data || []);
      if (isAdmin) {
        // Unpacked by position in the order the promises were pushed above.
        const [, approvalsRes, staffRes, excusesRes, visitEditsRes, branchesRes, doctorsRes] = results;
        setApprovals(approvalsRes.data || []);
        setStaffList(staffRes.data || []);
        setExcuses(excusesRes.data || []);
        setVisitEdits(visitEditsRes.data || []);
        setBranchMap(Object.fromEntries((branchesRes.data || []).map((b) => [b.id, b.name])));
        setDoctorMap(Object.fromEntries((doctorsRes.data || []).map((d) => [d.id, `${d.name} - ${d.clinic_name}`])));
      }
    }));

    // The cash ledger is keyed on employees while the login is a staff profile;
    // staff_account_email is the link between the two.
    jobs.push(track("Cash transfers to you", async () => {
      if (!profile?.email) return;
      const { data: meEmp } = await supabase.from("employees").select("id").ilike("staff_account_email", profile.email).maybeSingle();
      if (!meEmp?.id) { setMyTransfers([]); return; }
      const { data: incoming } = await supabase
        .from("expense_transactions")
        .select("*, from_employee:from_employee_id(name)")
        .eq("type", "cash_transfer")
        .eq("to_employee_id", meEmp.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      setMyTransfers(incoming || []);
    }));

    if (isAdmin) {
      jobs.push(track("Shift swaps", async () => {
        const r = await fetch("/api/admin/shift-swaps", auth);
        if (!r.ok) throw new Error("swaps");
        setSwaps((await r.json()).requests || []);
      }));
      // Things nobody is told about unless they go looking for them.
      jobs.push(track("Stock and report alerts", async () => {
        const [{ data: stock }, { data: rep }] = await Promise.all([
          supabase.from("stock_items").select("qty_remaining, reorder_level"),
          supabase.from("reports").select("date_required, status").eq("status", "pending"),
        ]);
        const todayStr = new Date().toISOString().slice(0, 10);
        setAlerts({
          stockZero: (stock || []).filter((i) => Number(i.qty_remaining || 0) <= 0).length,
          stockLow: (stock || []).filter((i) => Number(i.qty_remaining || 0) > 0 && Number(i.qty_remaining || 0) <= Number(i.reorder_level ?? 3)).length,
          overdueReports: (rep || []).filter((r) => r.date_required && r.date_required < todayStr).length,
        });
      }));
      jobs.push(track("Attendance exceptions", async () => {
        const r = await fetch("/api/hr/payroll?exceptions=1", auth);
        if (!r.ok) throw new Error("exceptions");
        setAttExceptions((await r.json()).exceptions || []);
      }));
      jobs.push(track("Clock corrections", async () => {
        const r = await fetch("/api/admin/timeclock-corrections", auth);
        if (!r.ok) throw new Error("fixes");
        setClockFixes((await r.json()).requests || []);
      }));
      // InstaPay has no gateway, so every receipt waits here; card payments on
      // accounts and counter sales come here only when Paymob has no charge
      // for them after an hour (0126, 0127).
      jobs.push(track("Payments to verify", async () => {
        const [ip, cards] = await Promise.all([supabase.rpc("instapay_pending"), supabase.rpc("cards_unproven")]);
        if (ip.error) throw ip.error;
        if (cards.error) throw cards.error;
        setInstapay([
          ...(ip.data || []).map((x) => ({ ...x, kind: "instapay" })),
          ...(cards.data || []).map((x) => ({ ...x, kind: "card" })),
        ].sort((a, b) => String(a.recorded_at).localeCompare(String(b.recorded_at))));
      }));
      jobs.push(track("Card payments to review", async () => {
        const r = await fetch("/api/paymob/reviews?status=pending", auth);
        if (!r.ok) throw new Error("cards");
        setCardReviews((await r.json()).reviews || []);
      }));
      // Proposed changes to what stock is worth wait for a decision.
      jobs.push(track("Stock price changes", async () => {
        const { data: sc } = await supabase
          .from("stock_change_requests")
          .select("*, stock_items(name, item_code, category, qty_remaining)")
          .eq("status", "pending")
          .order("requested_at", { ascending: false });
        setStockChanges(sc || []);
      }));
      jobs.push(track("Sale returns", async () => {
        const { data: sr } = await supabase
          .from("sale_returns")
          .select("*, sale_return_lines(item_name, qty, unit_price)")
          .eq("status", "pending")
          .order("requested_at", { ascending: false });
        setSaleReturns(sr || []);
      }));
    }

    await Promise.all(jobs);
    setProgress((p) => ({ ...p, done: sections, label: "Everything loaded", finishedAt: new Date() }));
    setLoading(false);
  }

  async function markTaskDone(task) {
    setBusyId(task.id);
    await supabase.from("tasks").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", task.id);
    setBusyId(null);
    load();
  }

  // A Visa conversion recorded before Paymob synced the charge: look again.
  async function recheckPaymob(item) {
    setBusyId(item.id);
    const { data, error } = await supabase.rpc("match_conversion_paymob", { p_expense_id: item.id });
    setBusyId(null);
    if (error) { alert(error.message); return; }
    if (!data) alert(tx("Still no Paymob charge of this amount around that time. Paymob syncs every few minutes, or the card may not have gone through."));
    load();
  }

  async function reviewApproval(item, newStatus) {
    // Guarded here as well as in the markup: the buttons are hidden for
    // transfers, but nothing else stops this function being reached.
    if (item.type === "cash_transfer") return;
    if (newStatus === "confirmed" && item.type === "cash_conversion" && item.payment_method === "visa" && !item.paymob) {
      if (!confirm(tx("There is no Paymob card charge matching this conversion. Confirm it anyway?"))) return;
    }
    setBusyId(item.id);
    const { data: session } = await supabase.auth.getSession();
    await supabase
      .from("expense_transactions")
      .update({
        status: newStatus,
        confirmed_by_id: session.session?.user?.id || null,
        confirmed_by_name: profile?.name || null,
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    logActivity({
      actorId: profile?.id,
      actorName: profile?.name,
      actorType: "admin",
      action: `expense_${newStatus}`,
      entityType: "expense_transaction",
      entityId: item.id,
      details: { type: item.type, brand: item.brand, amount: item.amount },
    });
    setBusyId(null);
    load();
  }

  async function reviewExcuse(item, newStatus) {
    setBusyId(item.id);
    await supabase
      .from("excuse_submissions")
      .update({ status: newStatus, reviewed_by: profile?.id || null, reviewed_at: new Date().toISOString() })
      .eq("id", item.id);
    logActivity({
      actorId: profile?.id,
      actorName: profile?.name,
      actorType: "admin",
      action: `excuse_${newStatus}`,
      entityType: "excuse_submission",
      entityId: item.id,
      details: { employee: item.employees?.name, rule: item.excuse_rules?.name },
    });
    setBusyId(null);
    load();
  }

  // Confirming here is the recipient saying the notes reached them, so it is
  // deliberately the only path that sets a transfer to confirmed.
  async function reviewMyTransfer(item, newStatus) {
    setBusyId(item.id);
    const { data: session } = await supabase.auth.getSession();
    await supabase
      .from("expense_transactions")
      .update({
        status: newStatus,
        confirmed_by_id: session.session?.user?.id || null,
        confirmed_by_name: profile?.name || null,
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    logActivity({
      actorId: profile?.id,
      actorName: profile?.name,
      actorType: "employee",
      action: `cash_transfer_${newStatus}`,
      entityType: "expense_transaction",
      entityId: item.id,
      details: { amount: item.amount, from: item.from_employee?.name },
    });
    setBusyId(null);
    load();
  }

  async function reviewVisitEdit(item, newStatus) {
    setBusyId(item.id);
    if (newStatus === "approved") {
      const { error: vErr } = await supabase.from("visits").update(item.requested_values).eq("id", item.visit_id);
      if (vErr) {
        setBusyId(null);
        alert(tx("Could not apply this edit: {error}", { error: vErr.message }));
        return;
      }
      // An approved edit can change exam_date, which patients.last_visit_date
      // needs to reflect for the patient list to sort correctly.
      if (item.visits?.patient_id) {
        await syncPatientLastVisitDate(supabase, item.visits.patient_id);
      }
      // A pending payment only becomes a real visit_payments row now, at
      // approval, not when it was first requested - and it's attributed to
      // whoever originally requested it (the employee who actually collected
      // the cash), not to the admin approving it here. paid_at is explicitly
      // set to when the request was submitted, not left to default to the
      // approval moment: the cash was physically collected on the
      // submission day, and approval can genuinely happen a day or more
      // later, which would otherwise misattribute it to the wrong day's
      // cash-in-hand for whoever collected it.
      if (item.pending_payment_amount > 0) {
        const { error: payErr } = await supabase.from("visit_payments").insert({
          visit_id: item.visit_id,
          amount: item.pending_payment_amount,
          payment_method: item.pending_payment_method || "Cash",
          created_by_id: item.requested_by_id || null,
          created_by_name: item.requested_by_name || null,
          paid_at: item.created_at,
        });
        if (payErr) {
          setBusyId(null);
          alert(tx("Visit changes were applied, but the payment could not be logged: {error}", { error: payErr.message }));
          return;
        }
      }
    }
    await supabase
      .from("visit_edit_requests")
      .update({
        status: newStatus,
        reviewed_by_id: profile?.id || null,
        reviewed_by_name: profile?.name || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    logActivity({
      actorId: profile?.id,
      actorName: profile?.name,
      actorType: "admin",
      action: `visit_edit_${newStatus}`,
      entityType: "visit",
      entityId: item.visit_id,
      details: { requestedValues: item.requested_values },
    });
    setBusyId(null);
    load();
  }

  function formatFieldValue(field, value) {
    if (value === null || value === undefined || value === "") return "—";
    if (field === "exam_date") return new Date(value + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    if (field === "doctor_id") return doctorMap[value] || tx("Walk-in");
    if (field === "branch_id") return branchMap[value] || value;
    if (field === "scan_types") return Array.isArray(value) ? value.join(", ") : value;
    if (field === "amount_due") return `${Number(value).toFixed(2)} ${tx("EGP")}`;
    if (field === "discount_pct") return `${value}%`;
    return String(value);
  }

  function diffFields(prev, next) {
    const fields = Object.keys(FIELD_LABELS);
    return fields.filter((f) => JSON.stringify(prev?.[f] ?? null) !== JSON.stringify(next?.[f] ?? null));
  }

  if (permsLoading || !profile) return <p style={{ color: theme.gray }}>{t("Loading...")}</p>;

  const pendingTasks = myTasks.filter((t) => t.status === "pending");
  const doneTasks = myTasks.filter((t) => t.status === "done");

  return (
    <div>
      <h1 style={{ color: theme.navy, margin: "0 0 4px" }}>{t("Action Center")}</h1>
      <p style={{ color: theme.gray, margin: "0 0 14px" }}>{isAdmin ? t("Your assigned tasks, and every pending approval platform-wide.") : t("Your assigned tasks.")}</p>

      {/* Loading bar: fills as each section arrives and says when all of
          them are in, so an empty list is never mistaken for a finished one. */}
      {(() => {
        const pct = Math.round((progress.done / Math.max(progress.total, 1)) * 100);
        const finished = !loading && progress.finishedAt;
        const bad = progress.failed.length > 0;
        const color = finished ? (bad ? "#ba1a1a" : "#1e7a3c") : theme.gold;
        return (
          <div style={{ position: "sticky", top: 0, zIndex: 5, background: "#fff", borderRadius: 12, padding: "10px 14px", marginBottom: 18, boxShadow: "0 2px 12px rgba(39,33,77,0.06)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, fontSize: 12.5, marginBottom: 6, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, color: finished ? color : theme.navy }}>
                {finished
                  ? bad
                    ? t("Loaded with problems: {list} did not load. Refresh to try again.", { list: progress.failed.map((f) => t(f)).join(isAr ? "، " : ", ") })
                    : `✓ ${t("Everything loaded · all {n} sections", { n: progress.total })}`
                  : t("Loading {done} of {total} sections · {label}...", { done: progress.done, total: progress.total, label: progress.label.endsWith(" loaded") ? t("{section} loaded", { section: t(progress.label.slice(0, -7)) }) : t(progress.label) })}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 10, color: theme.gray }}>
                {finished && progress.finishedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                {finished && (
                  <button onClick={load} style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${theme.navy}`, background: "#fff", color: theme.navy, fontWeight: 700, fontSize: 11, cursor: "pointer" }}>
                    {t("Refresh")}
                  </button>
                )}
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: "#eeedf3", overflow: "hidden" }}>
              <div style={{ width: `${finished ? 100 : pct}%`, height: "100%", background: color, borderRadius: 999, transition: "width 0.35s ease" }} />
            </div>
          </div>
        );
      })()}

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginBottom: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ color: theme.navy, margin: 0 }}>{t("My Tasks")}</h3>
          {isAdmin && (
            <button onClick={() => setShowAssignForm((v) => !v)} style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${theme.navy}`, background: "#fff", color: theme.navy, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
              {showAssignForm ? t("Cancel") : t("+ Assign Task")}
            </button>
          )}
        </div>

        {showAssignForm && <AssignTaskForm staffList={staffList} profile={profile} onClose={() => setShowAssignForm(false)} onAssigned={load} />}

        {!loading && pendingTasks.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>{t("Nothing pending.")}</p>}
        <div style={{ display: "grid", gap: 8 }}>
          {pendingTasks.map((task) => (
            <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid #f0f0f0" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: theme.navy, fontSize: 14 }}>{task.title}</div>
                {task.description && <div style={{ fontSize: 13, color: theme.gray, marginTop: 2 }}>{task.description}</div>}
                <div style={{ fontSize: 11, color: theme.gray, marginTop: 4 }}>
                  {t("Assigned by {name}", { name: task.created_by_name || t("admin") })}{" \u00b7 "}{new Date(task.created_at).toLocaleDateString()}
                </div>
              </div>
              <button onClick={() => markTaskDone(task)} disabled={busyId === task.id} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#2e7d32", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}>
                {busyId === task.id ? "..." : t("Mark Done")}
              </button>
            </div>
          ))}
        </div>
        {doneTasks.length > 0 && (
          <details style={{ marginTop: 12 }}>
            <summary style={{ fontSize: 12, color: theme.gray, cursor: "pointer" }}>{t(doneTasks.length === 1 ? "{n} completed task" : "{n} completed tasks", { n: doneTasks.length })}</summary>
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              {doneTasks.map((task) => (
                <div key={task.id} style={{ fontSize: 12, color: theme.gray, padding: "6px 0", borderBottom: "1px solid #f5f5f5" }}>
                  <span style={{ textDecoration: "line-through" }}>{task.title}</span>{" \u00b7 "}{t("done {date}", { date: new Date(task.completed_at).toLocaleDateString() })}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {isAdmin && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)", marginBottom: 20 }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>
            {t("InstaPay to verify")}
            {instapay.filter((x) => x.kind === "instapay").length > 0 && <span style={{ marginInlineStart: 8, fontSize: 12, background: "#fff3e0", color: "#a97c00", padding: "2px 10px", borderRadius: 999 }}>{instapay.filter((x) => x.kind === "instapay").length}</span>}
          </h3>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 12 }}>
            {t("Every InstaPay payment waits here until you check it reached the HSBC account. Confirm and it shows as Verified everywhere.")}
          </p>
          {!loading && instapay.filter((x) => x.kind === "instapay").length === 0 && <p style={{ color: theme.gray, fontSize: 13, margin: 0 }}>{t("Nothing waiting. Every InstaPay payment is verified.")}</p>}
          <div style={{ display: "grid", gap: 8 }}>
            {instapay.filter((x) => x.kind === "instapay").map((p) => (
              <div key={p.kind + p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid #f0f0f0", flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999, minWidth: 92, textAlign: "center",
                  background: p.kind === "card" ? "#fff3e0" : "#eef2ff", color: p.kind === "card" ? "#a97c00" : "#3949ab" }}>
                  {p.kind === "card" ? (p.source === "counter" ? t("Counter sale") : t("Account payment")) : t("InstaPay")}
                </span>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 800, color: theme.navy, fontSize: 15 }}>
                    <Ltr>{formatMoney(p.amount)} {t("EGP")}</Ltr> <span style={{ fontWeight: 600, color: theme.gray, fontSize: 13 }}>{t("from {name}", { name: p.payer })}{p.kind === "card" ? ` · ${t("Visa")}` : ""}</span>
                  </div>
                  <div style={{ fontSize: 12, color: theme.gray }}>
                    {p.detail} · {new Date(p.recorded_at).toLocaleString("en-GB", { timeZone: "Africa/Cairo", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {t("recorded by {name}", { name: p.recorded_by || t("unknown") })}
                  </div>
                  {p.kind === "card" && (
                    <div style={{ fontSize: 12, color: p.hint ? "#8a6d00" : "#ba1a1a", marginTop: 2 }}>
                      {p.hint ? t("Clue: {hint}. Maybe recorded on a different day.", { hint: p.hint }) : t("No card charge of this amount on Paymob within 3 days. Check with whoever recorded it.")}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {p.link && (
                    <a href={p.link} target="_blank" rel="noreferrer"
                      style={{ color: theme.navy, fontSize: 12, fontWeight: 700, padding: "8px 10px", textDecoration: "underline" }}>
                      {p.source === "counter" ? t("Open orders") : t("Open statement")}
                    </a>
                  )}
                  <button onClick={() => decideInstapay(p, true)} disabled={busyId === p.id} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#2e7d32", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
                    {p.kind === "card" ? `✓ ${t("Money arrived")}` : `✓ ${t("Received")}`}
                  </button>
                  <button onClick={() => decideInstapay(p, false)} disabled={busyId === p.id} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: "#ba1a1a", cursor: "pointer", fontSize: 12 }}>
                    {p.kind === "card" ? t("Not by card") : t("Not received")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {isAdmin && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Pending Approvals")}</h3>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
            {t("Cash Outs, Cash Collections, Brand Transfers and Conversions that need your confirmation. Money taken from patients or over the counter is recorded automatically and appears in Brands Cash, not here.")}
          </p>
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {["pending", "confirmed", "rejected"].map((s) => (
              <button
                key={s}
                onClick={() => setApprovalFilter(s)}
                style={{
                  padding: "6px 16px", borderRadius: 999, border: `1px solid ${approvalFilter === s ? theme.gold : "#ddd"}`,
                  background: approvalFilter === s ? theme.goldLight : "#fff", color: theme.navy, fontSize: 12, fontWeight: 600, cursor: "pointer", textTransform: "capitalize",
                }}
              >
                {tCode(s)}
              </button>
            ))}
          </div>
          {!loading && approvals.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>{approvalFilter === "pending" ? t("Nothing pending.") : approvalFilter === "confirmed" ? t("Nothing confirmed.") : t("Nothing rejected.")}</p>}
          <div style={{ display: "grid", gap: 8 }}>
            {approvals.map((ex) => (
              <div key={ex.id} style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 0", borderBottom: "1px solid #f0f0f0" }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: "#eef2ff", color: "#3949ab", minWidth: 100, textAlign: "center" }}>
                  {TYPE_LABEL[ex.type] ? t(TYPE_LABEL[ex.type]) : (isAr ? tCode(ex.type) : ex.type)}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, color: theme.navy, fontSize: 14 }}>
                    <Ltr>{formatMoney(ex.amount)} {t("EGP")}</Ltr> <span style={{ fontWeight: 500, color: theme.gray }}>{t("via {method}", { method: PAYMENT_LABEL[ex.payment_method] ? t(PAYMENT_LABEL[ex.payment_method]) : "" })}</span>
                  </div>
                  <div style={{ fontSize: 12, color: theme.gray }}>
                    {BRAND_LABEL[ex.brand] ? t(BRAND_LABEL[ex.brand]) : ""}
                    {ex.to_brand && ` ${isAr ? "\u2190" : "\u2192"} ${BRAND_LABEL[ex.to_brand] ? t(BRAND_LABEL[ex.to_brand]) : ""}`}
                    {ex.from_employee?.name && ` \u00b7 ${t("From {name}", { name: ex.from_employee.name })}`}
                    {ex.to_employee?.name && ` \u00b7 ${t("To {name}", { name: ex.to_employee.name })}`}
                    {ex.category && ` \u00b7 ${ex.category}`}
                  </div>
                  {ex.note && <div style={{ fontSize: 12, color: theme.gray, fontStyle: "italic" }}>{ex.note}</div>}
                  {/* Cash converted to card: the Paymob charge it matches, so
                      an admin confirms against the money actually arriving. */}
                  {ex.type === "cash_conversion" && ex.payment_method === "visa" && (
                    ex.paymob ? (
                      <div style={{ fontSize: 12, color: "#1e7a3c", fontWeight: 600, marginTop: 2 }}>
                        <VerifyPill method="visa" paymobId={ex.paymob.id} cardLast4={ex.paymob.card_last4} />{" "}{t("Paymob: {amount} EGP, card ••{last4}", { amount: formatMoney(ex.paymob.amount), last4: ex.paymob.card_last4 || "?" })}, {String(ex.paymob.created_at_paymob || "").slice(0, 16).replace("T", " ")}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: "#ba1a1a", fontWeight: 600, marginTop: 2, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        ⚠ {t("No matching Paymob card charge found")}
                        {ex.status === "pending" && (
                          <button onClick={() => recheckPaymob(ex)} disabled={busyId === ex.id}
                            style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid #ba1a1a", background: "#fff", color: "#ba1a1a", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                            {t("Check Paymob again")}
                          </button>
                        )}
                      </div>
                    )
                  )}
                  {ex.type === "cash_conversion" && ex.payment_method !== "visa" && ex.status === "pending" && (
                    <div style={{ fontSize: 12, color: "#8a6d00", marginTop: 2 }}>{t("Check the {method} account received it before confirming.", { method: PAYMENT_LABEL[ex.payment_method] ? t(PAYMENT_LABEL[ex.payment_method]) : (isAr ? tCode(ex.payment_method) : ex.payment_method) })}</div>
                  )}
                  <div style={{ fontSize: 11, color: theme.gray }}>
                    {ex.entry_date}{" \u00b7 "}{t("logged by {name}", { name: ex.created_by_name || t("unknown") })}
                    {/* A row confirmed by the same person who logged it was not
                        reviewed by anybody - it was written already confirmed.
                        Saying "reviewed by Nourhan" under a line saying "logged
                        by Nourhan" claims an oversight step that never happened,
                        which is worse than saying nothing. */}
                    {ex.confirmed_by_name &&
                      (ex.confirmed_by_name === ex.created_by_name
                        ? ` \u00b7 ${t("auto-confirmed")}`
                        : ` \u00b7 ${t("reviewed by {name}", { name: ex.confirmed_by_name })}`)}
                  </div>
                </div>
                {ex.status === "pending" && ex.type === "cash_transfer" && (
                  // A cash transfer says one person handed notes to another.
                  // Only the person who received them can honestly say so, and
                  // they confirm it in their own portal. An admin confirming
                  // here would record someone as holding money they may never
                  // have been given - which is exactly what happened once.
                  <div style={{ fontSize: 11, color: "#8a6d00", background: "#fff8e1", border: "1px solid #f0d58c", borderRadius: 8, padding: "8px 12px", maxWidth: 260 }}>
                    {ex.to_employee?.name ? t("Waiting for {name} to confirm they received this in their portal.", { name: ex.to_employee.name }) : t("Waiting for the recipient to confirm they received this in their portal.")}
                  </div>
                )}
                {ex.status === "pending" && ex.type !== "cash_transfer" && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => reviewApproval(ex, "confirmed")} disabled={busyId === ex.id} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#2e7d32", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
                      {t("Confirm")}
                    </button>
                    <button onClick={() => reviewApproval(ex, "rejected")} disabled={busyId === ex.id} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, cursor: "pointer", fontSize: 12 }}>
                      {t("Reject")}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {isAdmin && (alerts.stockZero > 0 || alerts.stockLow > 0 || alerts.overdueReports > 0) && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Needs Attention")}</h3>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
            {alerts.stockZero > 0 && (
              <a href="/dashboard?tab=stockalerts" style={alertBox("#fdecea", "#ba1a1a")}>
                <strong>{alerts.stockZero}</strong> {alerts.stockZero === 1 ? t("item out of stock") : t("items out of stock")}
                <span style={{ display: "block", fontSize: 11, fontWeight: 400 }}>{t("Doctors can still order these — checkout will fail")}</span>
              </a>
            )}
            {alerts.stockLow > 0 && (
              <a href="/dashboard?tab=stockalerts" style={alertBox("#fff8e1", "#a97c00")}>
                <strong>{alerts.stockLow}</strong> {alerts.stockLow === 1 ? t("item running low") : t("items running low")}
                <span style={{ display: "block", fontSize: 11, fontWeight: 400 }}>{t("At or below their restock level")}</span>
              </a>
            )}
            {alerts.overdueReports > 0 && (
              <a href="/dashboard?tab=requests" style={alertBox("#fdecea", "#ba1a1a")}>
                <strong>{alerts.overdueReports}</strong> {alerts.overdueReports === 1 ? t("report overdue") : t("reports overdue")}
                <span style={{ display: "block", fontSize: 11, fontWeight: 400 }}>{t("Past the date the requester was promised")}</span>
              </a>
            )}
          </div>
        </div>
      )}

      {myTransfers.length > 0 && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Cash Handed To You")}</h3>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
            {t("Confirm only once the money is actually in your hands — it is added to your balance and settled against your salary if you still hold it at payroll.")}
          </p>
          {myTransfers.map((tr) => (
            <div key={tr.id} style={{ padding: "12px 0", borderBottom: "1px solid #f0f0f0" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: theme.navy }}>
                <Ltr>{Number(tr.amount).toLocaleString()} {t("EGP")}</Ltr> {t("from {name}", { name: tr.from_employee?.name || t("unknown") })}
              </div>
              {tr.note && <div style={{ fontSize: 12, color: theme.gray, fontStyle: "italic" }}>{tr.note}</div>}
              <div style={{ fontSize: 11, color: theme.gray, marginBottom: 8 }}>
                {tr.entry_date}{" \u00b7 "}{t("logged by {name}", { name: tr.created_by_name || t("unknown") })}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => reviewMyTransfer(tr, "confirmed")} disabled={busyId === tr.id} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#2e7d32", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
                  {t("I received this")}
                </button>
                <button onClick={() => reviewMyTransfer(tr, "rejected")} disabled={busyId === tr.id} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, cursor: "pointer", fontSize: 12 }}>
                  {t("I did not")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isAdmin && excuses.length > 0 && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Excuse Requests")}</h3>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
            {t("Late arrivals, early leaves and absences staff have asked you to excuse.")}
          </p>
          {excuses.map((x) => (
            <div key={x.id} style={{ padding: "12px 0", borderBottom: "1px solid #f0f0f0" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: theme.navy }}>
                {x.employees?.name}{x.excuse_rules?.name ? ` \u00b7 ${x.excuse_rules.name}` : ""}
              </div>
              {x.note && (
                <div style={{ fontSize: 12, color: theme.navy, fontStyle: "italic", margin: "4px 0 6px" }} dir="auto">
                  &ldquo;{x.note}&rdquo;
                </div>
              )}
              <div style={{ fontSize: 11, color: theme.gray, marginBottom: 8 }}>
                {t("Submitted {date}", { date: new Date(x.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) })}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => reviewExcuse(x, "approved")} disabled={busyId === x.id} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#2e7d32", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
                  {t("Approve")}
                </button>
                <button onClick={() => reviewExcuse(x, "rejected")} disabled={busyId === x.id} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, cursor: "pointer", fontSize: 12 }}>
                  {t("Reject")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isAdmin && attExceptions.length > 0 && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Days Awaiting a Pay Decision")}</h3>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
            {t("Signed in but never signed out. Until you decide, the day is neither paid nor unpaid — so a forgotten tap costs nobody a day's wage, and nobody is paid for a day they did not work.")}
          </p>
          {attExceptions.map((x) => (
            <div key={x.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #f0f0f0", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: theme.navy }}>{x.employees?.name}</div>
                <div style={{ fontSize: 11, color: theme.gray }}>
                  {new Date(x.work_date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} &middot; {x.reason}
                  {x.employees?.hourly_rate ? ` · ${t("paid hourly")}` : ` · ${t("monthly salary")}`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => decideException(x.id, true)} disabled={busyId === x.id}
                  style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: "#1e7a3c", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                  {t("Credit the day")}
                </button>
                <button onClick={() => decideException(x.id, false)} disabled={busyId === x.id}
                  style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                  {t("Do not pay")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isAdmin && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Returns Awaiting Your Approval")}</h3>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
            {t("Items a doctor brought back. Approving puts them back into stock and takes the amount off the clinic's account, or refunds it as shown. Rejecting changes nothing.")}
          </p>
          {saleReturns.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>{t("Nothing waiting.")}</p>}
          {saleReturns.map((r) => (
            <div key={r.id} style={{ padding: "12px 0", borderBottom: "1px solid #f0f0f0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: theme.navy, fontSize: 14 }} dir="auto">
                    {r.receipt_no || t("Doctor portal order")} · {r.customer_label || ""} · <Ltr>{formatMoney(r.total_value)} {t("EGP")}</Ltr>
                  </div>
                  <div style={{ fontSize: 12, color: theme.gray }} dir="auto">
                    {(r.sale_return_lines || []).map((l) => `${l.item_name} \u00d7${Number(l.qty)} @ ${formatMoney(l.unit_price)}`).join(", ")}
                  </div>
                  <div style={{ fontSize: 12, color: theme.gray }}>
                    {t({ account: "Comes off the clinic's account", credit: "Credit on the clinic's account", cash: "Cash refund from the employee's cash in hand", tab: "Comes off the staff tab" }[r.refund_mode])}
                    {" · "}{t("Reason:")} {r.reason}{r.requested_by_name ? ` · ${t("asked by {name}", { name: r.requested_by_name })}` : ""}
                  </div>
                  <input
                    value={returnNote[r.id] || ""}
                    onChange={(e) => setReturnNote((n) => ({ ...n, [r.id]: e.target.value }))}
                    placeholder={t("Note (optional)")}
                    style={{ marginTop: 6, padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 12, width: 240, maxWidth: "100%" }}
                  />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => decideSaleReturn(r.id, "approved")} disabled={busyId === r.id}
                    style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                    {busyId === r.id ? "..." : t("Approve")}
                  </button>
                  <button onClick={() => decideSaleReturn(r.id, "rejected")} disabled={busyId === r.id}
                    style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: "#ba1a1a", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                    {t("Reject")}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isAdmin && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Stock Value Changes Awaiting Your Approval")}</h3>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
            {t("Quantity, purchase price and sale price decide what the stock is worth, what a clinic is charged, and what a missing item costs an employee. Nothing changes until you approve it.")}
          </p>
          {stockChanges.length === 0 && (
            <p style={{ color: theme.gray, fontSize: 13 }}>{t("Nothing waiting.")}</p>
          )}
          {stockChanges.map((c) => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 0", borderBottom: "1px solid #f0f0f0" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: theme.navy, fontSize: 14 }}>
                  {c.stock_items?.item_code ? `${c.stock_items.item_code} · ` : ""}{c.stock_items?.name || t("Item")}
                </div>
                {c.field === "qty_remaining" && c.delta != null ? (
                  // A quantity request is a change, applied to the stock as it
                  // stands when approved. Showing "42 -> 22" read as "set it to
                  // 22", which is exactly how 150 units from a PO that landed
                  // in between were wiped on توبيكال جيل مصرى.
                  <div style={{ fontSize: 12, color: theme.gray }}>
                    {t("Quantity")}{" "}
                    <span style={{ color: Number(c.delta) < 0 ? "#ba1a1a" : "#1e7a3c", fontWeight: 700 }}>
                      {Number(c.delta) > 0 ? "+" : ""}{formatMoney(c.delta)}
                    </span>
                    {` · ${t("in stock now")} `}<strong style={{ color: theme.navy }}>{formatMoney(c.stock_items?.qty_remaining)}</strong>
                    {isAr ? " \u2190 " : " \u2192 "}
                    <strong style={{ color: theme.navy }}>{formatMoney(Number(c.stock_items?.qty_remaining || 0) + Number(c.delta))}</strong>
                    {Number(c.stock_items?.qty_remaining) !== Number(c.old_value) && (
                      <div style={{ color: "#a06000" }}>{t("Stock moved from {qty} since this was asked. The change still applies on top of today's figure.", { qty: formatMoney(c.old_value) })}</div>
                    )}
                    {c.reason ? <div>{t("Reason:")} {c.reason}</div> : null}
                    {c.requested_by_name ? <div>{t("Asked by {name}", { name: c.requested_by_name })}</div> : null}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: theme.gray }}>
                    {STOCK_FIELD_LABEL[c.field] ? t(STOCK_FIELD_LABEL[c.field]) : c.field}{" "}
                    <span style={{ color: "#ba1a1a" }}>{formatMoney(c.old_value)}</span>
                    {isAr ? " \u2190 " : " \u2192 "}
                    <span style={{ color: "#1e7a3c", fontWeight: 700 }}>{formatMoney(c.new_value)}</span>
                    {c.requested_by_name ? ` · ${t("asked by {name}", { name: c.requested_by_name })}` : ""}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => decideStockChange(c.id, "approved")} disabled={busyId === c.id}
                  style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                  {busyId === c.id ? "..." : t("Approve")}
                </button>
                <button onClick={() => decideStockChange(c.id, "rejected")} disabled={busyId === c.id}
                  style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: "#ba1a1a", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                  {t("Reject")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isAdmin && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Card Payments Awaiting Your Approval")}</h3>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
            {t("Recorded as Visa or wallet, but Paymob has no matching charge. \"Money arrived\" says it did and puts your name to it. \"Not by card\" changes nothing on its own: correct the payment method afterwards so the cash total moves with it.")}
          </p>
          {cardReviews.length === 0 && instapay.every((x) => x.kind !== "card") && <p style={{ color: theme.gray, fontSize: 13 }}>{t("Every card payment is accounted for.")}</p>}
          {/* Clinic / client account payments and counter sales recorded as
              Visa with no Paymob charge after an hour (0127). Same question
              as the visit payments below, so they sit in the same section. */}
          <div style={{ display: "grid", gap: 0 }}>
            {instapay.filter((x) => x.kind === "card").map((p) => (
              <div key={p.kind + p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid #f0f0f0", flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999, minWidth: 92, textAlign: "center",
                  background: p.kind === "card" ? "#fff3e0" : "#eef2ff", color: p.kind === "card" ? "#a97c00" : "#3949ab" }}>
                  {p.kind === "card" ? (p.source === "counter" ? t("Counter sale") : t("Account payment")) : t("InstaPay")}
                </span>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 800, color: theme.navy, fontSize: 15 }}>
                    <Ltr>{formatMoney(p.amount)} {t("EGP")}</Ltr> <span style={{ fontWeight: 600, color: theme.gray, fontSize: 13 }}>{t("from {name}", { name: p.payer })}{p.kind === "card" ? ` · ${t("Visa")}` : ""}</span>
                  </div>
                  <div style={{ fontSize: 12, color: theme.gray }}>
                    {p.detail} · {new Date(p.recorded_at).toLocaleString("en-GB", { timeZone: "Africa/Cairo", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {t("recorded by {name}", { name: p.recorded_by || t("unknown") })}
                  </div>
                  {p.kind === "card" && (
                    <div style={{ fontSize: 12, color: p.hint ? "#8a6d00" : "#ba1a1a", marginTop: 2 }}>
                      {p.hint ? t("Clue: {hint}. Maybe recorded on a different day.", { hint: p.hint }) : t("No card charge of this amount on Paymob within 3 days. Check with whoever recorded it.")}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {p.link && (
                    <a href={p.link} target="_blank" rel="noreferrer"
                      style={{ color: theme.navy, fontSize: 12, fontWeight: 700, padding: "8px 10px", textDecoration: "underline" }}>
                      {p.source === "counter" ? t("Open orders") : t("Open statement")}
                    </a>
                  )}
                  <button onClick={() => decideInstapay(p, true)} disabled={busyId === p.id} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#2e7d32", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
                    {p.kind === "card" ? `✓ ${t("Money arrived")}` : `✓ ${t("Received")}`}
                  </button>
                  <button onClick={() => decideInstapay(p, false)} disabled={busyId === p.id} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: "#ba1a1a", cursor: "pointer", fontSize: 12 }}>
                    {p.kind === "card" ? t("Not by card") : t("Not received")}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {/* Visit payments, drawn in the same row as the account and counter
              payments above so the whole section reads as one list (30 Oct
              2026): type tag, who and how much, the details, the clue, and
              the two decisions on the right. */}
          {cardReviews.map((r) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid #f0f0f0", flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999, minWidth: 92, textAlign: "center", background: "#fff3e0", color: "#a97c00" }}>
                {t("Patient visit")}
              </span>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 800, color: theme.navy, fontSize: 15 }}>
                  <Ltr>{formatMoney(r.amount)} {t("EGP")}</Ltr>{" "}
                  <span style={{ fontWeight: 600, color: theme.gray, fontSize: 13 }}>
                    {r.patient_name ? t("from {name}", { name: r.patient_name }) : ""} · {isAr ? tCode(r.payment_method) : r.payment_method}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: theme.gray }}>
                  {(r.scan_types || []).join(", ") || t("Visit")}
                  {r.doctor_name ? ` · ${t("referred by {name}", { name: r.doctor_name })}` : ""}
                  {" · "}{t("visit {date}", { date: r.exam_date ? formatVisitDateTime(r.exam_date, r.exam_time) : t("date not recorded") })}
                  {" · "}{t("captured {date}", { date: new Date(r.paid_at).toLocaleString("en-GB", { timeZone: "Africa/Cairo", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) })}
                  {r.visit_amount_due != null && Number(r.amount) !== Number(r.visit_amount_due) &&
                    ` · ${t("part of {amount} EGP", { amount: formatMoney(r.visit_amount_due) })}`}
                  {r.patient_mobile ? <> · <Ltr>{r.patient_mobile}</Ltr></> : ""}
                </div>
                {r.reason && <div style={{ fontSize: 12, color: "#8a6d00", marginTop: 2 }}>{r.reason}</div>}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {r.patient_id && (
                  <a href={`/dashboard/patients/${r.patient_id}?visit=${r.visit_id}`} target="_blank" rel="noreferrer"
                    style={{ color: theme.navy, fontSize: 12, fontWeight: 700, padding: "8px 10px", textDecoration: "underline" }}>
                    {t("Open visit")}
                  </a>
                )}
                <button onClick={() => decideCardReview(r.id, "approve")} disabled={busyId === r.id} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#2e7d32", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
                  ✓ {t("Money arrived")}
                </button>
                <button onClick={() => decideCardReview(r.id, "reject")} disabled={busyId === r.id} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: "#ba1a1a", cursor: "pointer", fontSize: 12 }}>
                  {t("Not by card")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isAdmin && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Attendance Corrections")}</h3>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
            {t("Sign-in and sign-out records feed payroll, so they only change when you approve it here.")}
          </p>
          {clockFixes.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>{t("Nothing waiting on you.")}</p>}
          {clockFixes.map((r) => (
            <div key={r.id} style={{ padding: "12px 0", borderBottom: "1px solid #f0f0f0" }}>
              <div style={{ fontSize: 13, color: theme.navy, fontWeight: 700, marginBottom: 4 }}>
                {r.employees?.name} &middot; {isAr ? tCode(r.request_kind) : String(r.request_kind).replace(/_/g, " ")}
              </div>
              {r.timeclock_events && (
                <div style={{ fontSize: 12, color: theme.gray }}>
                  {t("Recorded:")} {r.timeclock_events.event_type === "login" ? t("Sign in") : t("Sign out")}{" "}
                  {new Date(r.timeclock_events.event_time).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  {r.timeclock_events.distance_from_clinic_meters != null && ` · ${t("{m} m from clinic", { m: Math.round(r.timeclock_events.distance_from_clinic_meters) })}`}
                  {r.timeclock_events.face_match_status && ` · ${t("face: {status}", { status: isAr ? tCode(r.timeclock_events.face_match_status) : String(r.timeclock_events.face_match_status).replace(/_/g, " ") })}`}
                </div>
              )}
              {r.proposed_event_time && (
                <div style={{ fontSize: 12, color: "#1e7a3c", fontWeight: 600 }}>
                  {t("Should be:")} {new Date(r.proposed_event_time).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </div>
              )}
              <div style={{ fontSize: 12, color: theme.navy, fontStyle: "italic", margin: "6px 0 8px" }}>&ldquo;{r.reason}&rdquo;</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => decideClockFix(r.id, "approve")} disabled={busyId === r.id}
                  style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: "#1e7a3c", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                  {t("Approve")}
                </button>
                <button onClick={() => decideClockFix(r.id, "reject")} disabled={busyId === r.id}
                  style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                  {t("Reject")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isAdmin && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Shift Swaps Awaiting Approval")}</h3>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
            {t("Both employees have already agreed. The published roster only changes once you approve here.")}
          </p>
          {swaps.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>{t("No swaps waiting on you.")}</p>}
          {swaps.map((r) => (
            <div key={r.id} style={{ padding: "12px 0", borderBottom: "1px solid #f0f0f0" }}>
              <div style={{ fontSize: 13, color: theme.navy, fontWeight: 700, marginBottom: 6 }}>
                {r.requester?.name} &harr; {r.target?.name}
              </div>
              <div style={{ fontSize: 12, color: theme.gray }}>
                {t("{a} gives up {day} → goes to {b}", { a: r.requester?.name, day: fmtSwapDay(r.requester_day), b: r.target?.name })}
              </div>
              <div style={{ fontSize: 12, color: theme.gray, marginBottom: 8 }}>
                {t("{a} gives up {day} → goes to {b}", { a: r.target?.name, day: fmtSwapDay(r.target_day), b: r.requester?.name })}
              </div>
              {r.note && <div style={{ fontSize: 12, color: theme.navy, fontStyle: "italic", marginBottom: 8 }}>&ldquo;{r.note}&rdquo;</div>}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => decideSwap(r.id, "approve")}
                  disabled={busyId === r.id}
                  style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: "#1e7a3c", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                >
                  {t("Approve")}
                </button>
                <button
                  onClick={() => decideSwap(r.id, "reject")}
                  disabled={busyId === r.id}
                  style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                >
                  {t("Reject")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isAdmin && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Pending Visit Edits")}</h3>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
            {t("Any edit an employee makes to a visit lands here first - it doesn't take effect until approved.")}
          </p>
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {["pending", "approved", "rejected"].map((s) => (
              <button
                key={s}
                onClick={() => setVisitEditFilter(s)}
                style={{
                  padding: "6px 16px", borderRadius: 999, border: `1px solid ${visitEditFilter === s ? theme.gold : "#ddd"}`,
                  background: visitEditFilter === s ? theme.goldLight : "#fff", color: theme.navy, fontSize: 12, fontWeight: 600, cursor: "pointer", textTransform: "capitalize",
                }}
              >
                {tCode(s)}
              </button>
            ))}
          </div>
          {!loading && visitEdits.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>{visitEditFilter === "pending" ? t("Nothing pending.") : visitEditFilter === "approved" ? t("Nothing approved.") : t("Nothing rejected.")}</p>}
          <div style={{ display: "grid", gap: 12 }}>
            {visitEdits.map((req) => {
              const changed = diffFields(req.previous_values, req.requested_values);
              return (
                <div key={req.id} style={{ padding: "14px 0", borderBottom: "1px solid #f0f0f0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      {req.visits?.patient_id ? (
                        <a href={`/dashboard/patients/${req.visits.patient_id}`}
                           style={{ fontWeight: 700, color: theme.navy, fontSize: 14, textDecoration: "none", borderBottom: `1px solid ${theme.gold}` }}>
                          {req.visits?.patients?.name || t("Unknown patient")}
                        </a>
                      ) : (
                        <div style={{ fontWeight: 700, color: theme.navy, fontSize: 14 }}>{req.visits?.patients?.name || t("Unknown patient")}</div>
                      )}
                      <div style={{ fontSize: 11, color: theme.gray }}>
                        {t("Requested by {name}", { name: req.requested_by_name || t("unknown") })} · {new Date(req.created_at).toLocaleString()}
                        {req.reviewed_by_name && ` · ${t("reviewed by {name}", { name: req.reviewed_by_name })}`}
                      </div>
                    </div>
                    {req.status === "pending" && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => reviewVisitEdit(req, "approved")} disabled={busyId === req.id} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#2e7d32", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
                          {t("Approve")}
                        </button>
                        <button onClick={() => reviewVisitEdit(req, "rejected")} disabled={busyId === req.id} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, cursor: "pointer", fontSize: 12 }}>
                          {t("Reject")}
                        </button>
                      </div>
                    )}
                  </div>
                  {changed.length === 0 && !(req.pending_payment_amount > 0) ? (
                    <p style={{ fontSize: 12, color: theme.gray, fontStyle: "italic" }}>{t("No fields actually changed.")}</p>
                  ) : (
                    <div style={{ background: "#faf9fb", borderRadius: 8, padding: 10 }}>
                      {changed.map((field) => (
                        <div key={field} style={{ display: "flex", gap: 8, fontSize: 12, padding: "4px 0", flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 700, color: theme.navy, minWidth: 110 }}>{t(FIELD_LABELS[field])}:</span>
                          <span style={{ color: "#ba1a1a", textDecoration: "line-through" }}>{formatFieldValue(field, req.previous_values?.[field])}</span>
                          <span style={{ color: theme.gray }}>{isAr ? "←" : "→"}</span>
                          <span style={{ color: "#2e7d32", fontWeight: 600 }}>{formatFieldValue(field, req.requested_values?.[field])}</span>
                        </div>
                      ))}
                      {req.pending_payment_amount > 0 && (
                        <div style={{ display: "flex", gap: 8, fontSize: 12, padding: "4px 0", flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 700, color: theme.navy, minWidth: 110 }}>{t("New Payment:")}</span>
                          <span style={{ color: "#2e7d32", fontWeight: 700 }}>
                            <Ltr>+{Number(req.pending_payment_amount).toFixed(2)} {t("EGP")}</Ltr> {t("via {method}", { method: isAr ? tCode(req.pending_payment_method || "cash") : (req.pending_payment_method || "Cash") })}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function AssignTaskForm({ staffList, profile, onClose, onAssigned }) {
  const { t } = useT();
  const [assignedTo, setAssignedTo] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!assignedTo || !title.trim()) {
      setError(tx("Pick who this is for, and give it a title."));
      return;
    }
    setSaving(true);
    const staffMember = staffList.find((s) => s.id === assignedTo);
    const { error: err } = await supabase.from("tasks").insert({
      title: title.trim(),
      description: description.trim() || null,
      assigned_to_id: assignedTo,
      assigned_to_name: staffMember?.name || null,
      created_by_id: profile?.id || null,
      created_by_name: profile?.name || null,
    });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    onAssigned();
    onClose();
  }

  return (
    <div style={{ background: "#faf9fb", borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 11, color: "#48464E", fontWeight: 600, marginBottom: 4 }}>{t("Assign To")}</label>
      <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} style={inp}>
        <option value="">{t("Select staff member...")}</option>
        {staffList.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <label style={{ display: "block", fontSize: 11, color: "#48464E", fontWeight: 600, marginTop: 10, marginBottom: 4 }}>{t("Title")}</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} style={inp} placeholder={t("e.g. Follow up with vendor about delivery")} />
      <label style={{ display: "block", fontSize: 11, color: "#48464E", fontWeight: 600, marginTop: 10, marginBottom: 4 }}>{t("Description (optional)")}</label>
      <input value={description} onChange={(e) => setDescription(e.target.value)} style={inp} />
      {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{t(error)}</p>}
      <button onClick={handleSave} disabled={saving} style={{ marginTop: 8, padding: "10px 20px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
        {saving ? t("Assigning...") : t("Assign Task")}
      </button>
    </div>
  );
}

const inp = { width: "100%", padding: "9px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, boxSizing: "border-box" };

function fmtSwapDay(d) {
  if (!d) return "-";
  const dow = new Date(d.work_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" });
  if (d.is_day_off) return `${dow} ${d.work_date} ${tx("(day off)")}`;
  return `${dow} ${d.work_date} ${d.start_time?.slice(0, 5)}-${d.end_time?.slice(0, 5)}`;
}

function alertBox(bg, fg) {
  return {
    background: bg, color: fg, borderRadius: 10, padding: "12px 16px",
    fontSize: 13, fontWeight: 700, textDecoration: "none", minWidth: 210, display: "block",
  };
}
