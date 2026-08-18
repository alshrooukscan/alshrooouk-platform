"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import { theme } from "../../../lib/theme";
import { usePermissions } from "../../../lib/usePermissions";

const PAGE_SIZE = 50;

export default function PatientsPage() {
  const { isAdmin } = usePermissions();
  const [mobileQuery, setMobileQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [scanType, setScanType] = useState("");
  const [doctors, setDoctors] = useState([]);
  const [examTypes, setExamTypes] = useState([]);
  const [results, setResults] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loginAsBusy, setLoginAsBusy] = useState(null);

  useEffect(() => {
    supabase.from("doctors").select("id, name, clinic_code").order("name").then(({ data }) => setDoctors(data || []));
    supabase.from("exam_types").select("name").eq("is_active", true).order("name").then(({ data }) => setExamTypes(data || []));
  }, []);

  useEffect(() => {
    search();
  }, [page, mobileQuery, dateFrom, dateTo, doctorId, scanType]);

  async function search() {
    setLoading(true);
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const hasVisitFilter = dateFrom || dateTo || doctorId || scanType;

    if (hasVisitFilter) {
      let vq = supabase.from("visits").select("patient_id, patients!inner(id, name, mobile, dob, created_at)", { count: "exact" });
      if (dateFrom) vq = vq.gte("exam_date", dateFrom);
      if (dateTo) vq = vq.lte("exam_date", dateTo);
      if (doctorId) vq = vq.eq("doctor_id", doctorId);
      if (scanType) vq = vq.contains("scan_types", [scanType]);
      if (mobileQuery) vq = vq.ilike("patients.mobile", `%${mobileQuery}%`);
      vq = vq.order("exam_date", { ascending: false }).range(from, to);

      const { data, count } = await vq;
      const seen = new Set();
      const patients = [];
      (data || []).forEach((row) => {
        if (row.patients && !seen.has(row.patients.id)) {
          seen.add(row.patients.id);
          patients.push(row.patients);
        }
      });
      setResults(patients);
      setTotalCount(count || 0);
    } else {
      let pq = supabase.from("patients").select("id, name, mobile, dob, created_at", { count: "exact" });
      if (mobileQuery) pq = pq.ilike("mobile", `%${mobileQuery}%`);
      pq = pq.order("created_at", { ascending: false }).range(from, to);
      const { data, count } = await pq;
      setResults(data || []);
      setTotalCount(count || 0);
    }
    setLoading(false);
  }

  function resetToFirstPage(setter) {
    return (value) => {
      setPage(0);
      setter(value);
    };
  }

  async function handleLoginAs(patient) {
    setLoginAsBusy(patient.id);
    const { data: session } = await supabase.auth.getSession();
    const res = await fetch("/api/admin/login-as", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token}` },
      body: JSON.stringify({ type: "patient", id: patient.id }),
    });
    const result = await res.json();
    setLoginAsBusy(null);
    if (result.redirect) window.open(result.redirect, "_blank");
    else alert(result.error || "Could not log in as this patient");
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div>
      <h1 style={{ color: theme.navy, marginBottom: 4 }}>Patient Directory</h1>
      <p style={{ color: theme.gray, marginBottom: 20 }}>
        {totalCount.toLocaleString()} patients on record. Search by mobile number or filter by visit details below.
      </p>

      <div style={{ background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)", marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
          <input
            value={mobileQuery}
            onChange={(e) => resetToFirstPage(setMobileQuery)(e.target.value)}
            placeholder="Search by mobile number..."
            style={{ flex: 1, padding: "12px 14px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14 }}
          />
          <Link
            href="/dashboard/patients/new"
            style={{
              padding: "0 24px",
              display: "flex",
              alignItems: "center",
              borderRadius: 8,
              background: `linear-gradient(135deg, ${theme.gold}, ${theme.goldLight})`,
              color: theme.navy,
              fontWeight: 700,
              textDecoration: "none",
              fontSize: 14,
              whiteSpace: "nowrap",
            }}
          >
            + New Patient
          </Link>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          <div>
            <label style={filterLabel}>From Date</label>
            <input type="date" value={dateFrom} onChange={(e) => resetToFirstPage(setDateFrom)(e.target.value)} style={filterInput} />
          </div>
          <div>
            <label style={filterLabel}>To Date</label>
            <input type="date" value={dateTo} onChange={(e) => resetToFirstPage(setDateTo)(e.target.value)} style={filterInput} />
          </div>
          <div>
            <label style={filterLabel}>Doctor</label>
            <select value={doctorId} onChange={(e) => resetToFirstPage(setDoctorId)(e.target.value)} style={filterInput}>
              <option value="">All doctors</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>{d.name} ({d.clinic_code})</option>
              ))}
            </select>
          </div>
          <div>
            <label style={filterLabel}>Scan Type</label>
            <select value={scanType} onChange={(e) => resetToFirstPage(setScanType)(e.target.value)} style={filterInput}>
              <option value="">All scan types</option>
              {examTypes.map((e) => (
                <option key={e.name} value={e.name}>{e.name}</option>
              ))}
            </select>
          </div>
        </div>
        {(dateFrom || dateTo || doctorId || scanType || mobileQuery) && (
          <button
            onClick={() => {
              setMobileQuery(""); setDateFrom(""); setDateTo(""); setDoctorId(""); setScanType(""); setPage(0);
            }}
            style={{ marginTop: 10, background: "none", border: "none", color: theme.gold, fontSize: 12, cursor: "pointer", fontWeight: 600 }}
          >
            Clear all filters
          </button>
        )}
      </div>

      {loading && <p style={{ color: theme.gray }}>Loading...</p>}
      {!loading && results.length === 0 && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, color: theme.gray, textAlign: "center" }}>
          No patients match these filters.
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {results.map((p) => (
          <div
            key={p.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "#fff",
              borderRadius: 12,
              padding: 16,
              boxShadow: "0 2px 10px rgba(39,33,77,0.05)",
            }}
          >
            <Link href={`/dashboard/patients/${p.id}`} style={{ textDecoration: "none", color: theme.navy, flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{p.name}</div>
              <div style={{ fontSize: 13, color: theme.gray }}>{p.mobile || "no mobile on file"}</div>
            </Link>
            {isAdmin && (
              <button
                onClick={() => handleLoginAs(p)}
                disabled={loginAsBusy === p.id}
                style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontSize: 12, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}
              >
                {loginAsBusy === p.id ? "..." : "Login As"}
              </button>
            )}
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginTop: 24 }}>
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} style={pageBtn}>Previous</button>
          <span style={{ fontSize: 13, color: theme.gray }}>Page {page + 1} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={pageBtn}>Next</button>
        </div>
      )}
    </div>
  );
}

const filterLabel = { fontSize: 11, fontWeight: 600, color: theme.gray, display: "block", marginBottom: 4 };
const filterInput = { width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, boxSizing: "border-box" };
const pageBtn = { padding: "8px 18px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontSize: 13, cursor: "pointer", fontWeight: 600 };
