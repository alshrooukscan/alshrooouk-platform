"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import { theme } from "../../../lib/theme";
import { usePermissions } from "../../../lib/usePermissions";

export default function HRPage() {
  const { isAdmin } = usePermissions();
  const [employees, setEmployees] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loginAsBusy, setLoginAsBusy] = useState(null);

  useEffect(() => {
    supabase
      .from("employees")
      .select("id, name, hr_id, role, is_active")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setEmployees(data || []);
        setLoading(false);
      });
  }, []);

  const filtered = employees.filter(
    (e) => e.name?.toLowerCase().includes(query.toLowerCase()) || e.hr_id?.toLowerCase().includes(query.toLowerCase())
  );

  async function handleLoginAs(employee) {
    setLoginAsBusy(employee.id);
    const { data: session } = await supabase.auth.getSession();
    const res = await fetch("/api/admin/login-as", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token}` },
      body: JSON.stringify({ type: "employee", id: employee.id }),
    });
    const result = await res.json();
    setLoginAsBusy(null);
    if (result.redirect) window.open(result.redirect, "_blank");
    else alert(result.error || "Could not log in as this employee");
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h1 style={{ color: theme.navy, margin: 0 }}>Human Resources</h1>
          <p style={{ color: theme.gray, margin: "4px 0 0" }}>Manage clinic staff, salaries, and payslips.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a
            href="/dashboard?tab=hr"
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: `1px solid ${theme.navy}`,
              color: theme.navy,
              fontWeight: 700,
              textDecoration: "none",
              fontSize: 14,
              whiteSpace: "nowrap",
            }}
          >
            Attendance Analytics
          </a>
          <Link
            href="/dashboard/hr/new"
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              background: `linear-gradient(135deg, ${theme.gold}, ${theme.goldLight})`,
              color: theme.navy,
              fontWeight: 700,
              textDecoration: "none",
              fontSize: 14,
              whiteSpace: "nowrap",
            }}
          >
            + Add Employee
          </Link>
        </div>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name, ID, or role..."
        style={{ width: "100%", padding: "12px 14px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, marginBottom: 20, boxSizing: "border-box" }}
      />

      <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#faf9fb", textAlign: "left" }}>
              <th style={th}>Employee</th>
              <th style={th}>HR ID</th>
              <th style={th}>Role</th>
              <th style={th}>Status</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id} style={{ borderTop: "1px solid #f0f0f0" }}>
                <td style={td}>
                  <Link href={`/dashboard/hr/${e.id}`} style={{ color: theme.navy, fontWeight: 600, textDecoration: "none" }}>
                    {e.name}
                  </Link>
                </td>
                <td style={td}>{e.hr_id}</td>
                <td style={td}>{e.role || "—"}</td>
                <td style={td}>
                  <span
                    style={{
                      padding: "2px 10px",
                      borderRadius: 999,
                      fontSize: 11,
                      background: e.is_active ? "#e8f5e9" : "#f0f0f0",
                      color: e.is_active ? "#2e7d32" : "#888",
                    }}
                  >
                    {e.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td style={td}>
                  {isAdmin && (
                    <button
                      onClick={() => handleLoginAs(e)}
                      disabled={loginAsBusy === e.id}
                      style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontSize: 12, cursor: "pointer", fontWeight: 600 }}
                    >
                      {loginAsBusy === e.id ? "..." : "Login As"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && filtered.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: theme.gray }}>No employees yet.</div>
        )}
      </div>
    </div>
  );
}

const th = { padding: "12px 16px", fontSize: 11, color: "#48464E", fontWeight: 700, textTransform: "uppercase" };
const td = { padding: "12px 16px" };
