"use client";
import { useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import { theme } from "../../../lib/theme";

export default function PatientsPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSearch(e) {
    e.preventDefault();
    setLoading(true);
    const { data } = await supabase
      .from("patients")
      .select("id, name, mobile, dob, created_at")
      .ilike("mobile", `%${query}%`)
      .order("created_at", { ascending: false })
      .limit(20);
    setResults(data || []);
    setLoading(false);
  }

  return (
    <div>
      <h1 style={{ color: theme.navy, marginBottom: 4 }}>Patient Directory</h1>
      <p style={{ color: theme.gray, marginBottom: 24 }}>
        Search for existing patient records or register a new patient. Enter a mobile number to begin.
      </p>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)", marginBottom: 24 }}>
        <form onSubmit={handleSearch} style={{ display: "flex", gap: 12 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by mobile number (e.g. +2010...)"
            style={{ flex: 1, padding: "12px 14px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14 }}
          />
          <button
            type="submit"
            style={{ padding: "0 24px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 600, cursor: "pointer" }}
          >
            Search
          </button>
        </form>

        <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
          <Link
            href="/dashboard/patients/new"
            style={{
              flex: 1,
              textAlign: "center",
              padding: "10px 0",
              borderRadius: 8,
              background: `linear-gradient(135deg, ${theme.gold}, ${theme.goldLight})`,
              color: theme.navy,
              fontWeight: 700,
              textDecoration: "none",
              fontSize: 14,
            }}
          >
            + New Patient
          </Link>
        </div>
      </div>

      {loading && <p style={{ color: theme.gray }}>Searching...</p>}

      {results && results.length === 0 && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, color: theme.gray }}>
          No existing patient found for that number. Use "New Patient" above to register them.
        </div>
      )}

      {results && results.length > 0 && (
        <div style={{ display: "grid", gap: 12 }}>
          {results.map((p) => (
            <Link
              key={p.id}
              href={`/dashboard/patients/${p.id}`}
              style={{
                display: "block",
                background: "#fff",
                borderRadius: 12,
                padding: 16,
                textDecoration: "none",
                color: theme.navy,
                boxShadow: "0 2px 10px rgba(39,33,77,0.05)",
              }}
            >
              <div style={{ fontWeight: 700 }}>{p.name}</div>
              <div style={{ fontSize: 13, color: theme.gray }}>{p.mobile}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
