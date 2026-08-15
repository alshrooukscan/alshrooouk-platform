"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import { customerWhatsAppLink, scanWhatsAppLink, buildCustomerMessage, buildScanMessage } from "../../../../lib/whatsapp";

export default function PatientProfilePage() {
  const { id } = useParams();
  const router = useRouter();
  const [patient, setPatient] = useState(null);
  const [visits, setVisits] = useState([]);
  const [credentials, setCredentials] = useState(null);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    load();
    loadFiles();
  }, [id]);

  async function loadFiles() {
    const res = await fetch(`/api/drive/list?patientId=${id}`);
    const data = await res.json();
    setFiles(data.files || []);
  }

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(",")[1];
      const res = await fetch("/api/drive/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: id, filename: file.name, mimeType: file.type, base64 }),
      });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
      } else {
        await loadFiles();
      }
      setUploading(false);
    };
    reader.readAsDataURL(file);
  }

  async function load() {
    setLoading(true);
    const { data: p } = await supabase.from("patients").select("*").eq("id", id).single();
    const { data: v } = await supabase
      .from("visits")
      .select("id, scan_types, exam_date, payment_status, branch_id, doctor_id, amount_due, amount_paid, doctors(name, phone, email, clinic_code), branches(name)")
      .eq("patient_id", id)
      .order("exam_date", { ascending: false });
    const { data: auth } = await supabase.from("patient_auth").select("username").eq("patient_id", id).maybeSingle();
    setPatient(p);
    setVisits(v || []);
    setCredentials(auth);
    setLoading(false);
  }

  async function generateNewPassword() {
    const username = credentials?.username || patient.mobile.replace(/\D/g, "");
    const { data: pwd } = await supabase.rpc("create_patient_credentials", { p_patient_id: id, p_username: username });
    setCredentials({ username });
    return pwd;
  }

  async function handleCustomerWhatsApp() {
    const pwd = await generateNewPassword();
    const portalUrl = `${window.location.origin.replace("/dashboard", "")}/portal`;
    const username = credentials?.username || patient.mobile.replace(/\D/g, "");
    const link = customerWhatsAppLink({
      mobile: patient.mobile,
      patientName: patient.name,
      portalUrl,
      username,
      password: pwd,
    });
    const { data: session } = await supabase.auth.getUser();
    await supabase.from("whatsapp_log").insert({
      message_type: "customer",
      rendered_text: buildCustomerMessage({ patientName: patient.name, portalUrl, username, password: pwd }),
      sent_at: new Date().toISOString(),
      sent_by: session?.user?.id || null,
    });
    window.open(link, "_blank");
  }

  async function handleScanWhatsApp(visit) {
    const payload = {
      branch: visit.branches?.name || "",
      patientName: patient.name,
      mobile: patient.mobile,
      email: patient.email,
      scanTypes: (visit.scan_types || []).join(", "),
      doctorName: visit.doctors?.name,
      doctorPhone: visit.doctors?.phone,
      doctorEmail: visit.doctors?.email,
      clinicCode: visit.doctors?.clinic_code,
    };
    const link = scanWhatsAppLink(payload);
    const { data: session } = await supabase.auth.getUser();
    await supabase.from("whatsapp_log").insert({
      visit_id: visit.id,
      message_type: "scan",
      rendered_text: buildScanMessage(payload),
      sent_at: new Date().toISOString(),
      sent_by: session?.user?.id || null,
    });
    window.open(link, "_blank");
  }

  async function handleGenerateInvoice(visit) {
    const { data: invoiceNumber } = await supabase.rpc("generate_invoice_number");
    const { data: inv, error } = await supabase
      .from("invoices")
      .insert({
        visit_id: visit.id,
        invoice_number: invoiceNumber,
        amount: visit.amount_due,
        patient_name: patient.name,
        exam: (visit.scan_types || []).join(", "),
        exam_date: visit.exam_date,
      })
      .select("id")
      .single();
    if (error) {
      alert(error.message);
      return;
    }
    router.push(`/dashboard/invoices/${inv.id}`);
  }

  if (loading) return <p style={{ color: theme.gray }}>Loading...</p>;
  if (!patient) return <p style={{ color: theme.gray }}>Patient not found.</p>;

  return (
    <div>
      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginBottom: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ color: theme.navy, margin: 0 }}>{patient.name}</h1>
            <p style={{ color: theme.gray, margin: "4px 0" }}>
              {patient.mobile} {patient.email ? `· ${patient.email}` : ""}
            </p>
            {credentials && <p style={{ fontSize: 12, color: theme.gray }}>Portal username: {credentials.username}</p>}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 24 }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Visit History</h3>
          {visits.length === 0 && <p style={{ color: theme.gray, fontSize: 14 }}>No visits yet.</p>}
          {visits.map((v) => (
            <div key={v.id} style={{ borderBottom: "1px solid #f0f0f0", padding: "12px 0" }}>
              <div style={{ fontWeight: 600, color: theme.navy }}>{(v.scan_types || []).join(", ")}</div>
              <div style={{ fontSize: 12, color: theme.gray }}>
                {v.exam_date} · {v.branches?.name || "—"} · {v.payment_status}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={() => handleScanWhatsApp(v)} style={smallBtn}>Send Scan WhatsApp</button>
                <button onClick={() => handleGenerateInvoice(v)} style={smallBtn}>Generate Invoice</button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Quick Actions</h3>
          <button onClick={handleCustomerWhatsApp} style={actionBtn}>Send Customer WhatsApp</button>
          <label style={{ ...actionBtn, display: "block", textAlign: "center", opacity: uploading ? 0.6 : 1, background: theme.gold, color: theme.navy }}>
            {uploading ? "Uploading..." : "Upload Scan Files"}
            <input type="file" onChange={handleFileUpload} disabled={uploading} style={{ display: "none" }} />
          </label>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: 12 }}>
            Files upload directly into this patient's Drive folder, nested under their referring doctor automatically if one is assigned.
          </p>
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Patient Files</h3>
        {files.length === 0 && <p style={{ color: theme.gray, fontSize: 14 }}>No files uploaded yet.</p>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
          {files.map((f) => (
            <a
              key={f.id}
              href={f.webViewLink}
              target="_blank"
              rel="noreferrer"
              style={{ display: "block", border: "1px solid #eee", borderRadius: 10, padding: 12, textDecoration: "none", color: theme.navy }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
              <div style={{ fontSize: 11, color: theme.gray, marginTop: 4 }}>{new Date(f.createdTime).toLocaleDateString()}</div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

const actionBtn = {
  display: "block",
  width: "100%",
  padding: "12px 0",
  marginBottom: 10,
  borderRadius: 8,
  border: "none",
  background: theme.navy,
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: 13,
};
const smallBtn = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid #ddd",
  background: "#fff",
  color: theme.navy,
  fontSize: 12,
  cursor: "pointer",
};
