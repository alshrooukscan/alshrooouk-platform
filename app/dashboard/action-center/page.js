"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { theme } from "../../../lib/theme";
import { usePermissions } from "../../../lib/usePermissions";
import { formatMoney } from "../../../lib/format";
import { logActivity } from "../../../lib/activityLog";
import { syncPatientLastVisitDate } from "../../../lib/syncPatientLastVisitDate";

const BRAND_LABEL = { scan: "Scan", dental_stock: "Dental Stock", el3awama_stock: "El3awama Stock" };
const TYPE_LABEL = {
  cash_out: "Cash Out",
  cash_transfer: "Cash Transfer",
  cash_collection: "Cash Collection",
  brand_transfer: "Brand Transfer",
  stock_sale: "Stock Sale",
  visit_collection: "Visit Collection",
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
  const { isAdmin, loading: permsLoading, profile } = usePermissions();
  const [myTasks, setMyTasks] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [approvalFilter, setApprovalFilter] = useState("pending");
  const [visitEdits, setVisitEdits] = useState([]);
  const [visitEditFilter, setVisitEditFilter] = useState("pending");
  const [staffList, setStaffList] = useState([]);
  const [branchMap, setBranchMap] = useState({});
  const [doctorMap, setDoctorMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [swaps, setSwaps] = useState([]);
  const [clockFixes, setClockFixes] = useState([]);
  const [alerts, setAlerts] = useState({ stockZero: 0, stockLow: 0, overdueReports: 0 });

  useEffect(() => {
    if (!permsLoading && profile) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permsLoading, profile, approvalFilter, visitEditFilter]);

  async function decideSwap(requestId, action) {
    setBusyId(requestId);
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch("/api/admin/shift-swaps", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token}` },
      body: JSON.stringify({ requestId, action }),
    });
    const result = await res.json();
    if (!res.ok) alert(result.error || "Could not update that swap.");
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
    if (!res.ok) alert(r.error || "Could not update that request.");
    setBusyId(null);
    load();
  }

  async function load() {
    setLoading(true);
    const promises = [
      supabase.from("tasks").select("*").eq("assigned_to_id", profile.id).order("created_at", { ascending: false }),
    ];
    if (isAdmin) {
      promises.push(
        supabase
          .from("expense_transactions")
          .select("*, from_employee:from_employee_id(name), to_employee:to_employee_id(name)")
          .eq("status", approvalFilter)
          .order("created_at", { ascending: false })
      );
      promises.push(supabase.from("staff_profiles").select("id, name").order("name"));
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
      const { data: sess } = await supabase.auth.getSession();
      const swapRes = await fetch("/api/admin/shift-swaps", {
        headers: { Authorization: `Bearer ${sess.session?.access_token}` },
      });
      if (swapRes.ok) setSwaps((await swapRes.json()).requests || []);
      // Things nobody is told about unless they go looking for them.
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
      const fixRes = await fetch("/api/admin/timeclock-corrections", {
        headers: { Authorization: `Bearer ${sess.session?.access_token}` },
      });
      if (fixRes.ok) setClockFixes((await fixRes.json()).requests || []);
    }
    if (isAdmin) {
      setApprovals(results[1].data || []);
      setStaffList(results[2].data || []);
      setVisitEdits(results[3].data || []);
      setBranchMap(Object.fromEntries((results[4].data || []).map((b) => [b.id, b.name])));
      setDoctorMap(Object.fromEntries((results[5].data || []).map((d) => [d.id, `${d.name} - ${d.clinic_name}`])));
    }
    setLoading(false);
  }

  async function markTaskDone(task) {
    setBusyId(task.id);
    await supabase.from("tasks").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", task.id);
    setBusyId(null);
    load();
  }

  async function reviewApproval(item, newStatus) {
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

  async function reviewVisitEdit(item, newStatus) {
    setBusyId(item.id);
    if (newStatus === "approved") {
      const { error: vErr } = await supabase.from("visits").update(item.requested_values).eq("id", item.visit_id);
      if (vErr) {
        setBusyId(null);
        alert(`Could not apply this edit: ${vErr.message}`);
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
          alert(`Visit changes were applied, but the payment could not be logged: ${payErr.message}`);
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
    if (field === "doctor_id") return doctorMap[value] || "Walk-in";
    if (field === "branch_id") return branchMap[value] || value;
    if (field === "scan_types") return Array.isArray(value) ? value.join(", ") : value;
    if (field === "amount_due") return `${Number(value).toFixed(2)} EGP`;
    if (field === "discount_pct") return `${value}%`;
    return String(value);
  }

  function diffFields(prev, next) {
    const fields = Object.keys(FIELD_LABELS);
    return fields.filter((f) => JSON.stringify(prev?.[f] ?? null) !== JSON.stringify(next?.[f] ?? null));
  }

  if (permsLoading || !profile) return <p style={{ color: theme.gray }}>Loading...</p>;

  const pendingTasks = myTasks.filter((t) => t.status === "pending");
  const doneTasks = myTasks.filter((t) => t.status === "done");

  return (
    <div>
      <h1 style={{ color: theme.navy, margin: "0 0 4px" }}>Action Center</h1>
      <p style={{ color: theme.gray, margin: "0 0 20px" }}>Your assigned tasks{isAdmin ? ", and every pending approval platform-wide" : ""}.</p>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginBottom: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ color: theme.navy, margin: 0 }}>My Tasks</h3>
          {isAdmin && (
            <button onClick={() => setShowAssignForm((v) => !v)} style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${theme.navy}`, background: "#fff", color: theme.navy, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
              {showAssignForm ? "Cancel" : "+ Assign Task"}
            </button>
          )}
        </div>

        {showAssignForm && <AssignTaskForm staffList={staffList} profile={profile} onClose={() => setShowAssignForm(false)} onAssigned={load} />}

        {!loading && pendingTasks.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>Nothing pending.</p>}
        <div style={{ display: "grid", gap: 8 }}>
          {pendingTasks.map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid #f0f0f0" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: theme.navy, fontSize: 14 }}>{t.title}</div>
                {t.description && <div style={{ fontSize: 13, color: theme.gray, marginTop: 2 }}>{t.description}</div>}
                <div style={{ fontSize: 11, color: theme.gray, marginTop: 4 }}>
                  Assigned by {t.created_by_name || "admin"}{" \u00b7 "}{new Date(t.created_at).toLocaleDateString()}
                </div>
              </div>
              <button onClick={() => markTaskDone(t)} disabled={busyId === t.id} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#2e7d32", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}>
                {busyId === t.id ? "..." : "Mark Done"}
              </button>
            </div>
          ))}
        </div>
        {doneTasks.length > 0 && (
          <details style={{ marginTop: 12 }}>
            <summary style={{ fontSize: 12, color: theme.gray, cursor: "pointer" }}>{doneTasks.length} completed task{doneTasks.length === 1 ? "" : "s"}</summary>
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              {doneTasks.map((t) => (
                <div key={t.id} style={{ fontSize: 12, color: theme.gray, padding: "6px 0", borderBottom: "1px solid #f5f5f5" }}>
                  <span style={{ textDecoration: "line-through" }}>{t.title}</span>{" \u00b7 "}done {new Date(t.completed_at).toLocaleDateString()}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {isAdmin && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Pending Approvals</h3>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
            Every Cash Collection, every non-cash Cash Out, and every Brand Transfer that needs your confirmation.
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
                {s}
              </button>
            ))}
          </div>
          {!loading && approvals.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>Nothing {approvalFilter}.</p>}
          <div style={{ display: "grid", gap: 8 }}>
            {approvals.map((tx) => (
              <div key={tx.id} style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 0", borderBottom: "1px solid #f0f0f0" }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: "#eef2ff", color: "#3949ab", minWidth: 100, textAlign: "center" }}>
                  {TYPE_LABEL[tx.type] || tx.type}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, color: theme.navy, fontSize: 14 }}>
                    {formatMoney(tx.amount)} EGP <span style={{ fontWeight: 500, color: theme.gray }}>via {PAYMENT_LABEL[tx.payment_method]}</span>
                  </div>
                  <div style={{ fontSize: 12, color: theme.gray }}>
                    {BRAND_LABEL[tx.brand]}
                    {tx.to_brand && ` \u2192 ${BRAND_LABEL[tx.to_brand]}`}
                    {tx.from_employee?.name && ` \u00b7 From ${tx.from_employee.name}`}
                    {tx.to_employee?.name && ` \u00b7 To ${tx.to_employee.name}`}
                    {tx.category && ` \u00b7 ${tx.category}`}
                  </div>
                  {tx.note && <div style={{ fontSize: 12, color: theme.gray, fontStyle: "italic" }}>{tx.note}</div>}
                  <div style={{ fontSize: 11, color: theme.gray }}>
                    {tx.entry_date}{" \u00b7 "}logged by {tx.created_by_name || "unknown"}
                    {tx.confirmed_by_name && ` \u00b7 reviewed by ${tx.confirmed_by_name}`}
                  </div>
                </div>
                {tx.status === "pending" && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => reviewApproval(tx, "confirmed")} disabled={busyId === tx.id} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#2e7d32", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
                      Confirm
                    </button>
                    <button onClick={() => reviewApproval(tx, "rejected")} disabled={busyId === tx.id} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, cursor: "pointer", fontSize: 12 }}>
                      Reject
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
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Needs Attention</h3>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
            {alerts.stockZero > 0 && (
              <a href="/dashboard?tab=stockalerts" style={alertBox("#fdecea", "#ba1a1a")}>
                <strong>{alerts.stockZero}</strong> item{alerts.stockZero === 1 ? "" : "s"} out of stock
                <span style={{ display: "block", fontSize: 11, fontWeight: 400 }}>Doctors can still order these — checkout will fail</span>
              </a>
            )}
            {alerts.stockLow > 0 && (
              <a href="/dashboard?tab=stockalerts" style={alertBox("#fff8e1", "#a97c00")}>
                <strong>{alerts.stockLow}</strong> item{alerts.stockLow === 1 ? "" : "s"} running low
                <span style={{ display: "block", fontSize: 11, fontWeight: 400 }}>At or below their restock level</span>
              </a>
            )}
            {alerts.overdueReports > 0 && (
              <a href="/dashboard?tab=requests" style={alertBox("#fdecea", "#ba1a1a")}>
                <strong>{alerts.overdueReports}</strong> report{alerts.overdueReports === 1 ? "" : "s"} overdue
                <span style={{ display: "block", fontSize: 11, fontWeight: 400 }}>Past the date the requester was promised</span>
              </a>
            )}
          </div>
        </div>
      )}

      {isAdmin && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Attendance Corrections</h3>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
            Sign-in and sign-out records feed payroll, so they only change when you approve it here.
          </p>
          {clockFixes.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>Nothing waiting on you.</p>}
          {clockFixes.map((r) => (
            <div key={r.id} style={{ padding: "12px 0", borderBottom: "1px solid #f0f0f0" }}>
              <div style={{ fontSize: 13, color: theme.navy, fontWeight: 700, marginBottom: 4 }}>
                {r.employees?.name} &middot; {String(r.request_kind).replace(/_/g, " ")}
              </div>
              {r.timeclock_events && (
                <div style={{ fontSize: 12, color: theme.gray }}>
                  Recorded: {r.timeclock_events.event_type === "login" ? "Sign in" : "Sign out"}{" "}
                  {new Date(r.timeclock_events.event_time).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  {r.timeclock_events.distance_from_clinic_meters != null && ` · ${Math.round(r.timeclock_events.distance_from_clinic_meters)} m from clinic`}
                  {r.timeclock_events.face_match_status && ` · face: ${String(r.timeclock_events.face_match_status).replace(/_/g, " ")}`}
                </div>
              )}
              {r.proposed_event_time && (
                <div style={{ fontSize: 12, color: "#1e7a3c", fontWeight: 600 }}>
                  Should be: {new Date(r.proposed_event_time).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </div>
              )}
              <div style={{ fontSize: 12, color: theme.navy, fontStyle: "italic", margin: "6px 0 8px" }}>&ldquo;{r.reason}&rdquo;</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => decideClockFix(r.id, "approve")} disabled={busyId === r.id}
                  style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: "#1e7a3c", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                  Approve
                </button>
                <button onClick={() => decideClockFix(r.id, "reject")} disabled={busyId === r.id}
                  style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isAdmin && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Shift Swaps Awaiting Approval</h3>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
            Both employees have already agreed. The published roster only changes once you approve here.
          </p>
          {swaps.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>No swaps waiting on you.</p>}
          {swaps.map((r) => (
            <div key={r.id} style={{ padding: "12px 0", borderBottom: "1px solid #f0f0f0" }}>
              <div style={{ fontSize: 13, color: theme.navy, fontWeight: 700, marginBottom: 6 }}>
                {r.requester?.name} &harr; {r.target?.name}
              </div>
              <div style={{ fontSize: 12, color: theme.gray }}>
                {r.requester?.name} gives up {fmtSwapDay(r.requester_day)} &rarr; goes to {r.target?.name}
              </div>
              <div style={{ fontSize: 12, color: theme.gray, marginBottom: 8 }}>
                {r.target?.name} gives up {fmtSwapDay(r.target_day)} &rarr; goes to {r.requester?.name}
              </div>
              {r.note && <div style={{ fontSize: 12, color: theme.navy, fontStyle: "italic", marginBottom: 8 }}>&ldquo;{r.note}&rdquo;</div>}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => decideSwap(r.id, "approve")}
                  disabled={busyId === r.id}
                  style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: "#1e7a3c", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                >
                  Approve
                </button>
                <button
                  onClick={() => decideSwap(r.id, "reject")}
                  disabled={busyId === r.id}
                  style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isAdmin && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Pending Visit Edits</h3>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
            Any edit an employee makes to a visit lands here first - it doesn't take effect until approved.
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
                {s}
              </button>
            ))}
          </div>
          {!loading && visitEdits.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>Nothing {visitEditFilter}.</p>}
          <div style={{ display: "grid", gap: 12 }}>
            {visitEdits.map((req) => {
              const changed = diffFields(req.previous_values, req.requested_values);
              return (
                <div key={req.id} style={{ padding: "14px 0", borderBottom: "1px solid #f0f0f0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, color: theme.navy, fontSize: 14 }}>{req.visits?.patients?.name || "Unknown patient"}</div>
                      <div style={{ fontSize: 11, color: theme.gray }}>
                        Requested by {req.requested_by_name || "unknown"} · {new Date(req.created_at).toLocaleString()}
                        {req.reviewed_by_name && ` · reviewed by ${req.reviewed_by_name}`}
                      </div>
                    </div>
                    {req.status === "pending" && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => reviewVisitEdit(req, "approved")} disabled={busyId === req.id} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#2e7d32", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
                          Approve
                        </button>
                        <button onClick={() => reviewVisitEdit(req, "rejected")} disabled={busyId === req.id} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, cursor: "pointer", fontSize: 12 }}>
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                  {changed.length === 0 && !(req.pending_payment_amount > 0) ? (
                    <p style={{ fontSize: 12, color: theme.gray, fontStyle: "italic" }}>No fields actually changed.</p>
                  ) : (
                    <div style={{ background: "#faf9fb", borderRadius: 8, padding: 10 }}>
                      {changed.map((field) => (
                        <div key={field} style={{ display: "flex", gap: 8, fontSize: 12, padding: "4px 0", flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 700, color: theme.navy, minWidth: 110 }}>{FIELD_LABELS[field]}:</span>
                          <span style={{ color: "#ba1a1a", textDecoration: "line-through" }}>{formatFieldValue(field, req.previous_values?.[field])}</span>
                          <span style={{ color: theme.gray }}>→</span>
                          <span style={{ color: "#2e7d32", fontWeight: 600 }}>{formatFieldValue(field, req.requested_values?.[field])}</span>
                        </div>
                      ))}
                      {req.pending_payment_amount > 0 && (
                        <div style={{ display: "flex", gap: 8, fontSize: 12, padding: "4px 0", flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 700, color: theme.navy, minWidth: 110 }}>New Payment:</span>
                          <span style={{ color: "#2e7d32", fontWeight: 700 }}>
                            +{Number(req.pending_payment_amount).toFixed(2)} EGP via {req.pending_payment_method || "Cash"}
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
  const [assignedTo, setAssignedTo] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!assignedTo || !title.trim()) {
      setError("Pick who this is for, and give it a title.");
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
      <label style={{ display: "block", fontSize: 11, color: "#48464E", fontWeight: 600, marginBottom: 4 }}>Assign To</label>
      <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} style={inp}>
        <option value="">Select staff member...</option>
        {staffList.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <label style={{ display: "block", fontSize: 11, color: "#48464E", fontWeight: 600, marginTop: 10, marginBottom: 4 }}>Title</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} style={inp} placeholder="e.g. Follow up with vendor about delivery" />
      <label style={{ display: "block", fontSize: 11, color: "#48464E", fontWeight: 600, marginTop: 10, marginBottom: 4 }}>Description (optional)</label>
      <input value={description} onChange={(e) => setDescription(e.target.value)} style={inp} />
      {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}
      <button onClick={handleSave} disabled={saving} style={{ marginTop: 8, padding: "10px 20px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
        {saving ? "Assigning..." : "Assign Task"}
      </button>
    </div>
  );
}

const inp = { width: "100%", padding: "9px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, boxSizing: "border-box" };

function fmtSwapDay(d) {
  if (!d) return "-";
  const dow = new Date(d.work_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" });
  if (d.is_day_off) return `${dow} ${d.work_date} (day off)`;
  return `${dow} ${d.work_date} ${d.start_time?.slice(0, 5)}-${d.end_time?.slice(0, 5)}`;
}

function alertBox(bg, fg) {
  return {
    background: bg, color: fg, borderRadius: 10, padding: "12px 16px",
    fontSize: 13, fontWeight: 700, textDecoration: "none", minWidth: 210, display: "block",
  };
}
