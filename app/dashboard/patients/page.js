"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import { theme } from "../../../lib/theme";
import { usePermissions } from "../../../lib/usePermissions";
import { exportToCsv } from "../../../lib/exportCsv";
import { formatPhone } from "../../../lib/formatPhone";

const PAGE_SIZE = 50;
// Each stage filter is tri-state: null = All (no filter), true = On (must
// have this), false = Off (must NOT have this). onLabel/offLabel are the
// exact words shown on the two active states - offLabel uses natural
// negation (Unpaid, not "Not Paid") to match how these are actually said.
const STAGE_LABELS = [
  { key: "paid", onLabel: "Paid", offLabel: "Unpaid" },
  { key: "scanned", onLabel: "Scanned", offLabel: "Not Scanned" },
  { key: "raw_data_uploaded", onLabel: "Raw Data Uploaded", offLabel: "Raw Data Not Uploaded" },
  { key: "report_done", onLabel: "Report Done", offLabel: "Report Not Done" },
  { key: "invoice_generated", onLabel: "Invoice Generated", offLabel: "Invoice Not Generated" },
];
const EMPTY_STAGE_FILTERS = { paid: null, scanned: null, raw_data_uploaded: null, report_done: null, invoice_generated: null };

export default function PatientsPage() {
  const { isAdmin } = usePermissions();
  const [mobileQuery, setMobileQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [scanType, setScanType] = useState("");
  const [stageFilters, setStageFilters] = useState(EMPTY_STAGE_FILTERS);
  const [doctors, setDoctors] = useState([]);
  const [examTypes, setExamTypes] = useState([]);
  const [results, setResults] = useState([]);
  const [statusByPatient, setStatusByPatient] = useState({});
  const [totalCount, setTotalCount] = useState(0);
  const [withoutFolderCount, setWithoutFolderCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loginAsBusy, setLoginAsBusy] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    supabase.from("doctors").select("id, name, clinic_code").order("name").then(({ data }) => setDoctors(data || []));
    supabase.from("exam_types").select("name").eq("is_active", true).order("name").then(({ data }) => setExamTypes(data || []));
    supabase.from("patients").select("id", { count: "exact", head: true }).is("drive_folder_id", null).then(({ count }) => setWithoutFolderCount(count || 0));
  }, []);

  useEffect(() => {
    search();
  }, [page, mobileQuery, dateFrom, dateTo, doctorId, scanType, stageFilters]);

  const anyStageFilter = Object.values(stageFilters).some((v) => v !== null);

  async function search() {
    setLoading(true);
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const hasVisitFilter = dateFrom || dateTo || doctorId || scanType || anyStageFilter;

    let patientsPage = [];
    let count = 0;

    if (hasVisitFilter) {
      // "Invoice Generated" isn't a plain column on visits - it's whether a
      // matching row exists in invoices. On (true) can use an inner join to
      // filter directly. Off (false) needs the opposite (visits with NO
      // matching invoice), which PostgREST can't express as a single embedded
      // filter, so the set of invoiced visit ids is fetched first and
      // excluded explicitly.
      const invoiceJoin = stageFilters.invoice_generated === true ? "invoices!inner(id)" : "invoices(id)";
      let excludeVisitIds = null;
      if (stageFilters.invoice_generated === false) {
        const { data: invoicedRows } = await supabase.from("invoices").select("visit_id").not("visit_id", "is", null);
        excludeVisitIds = [...new Set((invoicedRows || []).map((r) => r.visit_id))];
      }

      let vq = supabase.from("visits").select(`id, patient_id, patients!inner(id, name, mobile, dob, created_at, drive_folder_id), ${invoiceJoin}`, { count: "exact" });
      if (dateFrom) vq = vq.gte("exam_date", dateFrom);
      if (dateTo) vq = vq.lte("exam_date", dateTo);
      if (doctorId) vq = vq.eq("doctor_id", doctorId);
      if (scanType) vq = vq.contains("scan_types", [scanType]);
      if (mobileQuery) vq = vq.or(`mobile.ilike.%${mobileQuery}%,name.ilike.%${mobileQuery}%`, { foreignTable: "patients" });

      if (stageFilters.paid === true) vq = vq.eq("payment_status", "paid");
      if (stageFilters.paid === false) vq = vq.or("payment_status.neq.paid,payment_status.is.null");
      if (stageFilters.scanned === true) vq = vq.eq("scanned", true);
      if (stageFilters.scanned === false) vq = vq.eq("scanned", false);
      if (stageFilters.raw_data_uploaded === true) vq = vq.eq("raw_data_uploaded", true);
      if (stageFilters.raw_data_uploaded === false) vq = vq.eq("raw_data_uploaded", false);
      if (stageFilters.report_done === true) vq = vq.eq("report_done", true);
      if (stageFilters.report_done === false) vq = vq.eq("report_done", false);
      if (excludeVisitIds !== null) {
        vq = excludeVisitIds.length > 0 ? vq.not("id", "in", `(${excludeVisitIds.join(",")})`) : vq;
      }

      vq = vq.order("exam_date", { ascending: false }).range(from, to);

      const { data, count: c } = await vq;
      const seen = new Set();
      (data || []).forEach((row) => {
        if (row.patients && !seen.has(row.patients.id)) {
          seen.add(row.patients.id);
          patientsPage.push(row.patients);
        }
      });
      count = c || 0;
    } else {
      let pq = supabase.from("patients").select("id, name, mobile, dob, created_at, last_visit_date, drive_folder_id", { count: "exact" });
      if (mobileQuery) pq = pq.or(`mobile.ilike.%${mobileQuery}%,name.ilike.%${mobileQuery}%`);
      // Newest-visit-first, not newest-record-first - a patient registered
      // long ago who was just scanned today should surface at the top, the
      // same way the filtered view (which sorts by exam_date) already does.
      // Patients with no visit yet fall to the end rather than the top.
      pq = pq.order("last_visit_date", { ascending: false, nullsFirst: false }).range(from, to);
      const { data, count: c } = await pq;
      patientsPage = data || [];
      count = c || 0;
    }

    setResults(patientsPage);
    setTotalCount(count);

    // Fetch each visible patient's most recent visit for status badges.
    if (patientsPage.length > 0) {
      const ids = patientsPage.map((p) => p.id);
      const { data: recentVisits } = await supabase
        .from("visits")
        .select("patient_id, scan_types, payment_status, scanned, raw_data_uploaded, report_done, invoices(id), amount_paid, doctor_id, doctors(name, clinic_code), visit_payments(payment_method)")
        .in("patient_id", ids)
        .order("created_at", { ascending: false });
      const statusMap = {};
      for (const v of recentVisits || []) {
        if (!statusMap[v.patient_id]) {
          statusMap[v.patient_id] = {
            scan_types: v.scan_types,
            paid: v.payment_status === "paid",
            scanned: v.scanned,
            raw_data_uploaded: v.raw_data_uploaded,
            report_done: v.report_done,
            invoice_generated: (v.invoices || []).length > 0,
            amount_paid: v.amount_paid,
            payment_methods: [...new Set((v.visit_payments || []).map((p) => p.payment_method))].join(" + "),
            doctor_id: v.doctor_id,
            doctor_name: v.doctors?.name,
            clinic_code: v.doctors?.clinic_code,
          };
        }
      }
      setStatusByPatient(statusMap);
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

  async function handleExportCurrent() {
    exportToCsv("patients-current-view.csv", results.map((p) => ({
      Name: p.name,
      Mobile: p.mobile || "",
      DOB: p.dob || "",
      "Has Drive Folder": p.drive_folder_id ? "Yes" : "No",
    })));
  }

  async function handleExportMissingFolders() {
    setExporting(true);
    const { data } = await supabase.from("patients").select("name, mobile, created_at").is("drive_folder_id", null).order("name");
    setExporting(false);
    exportToCsv("patients-without-drive-folder.csv", (data || []).map((p) => ({
      Name: p.name,
      Mobile: p.mobile || "",
      "Registered": p.created_at ? p.created_at.slice(0, 10) : "",
    })));
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div>
      <h1 style={{ color: theme.navy, marginBottom: 4 }}>Patient Directory</h1>
      <p style={{ color: theme.gray, marginBottom: 20 }}>
        {totalCount.toLocaleString()} patients on record. Search by name or mobile number, or filter by visit details below.
      </p>

      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ background: "#fff", borderRadius: 12, padding: "12px 20px", boxShadow: "0 2px 10px rgba(39,33,77,0.05)" }}>
          <div style={{ fontSize: 11, color: theme.gray, fontWeight: 600 }}>PATIENTS WITHOUT A DRIVE FOLDER</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: withoutFolderCount > 0 ? "#a97c00" : theme.navy }}>{withoutFolderCount.toLocaleString()}</div>
        </div>
        <button onClick={handleExportMissingFolders} disabled={exporting} style={{ ...pageBtn, alignSelf: "center" }}>
          {exporting ? "Preparing..." : "Export List (No Folder)"}
        </button>
        <button onClick={handleExportCurrent} style={{ ...pageBtn, alignSelf: "center" }}>Export Current View</button>
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)", marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
          <input
            value={mobileQuery}
            onChange={(e) => resetToFirstPage(setMobileQuery)(e.target.value)}
            placeholder="Search by name or mobile number..."
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
        {(dateFrom || dateTo || doctorId || scanType || mobileQuery || anyStageFilter) && (
          <button
            onClick={() => {
              setMobileQuery(""); setDateFrom(""); setDateTo(""); setDoctorId(""); setScanType("");
              setStageFilters(EMPTY_STAGE_FILTERS);
              setPage(0);
            }}
            style={{ marginTop: 10, background: "none", border: "none", color: theme.gold, fontSize: 12, cursor: "pointer", fontWeight: 600 }}
          >
            Clear all filters
          </button>
        )}

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 14, paddingTop: 14, borderTop: "1px solid #f0f0f0" }}>
          {STAGE_LABELS.map((s) => {
            const value = stageFilters[s.key]; // null = All, true = On, false = Off
            const setValue = (v) => resetToFirstPage(() => setStageFilters((prev) => ({ ...prev, [s.key]: v })))();
            const segStyle = (active, extra = {}) => ({
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: active ? 700 : 500,
              border: "none",
              cursor: "pointer",
              whiteSpace: "nowrap",
              ...extra,
            });
            return (
              <div key={s.key} style={{ display: "inline-flex", borderRadius: 999, border: `1px solid ${value !== null ? theme.gold : "#ddd"}`, overflow: "hidden" }}>
                <button
                  type="button"
                  onClick={() => setValue(false)}
                  style={segStyle(value === false, { background: value === false ? "#fdecea" : "#fff", color: value === false ? "#ba1a1a" : theme.navy, borderRight: "1px solid #eee" })}
                >
                  {s.offLabel}
                </button>
                <button
                  type="button"
                  onClick={() => setValue(null)}
                  style={segStyle(value === null, { background: value === null ? "#f0f0f0" : "#fff", color: theme.gray, borderRight: "1px solid #eee" })}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setValue(true)}
                  style={segStyle(value === true, { background: value === true ? theme.goldLight : "#fff", color: theme.navy })}
                >
                  {s.onLabel}
                </button>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14, paddingTop: 14, borderTop: "1px solid #f0f0f0" }}>
          <span style={{ fontSize: 13, color: theme.gray }}>
            Matching current filters: <strong style={{ color: theme.navy, fontSize: 16 }}>{totalCount.toLocaleString()}</strong> patient{totalCount === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {loading && <p style={{ color: theme.gray }}>Loading...</p>}
      {!loading && results.length === 0 && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, color: theme.gray, textAlign: "center" }}>
          No patients match these filters.
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {results.map((p) => {
          const status = statusByPatient[p.id];
          return (
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
              <Link href={`/dashboard/patients/${p.id}`} target="_blank" style={{ textDecoration: "none", color: theme.navy, flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{p.name}</div>
                <div style={{ fontSize: 13, color: theme.gray, marginBottom: status?.scan_types?.length ? 2 : (status ? 6 : 0) }}>
                  {p.mobile ? formatPhone(p.mobile) : "no mobile on file"}
                  {p.dob && ` · ${new Date(p.dob).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`}
                </div>
                {status?.scan_types?.length > 0 && (
                  <div style={{ fontSize: 12, color: theme.navy, fontWeight: 600, marginBottom: 2 }}>{status.scan_types.join(", ")}</div>
                )}
                {Number(status?.amount_paid) > 0 && (
                  <div style={{ fontSize: 12, color: theme.gray, marginBottom: 2 }}>
                    Paid: {Number(status.amount_paid).toFixed(2)} EGP{status.payment_methods ? ` · ${status.payment_methods}` : ""}
                  </div>
                )}
                {status?.doctor_id && (
                  <div style={{ fontSize: 12, color: theme.gray, marginBottom: 6 }}>
                    {status.clinic_code && `Clinic Code: ${status.clinic_code} · `}Referred by: Dr {status.doctor_name || "—"}
                  </div>
                )}
                {status && (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {STAGE_LABELS.map((s) => (
                      <span
                        key={s.key}
                        style={{
                          fontSize: 10,
                          padding: "2px 8px",
                          borderRadius: 999,
                          fontWeight: 600,
                          background: status[s.key] ? "#e8f5e9" : "#f5f5f5",
                          color: status[s.key] ? "#2e7d32" : "#aaa",
                        }}
                      >
                        {status[s.key] ? "✓" : "○"} {s.onLabel}
                      </span>
                    ))}
                  </div>
                )}
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
          );
        })}
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
