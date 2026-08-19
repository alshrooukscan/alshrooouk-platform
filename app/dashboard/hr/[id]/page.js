"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import MonthlySchedule from "../../../../components/MonthlySchedule";
import { formatMoney } from "../../../../lib/format";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MODULES = [
  { key: "dashboard", label: "Dashboard / P&L" },
  { key: "patients", label: "Patients" },
  { key: "doctors", label: "Doctors" },
  { key: "stock", label: "Stock" },
  { key: "hr", label: "HR & Payroll" },
  { key: "settings", label: "Settings" },
];

export default function EmployeeProfilePage() {
  const { id } = useParams();
  const [employee, setEmployee] = useState(null);
  const [payslip, setPayslip] = useState(null);
  const [events, setEvents] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [permissions, setPermissions] = useState({});
  const [savingElevation, setSavingElevation] = useState(false);
  const [elevationResult, setElevationResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [savingShifts, setSavingShifts] = useState(false);

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    setLoading(true);
    const { data: emp } = await supabase.from("employees").select("*").eq("id", id).single();
    const { data: latestPayslip } = await supabase
      .from("payroll_runs")
      .select("*")
      .eq("employee_id", id)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: tc } = await supabase
      .from("timeclock_events")
      .select("*")
      .eq("employee_id", id)
      .order("event_time", { ascending: false })
      .limit(10);
    const { data: lr } = await supabase
      .from("leave_requests")
      .select("*")
      .eq("employee_id", id)
      .order("created_at", { ascending: false });
    const { data: sh } = await supabase.from("employee_shifts").select("*").eq("employee_id", id);

    const shiftMap = DAYS.map((_, dayIdx) => {
      const existing = (sh || []).find((s) => s.day_of_week === dayIdx);
      return existing || { day_of_week: dayIdx, start_time: "09:00", end_time: "17:00", is_day_off: dayIdx === 5 || dayIdx === 6 };
    });

    setEmployee(emp);
    setPermissions(emp?.permissions || {});
    setPayslip(latestPayslip);
    setEvents(tc || []);
    setLeaveRequests(lr || []);
    setShifts(shiftMap);
    setLoading(false);
  }

  function togglePermission(key) {
    setPermissions((p) => ({ ...p, [key]: !p[key] }));
    setElevationResult(null);
  }

  async function handleSaveElevation() {
    setSavingElevation(true);
    const { data: session } = await supabase.auth.getSession();
    const res = await fetch("/api/admin/elevate-employee", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token}` },
      body: JSON.stringify({ employeeId: id, permissions }),
    });
    const data = await res.json();
    setSavingElevation(false);
    if (!res.ok) {
      alert(data.error || "Could not save access");
      return;
    }
    setElevationResult(data);
    load();
  }

  async function handleSaveShifts() {
    setSavingShifts(true);
    for (const s of shifts) {
      await supabase.from("employee_shifts").upsert(
        {
          employee_id: id,
          day_of_week: s.day_of_week,
          start_time: s.is_day_off ? null : s.start_time,
          end_time: s.is_day_off ? null : s.end_time,
          is_day_off: s.is_day_off,
        },
        { onConflict: "employee_id,day_of_week" }
      );
    }
    setSavingShifts(false);
    alert("Shift schedule saved.");
  }

  function updateShift(dayIdx, field, value) {
    setShifts((prev) => prev.map((s) => (s.day_of_week === dayIdx ? { ...s, [field]: value } : s)));
  }

  async function handleReviewLeave(requestId, status) {
    await supabase.from("leave_requests").update({ status }).eq("id", requestId);
    load();
  }

  async function handleGeneratePayslip() {
    setGenerating(true);
    const period = new Date().toLocaleString("en-US", { month: "long", year: "numeric" });
    const { data, error } = await supabase.rpc("generate_payslip", { p_employee_id: id, p_period: period });
    setGenerating(false);
    if (error) {
      alert(error.message);
      return;
    }
    setPayslip(data);
  }

  if (loading) return <p style={{ color: theme.gray }}>Loading...</p>;
  if (!employee) return <p style={{ color: theme.gray }}>Employee not found.</p>;

  return (
    <div>
      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginBottom: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ color: theme.navy, margin: 0 }}>{employee.name}</h1>
            <p style={{ color: theme.gray, margin: "4px 0" }}>{employee.role} &middot; {employee.hr_id}</p>
            <p style={{ color: theme.gray, margin: 0, fontSize: 13 }}>
              {employee.phone} {employee.national_id ? `· ID ${employee.national_id}` : ""}
              {employee.hourly_rate ? ` · ${formatMoney(employee.hourly_rate, { decimals: 2 })} EGP/hr` : ""}
            </p>
          </div>
          <button onClick={handleGeneratePayslip} disabled={generating} style={primaryBtn}>
            {generating ? "Generating..." : "Generate Payslip"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20 }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Current Payslip</h3>
          {!payslip && <p style={{ color: theme.gray, fontSize: 14 }}>No payslip generated yet.</p>}
          {payslip && (
            <div>
              <p style={{ fontSize: 12, color: theme.gray }}>Period: {payslip.period}</p>
              <Row label="Fixed Salary" value={`${formatMoney(payslip.fixed_salary, { decimals: 2 })} EGP`} />
              <Row label="Variable Salary" value={`${formatMoney(payslip.variable_salary, { decimals: 2 })} EGP`} />
              {(payslip.deductions || []).map((d, i) => (
                <Row key={i} label={d.name} value={`- ${formatMoney(d.amount, { decimals: 2 })} EGP`} negative />
              ))}
              <div style={{ borderTop: `2px solid ${theme.navy}`, marginTop: 12, paddingTop: 12, display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700, color: theme.navy }}>Net Pay</span>
                <span style={{ fontWeight: 700, color: theme.navy, fontSize: 20 }}>{formatMoney(payslip.net_total, { decimals: 2 })} EGP</span>
              </div>
            </div>
          )}
        </div>

        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Recent Activity</h3>
          {events.length === 0 && <p style={{ color: theme.gray, fontSize: 14 }}>No login/logout events yet.</p>}
          {events.map((e) => (
            <div key={e.id} style={{ borderBottom: "1px solid #f0f0f0", padding: "8px 0", fontSize: 13 }}>
              <div style={{ fontWeight: 600, color: theme.navy, textTransform: "capitalize" }}>{e.event_type}</div>
              <div style={{ color: theme.gray, fontSize: 12 }}>{new Date(e.event_time).toLocaleString()}</div>
              {e.lat && (
                <div style={{ color: theme.gray, fontSize: 11 }}>
                  {e.address ? e.address : `${e.lat.toFixed(4)}, ${e.lng.toFixed(4)}`}
                  {" "}
                  <a href={`https://maps.google.com/?q=${e.lat},${e.lng}`} target="_blank" rel="noreferrer" style={{ color: theme.gold }}>View on map</a>
                  {e.ip_address && ` · IP ${e.ip_address}`}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Weekly Shift Schedule</h3>
        <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
          Defines this employee's expected start/end time per day. Attendance flags (late, absent) are measured against this.
        </p>
        {shifts.map((s) => (
          <div key={s.day_of_week} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid #f5f5f5" }}>
            <div style={{ width: 90, fontSize: 13, fontWeight: 600, color: theme.navy }}>{DAYS[s.day_of_week]}</div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: theme.gray, width: 90 }}>
              <input type="checkbox" checked={s.is_day_off} onChange={(e) => updateShift(s.day_of_week, "is_day_off", e.target.checked)} />
              Day off
            </label>
            {!s.is_day_off && (
              <>
                <input
                  type="time"
                  value={s.start_time || "09:00"}
                  onChange={(e) => updateShift(s.day_of_week, "start_time", e.target.value)}
                  style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }}
                />
                <span style={{ color: theme.gray, fontSize: 12 }}>to</span>
                <input
                  type="time"
                  value={s.end_time || "17:00"}
                  onChange={(e) => updateShift(s.day_of_week, "end_time", e.target.value)}
                  style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }}
                />
              </>
            )}
          </div>
        ))}
        <button
          onClick={handleSaveShifts}
          disabled={savingShifts}
          style={{ marginTop: 16, padding: "10px 24px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 }}
        >
          {savingShifts ? "Saving..." : "Save Shift Schedule"}
        </button>
      </div>

      <MonthlySchedule employeeId={id} />

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Staff Dashboard Access</h3>
        <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
          Grant this employee access to the same staff dashboard modules your team uses. They'll reach these from within their own portal login, no separate account to remember.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
          {MODULES.map((m) => (
            <button
              key={m.key}
              onClick={() => togglePermission(m.key)}
              style={{
                padding: "6px 14px",
                borderRadius: 999,
                fontSize: 12,
                border: `1px solid ${permissions[m.key] ? theme.gold : "#ddd"}`,
                background: permissions[m.key] ? theme.goldLight : "#fff",
                color: theme.navy,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button onClick={handleSaveElevation} disabled={savingElevation} style={{ ...primaryBtn, fontSize: 13, padding: "10px 20px" }}>
          {savingElevation ? "Saving..." : "Save Access"}
        </button>
        {elevationResult && (
          <div style={{ marginTop: 16, background: "#faf9fb", borderRadius: 8, padding: 14, fontSize: 13 }}>
            <p style={{ margin: 0, color: theme.navy }}>
              {elevationResult.alreadyExisted ? "Access updated." : "Dashboard access created."} They'll see an "Open Staff Dashboard" button in their own portal after logging in, no second password to remember.
            </p>
          </div>
        )}
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Vacation Requests</h3>
        {leaveRequests.length === 0 && <p style={{ color: theme.gray, fontSize: 14 }}>No vacation requests yet.</p>}
        {leaveRequests.map((r) => (
          <div key={r.id} style={{ borderBottom: "1px solid #f0f0f0", padding: "10px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 600, color: theme.navy, fontSize: 13 }}>{r.start_date} &rarr; {r.end_date}</div>
              {r.reason && <div style={{ fontSize: 12, color: theme.gray }}>{r.reason}</div>}
            </div>
            {r.status === "pending" ? (
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => handleReviewLeave(r.id, "approved")} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#2e7d32", color: "#fff", fontSize: 12, cursor: "pointer" }}>Approve</button>
                <button onClick={() => handleReviewLeave(r.id, "rejected")} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#ba1a1a", color: "#fff", fontSize: 12, cursor: "pointer" }}>Reject</button>
              </div>
            ) : (
              <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 999, background: r.status === "approved" ? "#e8f5e9" : "#fdecea", color: r.status === "approved" ? "#2e7d32" : "#ba1a1a", fontWeight: 700, textTransform: "capitalize" }}>
                {r.status}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value, negative }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 14 }}>
      <span style={{ color: theme.gray }}>{label}</span>
      <span style={{ color: negative ? "#ba1a1a" : theme.navy, fontWeight: 600 }}>{value}</span>
    </div>
  );
}
const primaryBtn = { padding: "12px 24px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer" };
