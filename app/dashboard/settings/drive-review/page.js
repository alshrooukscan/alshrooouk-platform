"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";

export default function DriveReviewPage() {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [minConfidence, setMinConfidence] = useState(0);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("drive_match_candidates").select("*").eq("status", "pending").order("similarity", { ascending: false });
    const list = data || [];

    // Enrich with each patient's referring doctor + clinic code, so staff can
    // cross-check that the Drive match makes sense for who actually referred them.
    const patientIds = [...new Set(list.map((c) => c.patient_id))];
    const { data: visitRows } = patientIds.length
      ? await supabase.from("visits").select("patient_id, doctors(name, clinic_code)").in("patient_id", patientIds).not("doctor_id", "is", null).order("exam_date", { ascending: false })
      : { data: [] };
    const doctorByPatient = {};
    for (const v of visitRows || []) {
      if (!doctorByPatient[v.patient_id] && v.doctors) doctorByPatient[v.patient_id] = v.doctors;
    }
    const enriched = list.map((c) => ({ ...c, referringDoctor: doctorByPatient[c.patient_id] || null }));

    setCandidates(enriched);
    setLoading(false);
  }

  async function handleApprove(c) {
    setBusyId(c.id);
    await supabase.from("patients").update({ drive_folder_id: c.drive_folder_id }).eq("id", c.patient_id);
    await supabase.from("drive_folder_index").upsert(
      { entity_type: "patient", entity_id: c.patient_id, drive_folder_id: c.drive_folder_id },
      { onConflict: "entity_type,entity_id" }
    );
    await supabase.from("drive_match_candidates").update({ status: "approved" }).eq("id", c.id);
    setCandidates((prev) => prev.filter((x) => x.id !== c.id));
    setBusyId(null);
  }

  async function handleReject(c) {
    setBusyId(c.id);
    await supabase.from("drive_match_candidates").update({ status: "rejected" }).eq("id", c.id);
    setCandidates((prev) => prev.filter((x) => x.id !== c.id));
    setBusyId(null);
  }

  const visible = candidates.filter((c) => c.similarity >= minConfidence);

  return (
    <div>
      <p style={{ fontSize: 12, color: theme.gray }}>
        <Link href="/dashboard/settings" style={{ color: theme.gray }}>Settings</Link> &gt; Drive Name Review
      </p>
      <h1 style={{ color: theme.navy, margin: "4px 0" }}>Drive Folder Name Matches</h1>
      <p style={{ color: theme.gray, marginBottom: 20, maxWidth: 720 }}>
        Patients with no linked Drive folder whose name closely resembles an unlinked Drive folder. Nothing here has been connected automatically, some pairs that look similar are actually different people (e.g., "Emad Ahmed" vs "Eman Ahmed"). Review each one, don't just approve by confidence score alone.
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: theme.gray, fontWeight: 600 }}>Minimum confidence:</span>
        {[0, 0.82, 0.90, 0.95].map((v) => (
          <button
            key={v}
            onClick={() => setMinConfidence(v)}
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              border: `1px solid ${minConfidence === v ? theme.gold : "#ddd"}`,
              background: minConfidence === v ? theme.goldLight : "#fff",
              color: theme.navy,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {v === 0 ? "All" : `${Math.round(v * 100)}%+`}
          </button>
        ))}
        <span style={{ fontSize: 12, color: theme.gray, marginLeft: "auto" }}>{visible.length} pending</span>
      </div>

      {loading && <p style={{ color: theme.gray }}>Loading...</p>}
      {!loading && visible.length === 0 && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, textAlign: "center", color: theme.gray }}>
          No pending matches at this confidence level.
        </div>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        {visible.map((c) => (
          <div key={c.id} style={{ background: "#fff", borderRadius: 12, padding: 16, display: "flex", alignItems: "center", gap: 16, boxShadow: "0 2px 10px rgba(39,33,77,0.05)" }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: "4px 10px",
                borderRadius: 999,
                background: c.similarity >= 0.95 ? "#e8f5e9" : c.similarity >= 0.9 ? "#fff8e1" : "#fdecea",
                color: c.similarity >= 0.95 ? "#2e7d32" : c.similarity >= 0.9 ? "#a97c00" : "#ba1a1a",
                minWidth: 50,
                textAlign: "center",
              }}
            >
              {Math.round(c.similarity * 100)}%
            </div>
            <div style={{ flex: 1 }}>
              <Link href={`/dashboard/patients/${c.patient_id}`} target="_blank" style={{ fontWeight: 700, color: theme.navy, textDecoration: "none" }}>
                {c.patient_name}
              </Link>
              <span style={{ color: theme.gray, fontSize: 13 }}> — patient in system</span>
              <div style={{ fontSize: 11, color: theme.gray, marginTop: 2 }}>
                {c.referringDoctor
                  ? `Referred by Dr. ${c.referringDoctor.name} (clinic ${c.referringDoctor.clinic_code})`
                  : "No referring doctor on file"}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <a href={`https://drive.google.com/drive/folders/${c.drive_folder_id}`} target="_blank" rel="noreferrer" style={{ fontWeight: 700, color: theme.gold, textDecoration: "none" }}>
                {c.folder_name}
              </a>
              <span style={{ color: theme.gray, fontSize: 13 }}> — Drive folder</span>
            </div>
            <button onClick={() => handleApprove(c)} disabled={busyId === c.id} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#2e7d32", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
              {busyId === c.id ? "..." : "Same Person, Link"}
            </button>
            <button onClick={() => handleReject(c)} disabled={busyId === c.id} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
              Not a Match
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
