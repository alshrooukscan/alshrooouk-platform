"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { theme } from "../../../lib/theme";
import { formatVisitDate } from "../../../lib/format";
import ImpersonationBanner from "../../../components/ImpersonationBanner";
import Loading from "../../../lib/Loading";

export default function DoctorPortalPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openPatientId, setOpenPatientId] = useState(null);
  const [filesByPatient, setFilesByPatient] = useState({});
  const [filesLoading, setFilesLoading] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();

  useEffect(() => {
    fetch("/api/portal/doctor/data")
      .then((r) => {
        if (!r.ok) throw new Error("unauthorized");
        return r.json();
      })
      .then((d) => {
        if (d.mustChangePassword) {
          router.replace("/portal/change-password");
          return;
        }
        setData(d);
        setLoading(false);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  async function handleLogout() {
    await fetch("/api/portal/logout", { method: "POST" });
    router.push("/login");
  }

  async function toggleFiles(patientId) {
    if (openPatientId === patientId) {
      setOpenPatientId(null);
      return;
    }
    setOpenPatientId(patientId);
    if (!filesByPatient[patientId]) {
      setFilesLoading(true);
      const res = await fetch(`/api/portal/doctor/patient-files?patientId=${patientId}`);
      const result = await res.json();
      setFilesByPatient((prev) => ({ ...prev, [patientId]: result.files || [] }));
      setFilesLoading(false);
    }
  }

  if (loading) return <Loading />;

  // Group visits by patient so each referred patient appears once with their full history and files
  const patientGroups = {};
  for (const v of data.visits) {
    const pid = v.patient_id;
    if (!patientGroups[pid]) patientGroups[pid] = { name: v.patients?.name, mobile: v.patients?.mobile, visits: [] };
    patientGroups[pid].visits.push(v);
  }

  // Substring search on name or mobile, same behavior as the staff Patients page
  const q = query.trim().toLowerCase();
  const qDigits = query.replace(/\D/g, "");
  const filteredGroups = Object.entries(patientGroups).filter(([, group]) => {
    if (!q) return true;
    const nameMatch = group.name?.toLowerCase().includes(q);
    const mobileMatch = qDigits && group.mobile?.replace(/\D/g, "").includes(qDigits);
    return nameMatch || mobileMatch;
  });

  function StatusChip({ label, active }) {
    return (
      <span
        style={{
          fontSize: 10,
          padding: "3px 8px",
          borderRadius: 999,
          fontWeight: 700,
          whiteSpace: "nowrap",
          background: active ? "#e7f6ec" : "#f2f2f2",
          color: active ? "#1e7a3c" : "#999",
        }}
      >
        {active ? "\u2713" : "\u25cb"} {label}
      </span>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: theme.bg }}>
      <ImpersonationBanner impersonatedBy={data.impersonatedBy} name={data.doctor?.name} />
      <div style={{ background: theme.navy, padding: "10px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <img src="/logo-mark.png" alt="" style={{ height: 32, width: "auto" }} />
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>Al Shrooouk Scan &amp; Lab</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => router.push("/portal/doctor/dental-stock")}
            style={{ background: theme.gold, border: "none", color: theme.navy, borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
          >
            Request Dental Stock Items
          </button>
          <button onClick={handleLogout} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
            Log Out
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px" }}>
        <h2 style={{ color: theme.navy, marginBottom: 2 }}>{data.doctor?.name}</h2>
        <p style={{ color: theme.gold, fontWeight: 600, marginBottom: 20 }}>{data.doctor?.clinic_code} &middot; {data.doctor?.clinic_name}</p>

        <div style={{ background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Clinic Patients</h3>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>Every patient referred to {data.doctor?.clinic_code} is shown here, including cases referred by other doctors at this clinic.</p>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by patient name or mobile..."
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, marginBottom: 16, boxSizing: "border-box" }}
          />
          {Object.keys(patientGroups).length === 0 && <p style={{ color: theme.gray, fontSize: 14 }}>No referrals yet.</p>}
          {Object.keys(patientGroups).length > 0 && filteredGroups.length === 0 && <p style={{ color: theme.gray, fontSize: 14 }}>No patients match "{query}".</p>}
          {filteredGroups.map(([patientId, group]) => (
            <div key={patientId} style={{ borderBottom: "1px solid #f0f0f0", padding: "10px 0" }}>
              <div
                onClick={() => toggleFiles(patientId)}
                style={{ display: "flex", justifyContent: "space-between", cursor: "pointer" }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: theme.navy }}>{group.name}</div>
                  <div style={{ fontSize: 12, color: theme.gray }}>{group.visits.length} visit{group.visits.length > 1 ? "s" : ""}</div>
                </div>
                <span style={{ color: theme.gold, fontSize: 12, fontWeight: 600 }}>
                  {openPatientId === patientId ? "Hide Files" : "View Files"}
                </span>
              </div>

              {openPatientId === patientId && (
                <div style={{ marginTop: 12, paddingLeft: 4 }}>
                  {group.visits.map((v) => (
                    <div key={v.id} style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 999, background: theme.goldLight, color: theme.navy, whiteSpace: "nowrap" }}>
                          {formatVisitDate(v.exam_date)}
                        </span>
                        <span style={{ fontSize: 12, color: theme.gray }}>{(v.scan_types || []).join(", ")}</span>
                      </div>
                      {v.doctors?.name && (
                        <div style={{ fontSize: 11, color: theme.gray, marginBottom: 4 }}>
                          Referred by Dr. {v.doctors.name}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                        <StatusChip label="Scanned" active={v.scanned} />
                        <StatusChip label="Raw Data Uploaded" active={v.raw_data_uploaded} />
                        <StatusChip label="Report Done" active={v.report_done} />
                      </div>
                      <div style={{ fontSize: 11, color: v.payment_status === "paid" ? "#1e7a3c" : v.payment_status === "partial" ? "#b45309" : "#999", fontWeight: 600 }}>
                        {v.payment_status === "paid" && "Paid in full"}
                        {v.payment_status === "partial" && `Partial - Paid ${Number(v.amount_paid || 0).toFixed(2)} EGP, Due ${(Number(v.amount_due || 0) - Number(v.amount_paid || 0)).toFixed(2)} EGP`}
                        {v.payment_status === "pending" && `Pending - Due ${Number(v.amount_due || 0).toFixed(2)} EGP`}
                        {(v.visit_payments || []).length > 0 && (
                          <span style={{ color: theme.gray, fontWeight: 400 }}> &middot; {[...new Set((v.visit_payments || []).map((p) => p.payment_method))].join(" + ")}</span>
                        )}
                      </div>
                    </div>
                  ))}
                  <div style={{ marginTop: 8 }}>
                    {filesLoading && !filesByPatient[patientId] && <p style={{ fontSize: 12, color: theme.gray }}>Loading files...</p>}
                    {filesByPatient[patientId]?.length === 0 && <p style={{ fontSize: 12, color: theme.gray }}>No files uploaded for this patient yet.</p>}
                    {(() => {
                      const files = filesByPatient[patientId] || [];
                      const FileGrid = ({ items }) => (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          {items.map((f) => (
                            <a
                              key={f.id}
                              href={f.webViewLink}
                              target="_blank"
                              rel="noreferrer"
                              style={{ background: "#faf9fb", borderRadius: 8, padding: 10, textDecoration: "none" }}
                            >
                              <div style={{ fontSize: 12, fontWeight: 600, color: theme.navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                              <div style={{ fontSize: 10, color: theme.gray }}>{new Date(f.createdTime).toLocaleDateString()}</div>
                            </a>
                          ))}
                        </div>
                      );
                      const ungrouped = files.filter((f) => !f.groupLabel);
                      const groups = {};
                      for (const f of files) if (f.groupLabel) (groups[f.groupLabel] = groups[f.groupLabel] || []).push(f);
                      return (
                        <>
                          {ungrouped.length > 0 && <FileGrid items={ungrouped} />}
                          {Object.entries(groups).map(([label, items]) => (
                            <div key={label} style={{ marginTop: 8 }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: theme.gray, marginBottom: 4, textTransform: "uppercase" }}>
                                Visit &mdash; {label.split("__")[0]}
                              </div>
                              <FileGrid items={items} />
                            </div>
                          ))}
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
