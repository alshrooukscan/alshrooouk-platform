"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import { theme } from "../../../lib/theme";
import { usePermissions } from "../../../lib/usePermissions";
import { exportToCsv } from "../../../lib/exportCsv";
import { formatPhone } from "../../../lib/formatPhone";

export default function DoctorsPage() {
  const { isAdmin } = usePermissions();
  const [doctors, setDoctors] = useState([]);
  const [engagement, setEngagement] = useState({});
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loginAsBusy, setLoginAsBusy] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("doctors")
      .select("id, name, clinic_name, clinic_code, phone, drive_folder_id")
      .order("created_at", { ascending: false });
    setDoctors(data || []);

    // Low engagement = real referral history exists, but fewer than 2 in the last 90 days
    const { data: visits } = await supabase.from("visits").select("doctor_id, exam_date").not("doctor_id", "is", null);
    const cutoff = new Date(Date.now() - 90 * 86400000);
    const recentCount = {};
    const everCount = {};
    for (const v of visits || []) {
      everCount[v.doctor_id] = (everCount[v.doctor_id] || 0) + 1;
      if (v.exam_date && new Date(v.exam_date) >= cutoff) {
        recentCount[v.doctor_id] = (recentCount[v.doctor_id] || 0) + 1;
      }
    }
    const eng = {};
    for (const docId of Object.keys(everCount)) {
      eng[docId] = (recentCount[docId] || 0) < 2;
    }
    setEngagement(eng);
    setLoading(false);
  }

  const filtered = doctors.filter(
    (d) =>
      d.name?.toLowerCase().includes(query.toLowerCase()) ||
      d.clinic_code?.toLowerCase().includes(query.toLowerCase()) ||
      d.clinic_name?.toLowerCase().includes(query.toLowerCase())
  );

  async function handleLoginAs(e, doctor) {
    e.preventDefault();
    e.stopPropagation();
    setLoginAsBusy(doctor.id);
    const { data: session } = await supabase.auth.getSession();
    const res = await fetch("/api/admin/login-as", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token}` },
      body: JSON.stringify({ type: "doctor", id: doctor.id }),
    });
    const result = await res.json();
    setLoginAsBusy(null);
    if (result.redirect) window.open(result.redirect, "_blank");
    else alert(result.error || "Could not log in as this doctor");
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <p style={{ color: theme.gold, fontSize: 12, fontWeight: 700, letterSpacing: 1, margin: 0 }}>NETWORK MANAGEMENT</p>
          <h1 style={{ color: theme.navy, margin: "4px 0" }}>Referring Doctors</h1>
          <p style={{ color: theme.gray, margin: 0 }}>Manage your network of affiliated clinics and referring physicians.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => exportToCsv("doctors.csv", filtered.map((d) => ({ Name: d.name, "Clinic Code": d.clinic_code, "Clinic Name": d.clinic_name || "", Phone: d.phone || "", "Has Drive Folder": d.drive_folder_id ? "Yes" : "No" })))}
            style={{ padding: "10px 20px", borderRadius: 8, border: `1px solid ${theme.navy}`, background: "#fff", color: theme.navy, fontWeight: 700, cursor: "pointer", fontSize: 14 }}
          >
            Export CSV
          </button>
          <Link
            href="/dashboard/doctors/new"
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
            + New Doctor
          </Link>
        </div>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or clinic code..."
        style={{ width: "100%", padding: "12px 14px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, marginBottom: 20, boxSizing: "border-box" }}
      />

      {loading && <p style={{ color: theme.gray }}>Loading...</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
        {filtered.map((d) => (
          <Link
            key={d.id}
            href={`/dashboard/doctors/${d.id}`}
            style={{
              display: "block",
              background: "#fff",
              borderRadius: 16,
              padding: 20,
              textDecoration: "none",
              color: theme.navy,
              boxShadow: "0 4px 20px rgba(39,33,77,0.06)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{d.name}</div>
              {engagement[d.id] && (
                <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 999, background: "#fdecea", color: "#ba1a1a", fontWeight: 700, whiteSpace: "nowrap" }}>
                  Low Engagement
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: theme.gold, fontWeight: 600, margin: "4px 0" }}>{d.clinic_code}</div>
            <div style={{ fontSize: 13, color: theme.gray }}>{d.clinic_name}</div>
            <div style={{ fontSize: 13, color: theme.gray }}>{formatPhone(d.phone)}</div>
            {isAdmin && (
              <button
                onClick={(e) => handleLoginAs(e, d)}
                disabled={loginAsBusy === d.id}
                style={{ marginTop: 10, padding: "6px 14px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontSize: 12, cursor: "pointer", fontWeight: 600 }}
              >
                {loginAsBusy === d.id ? "..." : "Login As"}
              </button>
            )}
          </Link>
        ))}
      </div>

      {!loading && filtered.length === 0 && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, color: theme.gray, textAlign: "center" }}>
          No doctors yet. Register the first one above.
        </div>
      )}
    </div>
  );
}
