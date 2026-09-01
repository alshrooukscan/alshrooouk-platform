"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import { usePermissions } from "../../../../lib/usePermissions";

export default function LoginAsPage() {
  const { isAdmin, loading: permsLoading } = usePermissions();
  const [tab, setTab] = useState("patient");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (query.length >= 2) search();
    else setResults([]);
  }, [tab, query]);

  async function search() {
    setLoading(true);
    let data = [];
    if (tab === "patient") {
      const r = await supabase.from("patients").select("id, name, mobile").ilike("name", `%${query}%`).limit(15);
      data = r.data || [];
    } else if (tab === "doctor") {
      const r = await supabase.from("doctors").select("id, name, clinic_code").ilike("name", `%${query}%`).limit(15);
      data = r.data || [];
    } else if (tab === "employee") {
      const r = await supabase.from("employees").select("id, name, hr_id, permissions").ilike("name", `%${query}%`).limit(15);
      data = r.data || [];
    } else if (tab === "client") {
      const r = await supabase.from("clients").select("id, name, username, contact_phone").ilike("name", `%${query}%`).limit(15);
      data = r.data || [];
    } else if (tab === "staff") {
      const r = await supabase.from("staff_profiles").select("id, name, email, role").ilike("name", `%${query}%`).limit(15);
      data = r.data || [];
    }
    setResults(data);
    setLoading(false);
  }

  async function handleLoginAs(record) {
    setError("");
    const { data: session } = await supabase.auth.getSession();
    const res = await fetch("/api/admin/login-as", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token}` },
      body: JSON.stringify({ type: tab, id: record.id }),
    });
    const result = await res.json();
    if (!res.ok) {
      setError(result.error || "Could not log in as this user");
      return;
    }
    if (result.link) {
      window.open(result.link, "_blank");
    } else {
      window.open(result.redirect, "_blank");
    }
    setConfirming(null);
  }

  if (!permsLoading && !isAdmin) {
    return <p style={{ color: theme.gray }}>Admin access required.</p>;
  }

  return (
    <div>
      <h1 style={{ color: theme.navy, marginBottom: 4 }}>Login As</h1>
      <p style={{ color: theme.gray, marginBottom: 20 }}>
        See exactly what a specific patient, doctor, employee, client, or staff member sees - no password needed, it opens their real portal straight away in a new tab. Your own session isn't affected.
      </p>

      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {["patient", "doctor", "employee", "client", "staff"].map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setResults([]);
              setQuery("");
            }}
            style={{
              padding: "8px 18px",
              borderRadius: 8,
              border: `1px solid ${tab === t ? theme.gold : "#ddd"}`,
              background: tab === t ? theme.goldLight : "#fff",
              color: theme.navy,
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${tab}s by name...`}
        style={{ width: "100%", padding: "12px 14px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, marginBottom: 16, boxSizing: "border-box" }}
      />

      {error && <p style={{ color: "#ba1a1a", fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {loading && <p style={{ color: theme.gray, fontSize: 13 }}>Searching...</p>}
      {!loading && query.length >= 2 && results.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>No matches.</p>}

      <div style={{ display: "grid", gap: 8 }}>
        {results.map((r) => (
          <div
            key={r.id}
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 14,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              boxShadow: "0 2px 10px rgba(39,33,77,0.05)",
            }}
          >
            <div>
              <div style={{ fontWeight: 700, color: theme.navy }}>{r.name}</div>
              <div style={{ fontSize: 12, color: theme.gray }}>
                {tab === "patient" && r.mobile}
                {tab === "doctor" && r.clinic_code}
                {tab === "employee" && `${r.hr_id}${Object.values(r.permissions || {}).some(Boolean) ? " · has dashboard access" : ""}`}
                {tab === "client" && `${r.username || ""}${r.contact_phone ? " · " + r.contact_phone : ""}`}
                {tab === "staff" && `${r.email} · ${r.role}`}
              </div>
            </div>
            {/* Single click straight into the portal - the old two-step confirm
                was friction with no safety value, since the action is read-only
                inspection, opens in its own tab, and is written to activity_log. */}
            <button
              onClick={() => handleLoginAs(r)}
              style={{ padding: "6px 16px", borderRadius: 6, border: "none", background: theme.navy, color: "#fff", fontSize: 12, cursor: "pointer", fontWeight: 700 }}
            >
              Login As
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
