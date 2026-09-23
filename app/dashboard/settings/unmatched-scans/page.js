"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";

// Studies the DICOM gateway received but could not match to a visit by
// StudyInstanceUID, AccessionNumber, or PatientID - the machine's local
// patient entry didn't line up with what shscan.com had queued. The file
// itself is safe (sitting in the "_Unmatched DICOM Studies" Drive folder),
// this screen just closes the last mile: pick the real visit by hand.
export default function UnmatchedScansPage() {
  const [studies, setStudies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [searchByStudy, setSearchByStudy] = useState({});
  const [resultsByStudy, setResultsByStudy] = useState({});

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data: session } = await supabase.auth.getSession();
    const res = await fetch("/api/gateway/unmatched", {
      headers: { Authorization: `Bearer ${session.session?.access_token}` },
    });
    const result = await res.json();
    setStudies(result.studies || []);
    setLoading(false);
  }

  async function searchVisits(studyId, term) {
    setSearchByStudy((prev) => ({ ...prev, [studyId]: term }));
    if (!term || term.trim().length < 2) {
      setResultsByStudy((prev) => ({ ...prev, [studyId]: [] }));
      return;
    }
    // Mobile number or name - the same two ways staff already look a patient
    // up everywhere else in the dashboard.
    const { data: patients } = await supabase
      .from("patients")
      .select("id, name, mobile")
      .or(`name.ilike.%${term}%,mobile.ilike.%${term}%`)
      .limit(8);
    if (!patients || patients.length === 0) {
      setResultsByStudy((prev) => ({ ...prev, [studyId]: [] }));
      return;
    }
    const { data: visits } = await supabase
      .from("visits")
      .select("id, exam_date, scan_types, patient_id")
      .in("patient_id", patients.map((p) => p.id))
      .order("exam_date", { ascending: false })
      .limit(20);
    const withNames = (visits || []).map((v) => ({ ...v, patientName: patients.find((p) => p.id === v.patient_id)?.name }));
    setResultsByStudy((prev) => ({ ...prev, [studyId]: withNames }));
  }

  async function attach(study, visit) {
    setBusyId(study.id);
    const { data: session } = await supabase.auth.getSession();
    const res = await fetch(`/api/gateway/unmatched/${study.id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token}` },
      body: JSON.stringify({ visitId: visit.id }),
    });
    if (res.ok) {
      setStudies((prev) => prev.filter((s) => s.id !== study.id));
    } else {
      const err = await res.json();
      alert(err.error || "Could not attach this study.");
    }
    setBusyId(null);
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: theme.gray }}>
        <Link href="/dashboard/settings" style={{ color: theme.gray }}>Settings</Link> &gt; Unmatched Scans
      </p>
      <h1 style={{ color: theme.navy, margin: "4px 0" }}>Unmatched DICOM Scans</h1>
      <p style={{ color: theme.gray, marginBottom: 20, maxWidth: 720 }}>
        Scans the CBCT gateway received but couldn't match to a visit automatically. The file is safe in Drive - attach it to the right patient's visit below, nothing here gets filed on a guess.
      </p>

      {loading && <p style={{ color: theme.gray }}>Loading...</p>}
      {!loading && studies.length === 0 && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, textAlign: "center", color: theme.gray }}>
          Nothing unmatched right now.
        </div>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        {studies.map((s) => (
          <div key={s.id} style={{ background: "#fff", borderRadius: 12, padding: 16, boxShadow: "0 2px 10px rgba(39,33,77,0.05)" }}>
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: theme.navy }}>{s.file_name || "Untitled study"}</div>
                <div style={{ fontSize: 12, color: theme.gray, marginTop: 4 }}>
                  Machine sent: patient ID "{s.dicom_patient_id_raw || "—"}", name "{s.dicom_patient_name_raw || "—"}"
                </div>
                <div style={{ fontSize: 11, color: theme.gray, marginTop: 2 }}>
                  Received {new Date(s.received_at).toLocaleString()}
                  {s.drive_file_id && (
                    <>
                      {" · "}
                      <a href={`https://drive.google.com/file/d/${s.drive_file_id}/view`} target="_blank" rel="noreferrer" style={{ color: theme.gold }}>
                        view file
                      </a>
                    </>
                  )}
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <input
                  placeholder="Search patient by name or mobile"
                  value={searchByStudy[s.id] || ""}
                  onChange={(e) => searchVisits(s.id, e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13 }}
                />
                <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
                  {(resultsByStudy[s.id] || []).map((v) => (
                    <button
                      key={v.id}
                      onClick={() => attach(s, v)}
                      disabled={busyId === s.id}
                      style={{
                        textAlign: "left", padding: "8px 10px", borderRadius: 8, border: "1px solid #eee",
                        background: "#fafafa", cursor: "pointer", fontSize: 12, color: theme.navy,
                      }}
                    >
                      <strong>{v.patientName}</strong> — visit {v.exam_date} ({(v.scan_types || []).join(", ") || "no scan type"})
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
