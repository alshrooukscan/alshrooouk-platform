"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import { theme } from "../../../lib/theme";

export default function DoctorsPage() {
  const [doctors, setDoctors] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("doctors")
      .select("id, name, clinic_name, clinic_code, phone")
      .order("created_at", { ascending: false });
    setDoctors(data || []);
    setLoading(false);
  }

  const filtered = doctors.filter(
    (d) =>
      d.name?.toLowerCase().includes(query.toLowerCase()) ||
      d.clinic_code?.toLowerCase().includes(query.toLowerCase()) ||
      d.clinic_name?.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <p style={{ color: theme.gold, fontSize: 12, fontWeight: 700, letterSpacing: 1, margin: 0 }}>NETWORK MANAGEMENT</p>
          <h1 style={{ color: theme.navy, margin: "4px 0" }}>Referring Doctors</h1>
          <p style={{ color: theme.gray, margin: 0 }}>Manage your network of affiliated clinics and referring physicians.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a
            href="/dashboard/doctors/analytics"
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
            Analytics
          </a>
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
            <div style={{ fontWeight: 700, fontSize: 16 }}>{d.name}</div>
            <div style={{ fontSize: 12, color: theme.gold, fontWeight: 600, margin: "4px 0" }}>{d.clinic_code}</div>
            <div style={{ fontSize: 13, color: theme.gray }}>{d.clinic_name}</div>
            <div style={{ fontSize: 13, color: theme.gray }}>{d.phone}</div>
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
