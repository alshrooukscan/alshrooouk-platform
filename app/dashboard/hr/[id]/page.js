"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";

export default function EmployeeProfilePage() {
  const { id } = useParams();
  const [employee, setEmployee] = useState(null);
  const [payslip, setPayslip] = useState(null);
  const [events, setEvents] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

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
    setEmployee(emp);
    setPayslip(latestPayslip);
    setEvents(tc || []);
    setLeaveRequests(lr || []);
    setLoading(false);
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
            <p style={{ color: theme.gray, margin: 0, fontSize: 13 }}>{employee.phone} {employee.national_id ? `· ID ${employee.national_id}` : ""}</p>
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
              <Row label="Fixed Salary" value={`${Number(payslip.fixed_salary).toFixed(2)} EGP`} />
              <Row label="Variable Salary" value={`${Number(payslip.variable_salary).toFixed(2)} EGP`} />
              {(payslip.deductions || []).map((d, i) => (
                <Row key={i} label={d.name} value={`- ${Number(d.amount).toFixed(2)} EGP`} negative />
              ))}
              <div style={{ borderTop: `2px solid ${theme.navy}`, marginTop: 12, paddingTop: 12, display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700, color: theme.navy }}>Net Pay</span>
                <span style={{ fontWeight: 700, color: theme.navy, fontSize: 20 }}>{Number(payslip.net_total).toFixed(2)} EGP</span>
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
              {e.lat && <div style={{ color: theme.gray, fontSize: 11 }}>{e.lat.toFixed(4)}, {e.lng.toFixed(4)} {e.ip_address && `· IP ${e.ip_address}`}</div>}
            </div>
          ))}
        </div>
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
