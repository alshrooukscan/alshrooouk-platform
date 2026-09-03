"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { theme } from "../../../lib/theme";
import { usePermissions } from "../../../lib/usePermissions";
import { clientInvoiceWhatsAppLink, clientReportWhatsAppLink, directWhatsAppLink } from "../../../lib/whatsapp";
import WhatsAppDropdown from "../../../components/WhatsAppDropdown";
import { uploadFileToDrive } from "../../../lib/uploadToDrive";

// Every report request lives here regardless of source - an internal one
// auto-created because a scan's flagged as requiring a report, or a real
// external client's own upload. Both share the exact same pending/completed
// lifecycle and the same client_id attribution underneath.
export default function ReportsPage() {
  const { profile } = usePermissions();
  const [reports, setReports] = useState([]);
  const [filter, setFilter] = useState("pending");
  // Internal rows are auto-created when a scan requires a report; client rows
  // come from an external client's own request. Same lifecycle, but the two
  // queues are worked by different people, so they get their own tab.
  const [sourceFilter, setSourceFilter] = useState("all");
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    load();
  }, [filter, sourceFilter]);

  async function load() {
    setLoading(true);
    const [{ data: r }, { data: s }] = await Promise.all([
      (sourceFilter === "all"
        ? supabase
            .from("reports")
            .select("*, clients(name, is_pseudo, contact_phone), patients(id, name)")
            .eq("status", filter)
            .order("created_at", { ascending: false })
        : supabase
            .from("reports")
            .select("*, clients(name, is_pseudo, contact_phone), patients(id, name)")
            .eq("status", filter)
            .eq("source_type", sourceFilter)
            .order("created_at", { ascending: false })),
      supabase.from("staff_profiles").select("id, name").order("name"),
    ]);
    setReports(r || []);
    setStaffList(s || []);
    setLoading(false);
  }

  async function assign(report, employeeId) {
    const staffMember = staffList.find((s) => s.id === employeeId);
    await supabase
      .from("reports")
      .update({ assigned_to_employee_id: employeeId || null, assigned_to_name: staffMember?.name || null })
      .eq("id", report.id);
    load();
  }

  async function handleFilePicked(report, file) {
    if (!file) return;
    setUploadingId(report.id);
    setUploadProgress(0);
    setError("");
    try {
      const { data: session } = await supabase.auth.getSession();
      const fileId = await uploadFileToDrive({
        file,
        initEndpoint: "/api/reports/upload-session",
        initBody: { reportId: report.id, fileName: file.name, mimeType: file.type },
        onProgress: (frac) => setUploadProgress(Math.round(frac * 100)),
        authToken: session.session?.access_token,
      });
      const res = await fetch("/api/reports/upload-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, reportId: report.id, fileName: file.name }),
      });
      const result = await res.json();
      if (!res.ok) {
        setError(result.error || "Upload failed.");
      } else {
        load();
      }
    } catch (e) {
      setError(e.message || "Upload failed.");
    }
    setUploadingId(null);
    setUploadProgress(0);
  }

  return (
    <div>
      <h1 style={{ color: theme.navy, margin: "0 0 4px" }}>Reports</h1>
      <p style={{ color: theme.gray, margin: "0 0 24px" }}>
        Every report needed - patients seen directly or referred by a doctor, and requests uploaded by external clients through their own portal.
      </p>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {["pending", "completed"].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              style={{
                padding: "6px 16px", borderRadius: 999, border: `1px solid ${filter === s ? theme.gold : "#ddd"}`,
                background: filter === s ? theme.goldLight : "#fff", color: theme.navy, fontSize: 12, fontWeight: 600, cursor: "pointer", textTransform: "capitalize",
              }}
            >
              {s}
            </button>
          ))}
          <span style={{ width: 1, background: "#e6e6ea", margin: "2px 6px" }} />
          {[
            { key: "all", label: "All sources" },
            { key: "internal", label: "Internal" },
            { key: "client", label: "Client" },
          ].map((o) => (
            <button
              key={o.key}
              onClick={() => setSourceFilter(o.key)}
              style={{
                padding: "6px 16px", borderRadius: 999, border: `1px solid ${sourceFilter === o.key ? theme.gold : "#ddd"}`,
                background: sourceFilter === o.key ? theme.goldLight : "#fff", color: theme.navy, fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}
            >
              {o.label}
            </button>
          ))}
        </div>

        {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}
        {!loading && reports.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>Nothing {filter}.</p>}
        <div style={{ display: "grid", gap: 10 }}>
          {reports.map((r) => (
            <div key={r.id} style={{ padding: "14px 0", borderBottom: "1px solid #f0f0f0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, color: theme.navy, fontSize: 14 }}>{r.scan_name}</div>
                  <div style={{ fontSize: 12, color: theme.gray }}>
                    {r.source_type === "client" ? "Client request" : "Internal"}{" \u00b7 "}{r.clients?.name}
                    {r.patients?.name && (
                      <>
                        {" \u00b7 Patient: "}
                        <a href={`/dashboard/patients/${r.patients.id}`}
                           style={{ color: theme.navy, fontWeight: 600, textDecoration: "none", borderBottom: `1px solid ${theme.gold}` }}>
                          {r.patients.name}
                        </a>
                      </>
                    )}
                    {" \u00b7 "}Needed by {r.date_required}
                  </div>
                  {r.client_uploaded_file_name && (
                    <a href={r.client_uploaded_file_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: theme.gold }}>
                      View what the client uploaded: {r.client_uploaded_file_name}
                    </a>
                  )}
                  {r.report_file_name && (
                    <div style={{ fontSize: 12 }}>
                      <a href={r.report_file_url} target="_blank" rel="noreferrer" style={{ color: "#2e7d32" }}>
                        Completed report: {r.report_file_name}
                      </a>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <select
                    value={r.assigned_to_employee_id || ""}
                    onChange={(e) => assign(r, e.target.value)}
                    style={{ fontSize: 12, padding: "6px 8px", borderRadius: 6, border: "1px solid #ddd" }}
                  >
                    <option value="">Unassigned</option>
                    {staffList.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  {r.status === "pending" && (
                    <label style={{ padding: "8px 16px", borderRadius: 8, background: theme.gold, color: theme.navy, fontWeight: 700, cursor: "pointer", fontSize: 12, opacity: uploadingId === r.id ? 0.6 : 1, position: "relative", overflow: "hidden" }}>
                      {uploadingId === r.id && (
                        <div style={{ position: "absolute", inset: 0, left: 0, width: `${uploadProgress}%`, background: "rgba(255,255,255,0.35)", transition: "width 0.15s linear" }} />
                      )}
                      <span style={{ position: "relative" }}>{uploadingId === r.id ? `Uploading... ${uploadProgress}%` : "Upload Report"}</span>
                      <input type="file" onChange={(e) => handleFilePicked(r, e.target.files?.[0])} disabled={uploadingId === r.id} style={{ display: "none" }} />
                    </label>
                  )}
                  {r.source_type === "client" && r.clients?.contact_phone && (
                    <WhatsAppDropdown
                      buttonStyle={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                      options={[
                        {
                          label: "Invoice",
                          onClick: () => window.open(clientInvoiceWhatsAppLink({ mobile: r.clients.contact_phone, clientName: r.clients.name, scanName: r.scan_name }), "_blank"),
                        },
                        {
                          label: "Report",
                          onClick: () => window.open(clientReportWhatsAppLink({ mobile: r.clients.contact_phone, clientName: r.clients.name, scanName: r.scan_name }), "_blank"),
                        },
                        { label: "Direct (empty)", onClick: () => window.open(directWhatsAppLink(r.clients.contact_phone), "_blank") },
                      ]}
                    />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
