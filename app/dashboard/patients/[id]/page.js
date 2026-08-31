"use client";

import { uploadFileToDrive } from "../../../../lib/uploadToDrive";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { formatPhone } from "../../../../lib/formatPhone";
import { theme } from "../../../../lib/theme";
import { formatMoney } from "../../../../lib/format";
import {
  customerWhatsAppLink, scanWhatsAppLink, buildCustomerMessage, buildScanMessage,
  patientReportWhatsAppLink, buildPatientReportMessage,
  patientInvoiceWhatsAppLink, buildPatientInvoiceMessage,
  patientRawDataWhatsAppLink, buildPatientRawDataMessage,
  directWhatsAppLink,
} from "../../../../lib/whatsapp";
import WhatsAppDropdown from "../../../../components/WhatsAppDropdown";
import { usePermissions } from "../../../../lib/usePermissions";
import { logActivity } from "../../../../lib/activityLog";
import PortalAccessCard from "../../../../components/PortalAccessCard";
import DeleteEntityButton from "../../../../components/DeleteEntityButton";
import { resolveUniqueUsername, resolvePatientUsername } from "../../../../lib/uniqueUsername";
import { syncPatientLastVisitDate } from "../../../../lib/syncPatientLastVisitDate";

const CATEGORY_LABELS = { "2d": "2D", "3d": "3D", bundle: "Bundle", misc: "Misc" };
const CATEGORY_ORDER = ["2d", "3d", "bundle", "misc"];
const DISCOUNT_REASONS = ["Referred Patient", "Doctor / Doctor Relative", "Approved by Management", "Workers / Workers Relatives", "People in Need", "Insurance", "Other"];
const PAYMENT_METHODS = ["Cash", "InstaPay", "Wallet", "Visa"];

export default function PatientProfilePage() {
  const { id } = useParams();
  const router = useRouter();
  const [patient, setPatient] = useState(null);
  const [visits, setVisits] = useState([]);
  const [credentials, setCredentials] = useState(null);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showAddScan, setShowAddScan] = useState(false);
  const [editingVisit, setEditingVisit] = useState(null);
  const [payingVisitId, setPayingVisitId] = useState(null);
  const [paymentForm, setPaymentForm] = useState({ amount: "", method: "Cash" });
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [whatsAppPicker, setWhatsAppPicker] = useState(false);
  const [employees, setEmployees] = useState([]);
  const { profile, isAdmin } = usePermissions();
  const [editingInfo, setEditingInfo] = useState(false);
  const [infoDraft, setInfoDraft] = useState({ name: "", mobile: "", email: "", dob: "" });
  const [infoError, setInfoError] = useState("");
  const [savingInfo, setSavingInfo] = useState(false);

  useEffect(() => {
    load();
    loadFiles();
    loadEmployees();
  }, [id]);

  function startEditInfo() {
    setInfoDraft({
      name: patient.name || "",
      mobile: patient.mobile || "",
      email: patient.email || "",
      dob: patient.dob || "",
    });
    setInfoError("");
    setEditingInfo(true);
  }

  async function handleSaveInfo() {
    if (!infoDraft.name || !infoDraft.mobile) {
      setInfoError("Name and mobile number are required.");
      return;
    }
    setSavingInfo(true);
    const { error } = await supabase
      .from("patients")
      .update({
        name: infoDraft.name,
        mobile: formatPhone(infoDraft.mobile),
        email: infoDraft.email || null,
        dob: infoDraft.dob || null,
      })
      .eq("id", id);
    setSavingInfo(false);
    if (error) {
      setInfoError(error.message);
      return;
    }
    logActivity({
      actorId: profile?.id,
      actorName: profile?.name,
      actorType: "admin",
      action: "edited_patient",
      entityType: "patient",
      entityId: id,
      details: { name: infoDraft.name },
    });
    setEditingInfo(false);
    load();
  }

  async function logPayment(visit) {
    const amount = Number(paymentForm.amount);
    if (!amount || amount <= 0) {
      setPaymentError("Enter an amount greater than zero.");
      return;
    }
    setPaymentSaving(true);
    setPaymentError("");
    const { error: err } = await supabase.from("visit_payments").insert({
      visit_id: visit.id,
      amount,
      payment_method: paymentForm.method,
      created_by_id: profile?.id || null,
      created_by_name: profile?.name || null,
    });
    setPaymentSaving(false);
    if (err) {
      setPaymentError(err.message);
      return;
    }
    setPayingVisitId(null);
    setPaymentForm({ amount: "", method: "Cash" });
    load();
  }

  async function loadEmployees() {
    const { data } = await supabase.from("employees").select("id, name").eq("is_active", true).order("name");
    setEmployees(data || []);
  }

  async function loadFiles() {
    const res = await fetch(`/api/drive/list?patientId=${id}`);
    const data = await res.json();
    setFiles(data.files || []);
  }

  const [pendingFile, setPendingFile] = useState(null);

  function handleFilePicked(e) {
    const file = e.target.files[0];
    if (!file) return;
    setPendingFile(file);
    e.target.value = ""; // allow picking the same file again later
  }

  async function handleFileUpload(fileType) {
    const file = pendingFile;
    if (!file) return;
    setPendingFile(null);
    setUploading(true);
    setUploadProgress(0);
    const { data: session } = await supabase.auth.getSession();
    const uploaderEmail = session.session?.user?.email || null;
    const { data: profile } = uploaderEmail
      ? await supabase.from("staff_profiles").select("name").eq("email", uploaderEmail).maybeSingle()
      : { data: null };

    try {
      const fileId = await uploadFileToDrive({
        file,
        initEndpoint: "/api/drive/upload-session",
        initBody: { patientId: id, filename: file.name, mimeType: file.type },
        onProgress: (frac) => setUploadProgress(Math.round(frac * 100)),
      });

      const res = await fetch("/api/drive/upload-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId,
          patientId: id,
          filename: file.name,
          fileType,
          uploaderEmail,
          uploaderName: profile?.name || uploaderEmail,
        }),
      });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
      } else {
        logActivity({
          actorId: profile?.id,
          actorName: profile?.name,
          actorType: profile?.role === "admin" ? "admin" : "employee",
          action: `uploaded_${fileType}`,
          entityType: "patient_file",
          entityId: data.id || null,
          details: { patientId: id, patientName: patient?.name, fileName: file.name },
        });
        await loadFiles();
        await load();
      }
    } catch (e) {
      alert(e.message || "Upload failed");
    }
    setUploading(false);
    setUploadProgress(0);
  }

  async function load() {
    setLoading(true);
    const { data: p } = await supabase.from("patients").select("*").eq("id", id).single();
    const { data: v } = await supabase
      .from("visits")
      .select("id, scan_types, exam_date, payment_status, branch_id, doctor_id, amount_due, amount_paid, scanned, raw_data_uploaded, report_done, paid_at, scanned_at, raw_data_uploaded_at, report_done_at, scanned_by_name, raw_data_uploaded_by_name, report_done_by_name, assigned_employee_id, assigned_at, doctors(name, phone, phone_2, email, clinic_code), branches(name), invoices(id), employees!visits_assigned_employee_id_fkey(name), visit_payments(payment_method)")
      .eq("patient_id", id)
      .order("exam_date", { ascending: false });
    const { data: auth } = await supabase.from("patient_auth").select("username").eq("patient_id", id).maybeSingle();
    setPatient(p);
    setVisits(v || []);
    setCredentials(auth);
    setLoading(false);
  }

  async function generateNewPassword() {
    // If this patient already has a username, reuse it - regenerating a
    // password should never change who they log in as. Only when there is
    // no existing username yet do we need to pick one, and since phone
    // numbers aren't guaranteed unique (family members share a number), that
    // pick has to go through the same collision check every other credential
    // creation path in this app already uses - skipping it here was exactly
    // what caused "could not generate credentials" for a patient who shared
    // a phone with someone who'd already claimed that username.
    const baseUsername = credentials?.username || patient.mobile.replace(/\D/g, "");
    const username = credentials?.username
      ? baseUsername
      : await resolvePatientUsername(baseUsername, id);
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
      doctorPhone2: visit.doctors?.phone_2,
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

  async function sendPatientWhatsApp(visit, type) {
    const { data: session } = await supabase.auth.getUser();
    let text, link;
    const scanTypes = (visit.scan_types || []).join(", ");

    if (type === "greeting") {
      return handleCustomerWhatsApp();
    } else if (type === "report") {
      text = buildPatientReportMessage({ patientName: patient.name, scanTypes, examDate: visit.exam_date });
      link = patientReportWhatsAppLink({ mobile: patient.mobile, patientName: patient.name, scanTypes, examDate: visit.exam_date });
    } else if (type === "invoice") {
      let amount = visit.amount_due;
      let invoiceNumber = null;
      if (visit.invoices?.[0]?.id) {
        const { data: inv } = await supabase.from("invoices").select("invoice_number, amount").eq("id", visit.invoices[0].id).maybeSingle();
        if (inv) {
          amount = inv.amount;
          invoiceNumber = inv.invoice_number;
        }
      }
      text = buildPatientInvoiceMessage({ patientName: patient.name, invoiceNumber, amount });
      link = patientInvoiceWhatsAppLink({ mobile: patient.mobile, patientName: patient.name, invoiceNumber, amount });
    } else if (type === "raw_data") {
      text = buildPatientRawDataMessage({ patientName: patient.name, scanTypes, examDate: visit.exam_date });
      link = patientRawDataWhatsAppLink({ mobile: patient.mobile, patientName: patient.name, scanTypes, examDate: visit.exam_date });
    } else {
      // Direct - no pre-filled text, just opens a chat with the patient.
      link = directWhatsAppLink(patient.mobile);
    }

    if (text) {
      await supabase.from("whatsapp_log").insert({
        visit_id: visit.id,
        message_type: `patient_${type}`,
        rendered_text: text,
        sent_at: new Date().toISOString(),
        sent_by: session?.user?.id || null,
      });
    }
    window.open(link, "_blank");
  }

  async function handleDeleteVisit(visit) {
    const hasPaid = visit.payment_status === "paid" || visit.payment_status === "partial";
    const warning = hasPaid
      ? `Delete this visit (${(visit.scan_types || []).join(", ")}, ${visit.exam_date})? It has a logged payment - deleting it also removes that payment, its cash-ledger entry where it can be found, and any invoice. This can't be undone.`
      : `Delete this visit (${(visit.scan_types || []).join(", ")}, ${visit.exam_date})? This can't be undone.`;
    if (!confirm(warning)) return;
    const { data: session } = await supabase.auth.getSession();
    const res = await fetch(`/api/visits/${visit.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.session?.access_token}` },
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Could not delete this visit.");
      return;
    }
    if (data.expenseEntriesLeftForReview > 0) {
      alert(
        `Visit deleted. ${data.expenseEntriesRemoved} matching cash-ledger entry(ies) were also removed, but ${data.expenseEntriesLeftForReview} payment(s) had more than one possible matching ledger entry, so none were touched - review Expenses Management manually for those.`
      );
    }
    await syncPatientLastVisitDate(supabase, patient.id);
    load();
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
    logActivity({
      actorId: profile?.id,
      actorName: profile?.name,
      actorType: profile?.role === "admin" ? "admin" : "employee",
      action: "generated_invoice",
      entityType: "invoice",
      entityId: inv.id,
      details: { patientId: id, patientName: patient?.name, visitId: visit.id, amount: visit.amount_due },
    });
    router.push(`/dashboard/invoices/${inv.id}`);
  }

  async function toggleStage(visit, field) {
    const newValue = !visit[field];
    const tsField = `${field}_at`;
    const byField = `${field}_by_name`;
    // Only marking on records who did it - unmarking clears the stamp along
    // with the timestamp, since it no longer reflects the visit's current
    // state and shouldn't be shown as if it still does.
    const update = {
      [field]: newValue,
      [tsField]: newValue ? new Date().toISOString() : null,
      [byField]: newValue ? profile?.name || null : null,
    };
    await supabase.from("visits").update(update).eq("id", visit.id);
    setVisits((prev) => prev.map((v) => (v.id === visit.id ? { ...v, ...update } : v)));
    logActivity({
      actorId: profile?.id,
      actorName: profile?.name,
      actorType: profile?.role === "admin" ? "admin" : "employee",
      action: newValue ? `marked_${field}` : `unmarked_${field}`,
      entityType: "visit",
      entityId: visit.id,
      details: { patientId: id, patientName: patient?.name },
    });
  }

  async function reassignEmployee(visit, employeeId) {
    const update = { assigned_employee_id: employeeId || null, assigned_at: employeeId ? new Date().toISOString() : null };
    await supabase.from("visits").update(update).eq("id", visit.id);
    const emp = employees.find((e) => e.id === employeeId);
    setVisits((prev) => prev.map((v) => (v.id === visit.id ? { ...v, ...update, employees: emp ? { name: emp.name } : null } : v)));
    logActivity({
      actorId: profile?.id,
      actorName: profile?.name,
      actorType: profile?.role === "admin" ? "admin" : "employee",
      action: "reassigned_scan",
      entityType: "visit",
      entityId: visit.id,
      details: { patientId: id, patientName: patient?.name, assignedTo: emp?.name || null },
    });
  }

  if (loading) return <p style={{ color: theme.gray }}>Loading...</p>;
  if (!patient) return <p style={{ color: theme.gray }}>Patient not found.</p>;

  return (
    <div>
      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginBottom: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        {!editingInfo ? (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ color: theme.navy, margin: 0 }}>{patient.name}</h1>
            <p style={{ color: theme.gray, margin: "4px 0" }}>
              {formatPhone(patient.mobile)}
              {patient.dob && ` · ${new Date(patient.dob).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`}
              {patient.email && ` · ${patient.email}`}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
          {isAdmin && (
            <button onClick={startEditInfo} style={{ padding: "10px 18px", borderRadius: 8, border: `1px solid ${theme.navy}`, background: "#fff", color: theme.navy, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
              Edit
            </button>
          )}
          {isAdmin && (
            <DeleteEntityButton
              entityLabel="patient"
              entityName={patient.name}
              onDelete={async () => {
                const { error } = await supabase.from("patients").delete().eq("id", id);
                if (error) throw error;
                logActivity({
                  actorId: profile?.id,
                  actorName: profile?.name,
                  actorType: "admin",
                  action: "deleted_patient",
                  entityType: "patient",
                  entityId: id,
                  details: { name: patient.name, mobile: patient.mobile },
                });
              }}
              onDeleted={() => router.push("/dashboard/patients")}
            />
          )}
          </div>
        </div>
        ) : (
        <div>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Edit Patient Info</h3>
          <p style={{ fontSize: 11, color: theme.gray, marginTop: -8, marginBottom: 16 }}>Admin only.</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={editLabel}>Name</label>
              <input style={editInp} value={infoDraft.name} onChange={(e) => setInfoDraft({ ...infoDraft, name: e.target.value })} />
            </div>
            <div>
              <label style={editLabel}>Mobile</label>
              <input style={editInp} value={infoDraft.mobile} onChange={(e) => setInfoDraft({ ...infoDraft, mobile: e.target.value })} placeholder="+20 1X XXX XXXX" />
            </div>
            <div>
              <label style={editLabel}>Date of Birth</label>
              <input type="date" style={editInp} value={infoDraft.dob} onChange={(e) => setInfoDraft({ ...infoDraft, dob: e.target.value })} />
            </div>
            <div>
              <label style={editLabel}>Email</label>
              <input style={editInp} value={infoDraft.email} onChange={(e) => setInfoDraft({ ...infoDraft, email: e.target.value })} />
            </div>
          </div>
          {infoError && <p style={{ color: "#ba1a1a", fontSize: 13, marginTop: 8 }}>{infoError}</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button onClick={() => setEditingInfo(false)} style={{ padding: "10px 18px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontWeight: 600, cursor: "pointer" }}>
              Cancel
            </button>
            <button onClick={handleSaveInfo} disabled={savingInfo} style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
              {savingInfo ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
        )}
      </div>

      <PortalAccessCard
        hasAccount={!!credentials}
        username={credentials?.username}
        defaultUsername={(patient.mobile || "").replace(/\D/g, "")}
        onGenerate={async (username) => {
          const unique = await resolvePatientUsername(username, id);
          const { data } = await supabase.rpc("create_patient_credentials", { p_patient_id: id, p_username: unique });
          setCredentials({ username: unique });
          return data;
        }}
        buildWhatsAppLink={(username, password) =>
          customerWhatsAppLink({
            mobile: patient.mobile,
            patientName: patient.name,
            portalUrl: `${window.location.origin.replace("/dashboard", "")}/portal`,
            username,
            password,
          })
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 24 }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <h3 style={{ color: theme.navy, margin: 0 }}>Visit History</h3>
            <button onClick={() => setShowAddScan(true)} style={{ ...smallBtn, background: theme.gold, color: theme.navy, fontWeight: 700, border: "none" }}>
              + Add New Scan
            </button>
          </div>
          <p style={{ fontSize: 11, color: theme.gray, marginTop: 0, marginBottom: 12 }}>{visits.length} scan{visits.length === 1 ? "" : "s"} on record for this patient</p>
          {visits.length === 0 && <p style={{ color: theme.gray, fontSize: 14 }}>No visits yet.</p>}
          {visits.map((v) => (
            <div key={v.id} style={{ borderBottom: "1px solid #f0f0f0", padding: "12px 0" }}>
              <div style={{ fontWeight: 600, color: theme.navy }}>{(v.scan_types || []).join(", ")}</div>
              <div style={{ fontSize: 12, color: theme.gray }}>
                {v.exam_date} · {v.branches?.name || "—"} · {v.payment_status}
                {v.payment_status === "partial" && v.amount_due != null && (
                  <span style={{ color: "#b45309", fontWeight: 700 }}> · Pending: {(Number(v.amount_due) - Number(v.amount_paid || 0)).toFixed(2)} EGP</span>
                )}
              </div>
              {Number(v.amount_paid) > 0 && (
                <div style={{ fontSize: 12, color: theme.gray, marginTop: 2 }}>
                  Paid: {Number(v.amount_paid).toFixed(2)} EGP
                  {(v.visit_payments || []).length > 0 && (
                    <> · {[...new Set((v.visit_payments || []).map((p) => p.payment_method))].join(" + ")}</>
                  )}
                </div>
              )}
              {v.doctor_id && (
                <div style={{ fontSize: 12, color: theme.gray, marginTop: 2 }}>
                  {v.doctors?.clinic_code && <>Clinic Code: {v.doctors.clinic_code} · </>}
                  Referred by: Dr {v.doctors?.name || "—"}
                </div>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                <StageChip label="Paid" active={v.payment_status === "paid"} timestamp={v.paid_at} />
                <StageChip
                  label="Scanned"
                  active={v.scanned}
                  timestamp={v.scanned_at}
                  byName={v.scanned_by_name}
                  onClick={() => toggleStage(v, "scanned")}
                />
                <StageChip
                  label="Raw Data Uploaded"
                  active={v.raw_data_uploaded}
                  timestamp={v.raw_data_uploaded_at}
                  byName={v.raw_data_uploaded_by_name}
                  onClick={() => toggleStage(v, "raw_data_uploaded")}
                />
                <StageChip
                  label="Report Done"
                  active={v.report_done}
                  timestamp={v.report_done_at}
                  byName={v.report_done_by_name}
                  onClick={() => toggleStage(v, "report_done")}
                />
                <StageChip label="Invoice Generated" active={(v.invoices || []).length > 0} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                <span style={{ fontSize: 11, color: theme.gray, fontWeight: 600 }}>Assigned to:</span>
                {isAdmin ? (
                  <select
                    value={v.assigned_employee_id || ""}
                    onChange={(e) => reassignEmployee(v, e.target.value)}
                    style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #ddd", color: theme.navy }}
                  >
                    <option value="">Unassigned</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>{emp.name}</option>
                    ))}
                  </select>
                ) : (
                  <span style={{ fontSize: 12, color: theme.navy, fontWeight: 600 }}>{v.employees?.name || "Unassigned"}</span>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                <button onClick={() => handleScanWhatsApp(v)} style={smallBtn}>Send Scan WhatsApp</button>
                <button onClick={() => handleGenerateInvoice(v)} style={smallBtn}>Generate Invoice</button>
                <button onClick={() => setEditingVisit(v)} style={smallBtn}>Edit Visit</button>
                {isAdmin && (
                  <button onClick={() => handleDeleteVisit(v)} style={{ ...smallBtn, color: "#ba1a1a", borderColor: "#ba1a1a" }}>
                    Delete Visit
                  </button>
                )}
                <WhatsAppDropdown
                  buttonStyle={smallBtn}
                  options={[
                    { label: "Greeting", onClick: () => sendPatientWhatsApp(v, "greeting") },
                    { label: "Report", onClick: () => sendPatientWhatsApp(v, "report") },
                    { label: "Invoice", onClick: () => sendPatientWhatsApp(v, "invoice") },
                    { label: "Raw Data", onClick: () => sendPatientWhatsApp(v, "raw_data") },
                    { label: "Direct (empty)", onClick: () => sendPatientWhatsApp(v, "direct") },
                  ]}
                />
                {v.payment_status !== "paid" && (
                  <button
                    onClick={() => {
                      setPayingVisitId(payingVisitId === v.id ? null : v.id);
                      setPaymentError("");
                    }}
                    style={{ ...smallBtn, background: theme.gold, color: theme.navy, fontWeight: 700, border: "none" }}
                  >
                    Log Payment
                  </button>
                )}
              </div>
              {payingVisitId === v.id && (
                <div style={{ background: "#faf9fb", borderRadius: 10, padding: 12, marginTop: 10, display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#48464E", fontWeight: 600, marginBottom: 3 }}>Amount</div>
                    <input
                      value={paymentForm.amount}
                      onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                      placeholder="0.00"
                      style={{ width: 100, padding: "7px 8px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#48464E", fontWeight: 600, marginBottom: 3 }}>Method</div>
                    <select
                      value={paymentForm.method}
                      onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}
                      style={{ padding: "7px 8px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }}
                    >
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                  <button onClick={() => logPayment(v)} disabled={paymentSaving} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
                    {paymentSaving ? "Saving..." : "Confirm"}
                  </button>
                  {paymentError && <p style={{ color: "#ba1a1a", fontSize: 12, width: "100%", margin: 0 }}>{paymentError}</p>}
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Quick Actions</h3>
          <button onClick={handleCustomerWhatsApp} style={actionBtn}>Send Customer WhatsApp</button>
          {visits.length > 0 && (
            <button onClick={() => setWhatsAppPicker(true)} style={{ ...actionBtn, background: "#fff", color: theme.navy, border: `1px solid ${theme.navy}` }}>
              Send Scan WhatsApp{visits.length > 1 ? " (choose scan)" : ""}
            </button>
          )}
          <label style={{ ...actionBtn, display: "block", textAlign: "center", opacity: uploading ? 0.6 : 1, background: theme.gold, color: theme.navy, position: "relative", overflow: "hidden" }}>
            {uploading && (
              <div style={{ position: "absolute", inset: 0, left: 0, width: `${uploadProgress}%`, background: "rgba(255,255,255,0.35)", transition: "width 0.15s linear" }} />
            )}
            <span style={{ position: "relative" }}>{uploading ? `Uploading... ${uploadProgress}%` : "Upload Scan Files"}</span>
            <input type="file" onChange={handleFilePicked} disabled={uploading} style={{ display: "none" }} />
          </label>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: 12 }}>
            Files upload directly into this patient's Drive folder, nested under their referring doctor automatically if one is assigned.
          </p>
        </div>
      </div>

      {whatsAppPicker && (
        <ScanPickerModal
          visits={visits}
          onClose={() => setWhatsAppPicker(false)}
          onPick={(v) => {
            setWhatsAppPicker(false);
            handleScanWhatsApp(v);
          }}
        />
      )}

      {showAddScan && (
        <AddScanModal
          patient={patient}
          onClose={() => setShowAddScan(false)}
          onSaved={() => {
            setShowAddScan(false);
            load();
          }}
        />
      )}

      {editingVisit && (
        <EditVisitModal
          visit={editingVisit}
          isAdmin={isAdmin}
          onClose={() => setEditingVisit(null)}
          onSaved={() => {
            setEditingVisit(null);
            load();
          }}
        />
      )}

      {pendingFile && (
        <FileTypeModal
          fileName={pendingFile.name}
          onClose={() => setPendingFile(null)}
          onPick={(type) => handleFileUpload(type)}
        />
      )}

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Patient Files</h3>
        {files.length === 0 && <p style={{ color: theme.gray, fontSize: 14 }}>No files uploaded yet.</p>}
        {(() => {
          // Reorganized patients have files tagged with which visit subfolder they
          // came from (groupLabel like "2026-08-18__e8345e4c") - render those under
          // a readable visit heading. Ungrouped (groupLabel null) files - patients
          // not yet reorganized - render in the original flat grid, unchanged.
          const ungrouped = files.filter((f) => !f.groupLabel);
          const groups = {};
          for (const f of files) {
            if (f.groupLabel) (groups[f.groupLabel] = groups[f.groupLabel] || []).push(f);
          }
          const FileGrid = ({ items }) => (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
              {items.map((f) => (
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
          );
          return (
            <>
              {ungrouped.length > 0 && <FileGrid items={ungrouped} />}
              {Object.entries(groups).map(([label, items]) => {
                const dateStr = label.split("__")[0];
                const niceDate = /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
                  ? new Date(dateStr).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
                  : label;
                return (
                  <div key={label} style={{ marginTop: ungrouped.length > 0 || label !== Object.keys(groups)[0] ? 20 : 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: theme.gray, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      Visit — {niceDate}
                    </div>
                    <FileGrid items={items} />
                  </div>
                );
              })}
            </>
          );
        })()}
      </div>
    </div>
  );
}

function FileTypeModal({ fileName, onClose, onPick }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,11,56,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70, padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 26, width: 340 }}>
        <h3 style={{ margin: "0 0 4px", color: theme.navy, fontSize: 16 }}>What is this file?</h3>
        <p style={{ fontSize: 12, color: theme.gray, marginTop: 0, marginBottom: 16, wordBreak: "break-all" }}>{fileName}</p>
        <div style={{ display: "grid", gap: 8 }}>
          <button onClick={() => onPick("raw_data")} style={{ ...actionBtn, background: theme.gold, color: theme.navy, textAlign: "left" }}>
            Raw Scan Data <span style={{ fontWeight: 400, fontSize: 11 }}>— marks "Raw Data Uploaded"</span>
          </button>
          <button onClick={() => onPick("report")} style={{ ...actionBtn, background: theme.navy, color: "#fff", textAlign: "left" }}>
            Report <span style={{ fontWeight: 400, fontSize: 11 }}>— marks "Report Done"</span>
          </button>
          <button onClick={() => onPick("other")} style={{ ...actionBtn, background: "#fff", color: theme.navy, border: "1px solid #ddd", textAlign: "left" }}>
            Other <span style={{ fontWeight: 400, fontSize: 11 }}>— no status change</span>
          </button>
        </div>
        <button onClick={onClose} style={{ marginTop: 12, background: "none", border: "none", color: theme.gray, fontSize: 12, cursor: "pointer" }}>Cancel</button>
      </div>
    </div>
  );
}

function ScanPickerModal({ visits, onClose, onPick }) {
  return (
    <Modal title="Which scan is this message about?" onClose={onClose}>
      <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 14 }}>
        This patient has {visits.length} scan{visits.length === 1 ? "" : "s"} on record. Pick the one to reference.
      </p>
      <div style={{ display: "grid", gap: 8, maxHeight: 320, overflowY: "auto" }}>
        {visits.map((v) => (
          <button
            key={v.id}
            onClick={() => onPick(v)}
            style={{
              textAlign: "left",
              padding: 12,
              borderRadius: 8,
              border: "1px solid #eee",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            <div style={{ fontWeight: 700, color: theme.navy, fontSize: 13 }}>{(v.scan_types || []).join(", ") || "—"}</div>
            <div style={{ fontSize: 11, color: theme.gray, marginTop: 2 }}>
              {v.exam_date || "no date"} · {v.doctors?.name || "Walk-in"} · {v.payment_status}
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function AddScanModal({ patient, onClose, onSaved }) {
  const { profile } = usePermissions();
  const [branches, setBranches] = useState([]);
  const [examTypes, setExamTypes] = useState([]);
  const [doctorQuery, setDoctorQuery] = useState("");
  const [doctorResults, setDoctorResults] = useState([]);
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [walkIn, setWalkIn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    branch_id: "",
    scan_type_ids: [],
    discount_on: false,
    discount_pct: 0,
    discount_reason: "",
    discount_reason_other: "",
    payment_method: "Cash",
    amount_paid: "",
    notes: "",
  });

  useEffect(() => {
    supabase.from("branches").select("id, name").eq("is_active", true).then(({ data }) => setBranches(data || []));
    supabase.from("exam_types").select("id, name, price, category").eq("is_active", true).order("name").then(({ data }) => setExamTypes(data || []));
  }, []);

  useEffect(() => {
    if (!doctorQuery) {
      setDoctorResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("doctors")
        .select("id, name, clinic_name, clinic_code, discount_pct, special_note")
        .or(`name.ilike.%${doctorQuery}%,clinic_code.ilike.%${doctorQuery}%`)
        .limit(8);
      setDoctorResults(data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [doctorQuery]);

  function toggleScan(id) {
    setForm((f) => ({
      ...f,
      scan_type_ids: f.scan_type_ids.includes(id) ? f.scan_type_ids.filter((x) => x !== id) : [...f.scan_type_ids, id],
    }));
  }

  function selectDoctor(d) {
    setSelectedDoctor(d);
    setDoctorResults([]);
    setForm((f) => ({
      ...f,
      discount_on: true,
      discount_pct: 20,
      discount_reason: "Referred Patient",
      notes: d.special_note ? (f.notes ? f.notes + " | " + d.special_note : d.special_note) : f.notes,
    }));
  }

  const selectedExams = examTypes.filter((e) => form.scan_type_ids.includes(e.id));
  const sumBeforeDiscount = selectedExams.reduce((s, e) => s + (Number(e.price) || 0), 0);
  const discountPct = form.discount_on ? Number(form.discount_pct) || 0 : 0;
  const discountAmount = sumBeforeDiscount * (discountPct / 100);
  const sumAfterDiscount = sumBeforeDiscount - discountAmount;
  const alreadyPaid = Number(visit.amount_paid) || 0;
  // Reflects the amount due as it stands with whatever's currently selected
  // in this form (scan types, discount), not the visit's stored amount_due -
  // if those are being changed in this same edit, "remaining" should answer
  // "remaining after this edit goes through", not the pre-edit number.
  const projectedNewPayment = Number(form.new_payment_amount) || 0;
  const remainingForSettlement = sumAfterDiscount - alreadyPaid - projectedNewPayment;

  const examsByCategory = CATEGORY_ORDER.map((cat) => ({
    key: cat,
    label: CATEGORY_LABELS[cat],
    items: examTypes.filter((e) => (e.category || "misc") === cat),
  })).filter((c) => c.items.length > 0);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!walkIn && !selectedDoctor) {
      setError('Select a referring doctor, or check "Walk-in, no referring doctor."');
      return;
    }
    if (form.scan_type_ids.length === 0) {
      setError("Select at least one scan type.");
      return;
    }
    setSaving(true);
    const scanNames = selectedExams.map((e) => e.name);
    const finalReason = form.discount_reason === "Other" ? form.discount_reason_other : form.discount_reason;

    const { data: newVisit, error: vErr } = await supabase
      .from("visits")
      .insert({
        patient_id: patient.id,
        doctor_id: walkIn ? null : selectedDoctor?.id,
        branch_id: form.branch_id || null,
        scan_types: scanNames,
        amount_due: sumAfterDiscount || null,
        discount_pct: discountPct,
        discount_reason: form.discount_on ? finalReason : null,
        notes: form.notes || null,
      })
      .select("id")
      .single();

    if (vErr) {
      setSaving(false);
      setError(vErr.message);
      return;
    }

    await syncPatientLastVisitDate(supabase, patient.id);

    // amount_paid/payment_status are no longer set directly - logging a payment
    // split here (if any amount was entered) lets the database trigger compute
    // them, the same source of truth used for every future payment on this visit.
    const paidNow = Number(form.amount_paid) || 0;
    if (paidNow > 0) {
      const { error: pErr } = await supabase.from("visit_payments").insert({
        visit_id: newVisit.id,
        amount: paidNow,
        payment_method: form.payment_method,
        created_by_id: profile?.id || null,
        created_by_name: profile?.name || null,
      });
      if (pErr) {
        setSaving(false);
        setError(`Scan was created, but recording the payment failed: ${pErr.message}`);
        return;
      }
    }

    setSaving(false);
    onSaved();
  }

  return (
    <Modal title={`Add New Scan — ${patient.name}`} onClose={onClose} wide>
      <form onSubmit={handleSubmit}>
        <FieldLabel>Visit Date</FieldLabel>
        <input
          type="date"
          style={inp}
          value={form.exam_date}
          onChange={(e) => setForm({ ...form, exam_date: e.target.value })}
        />

        <FieldLabel>Branch</FieldLabel>
        <select style={inp} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
          <option value="">Select branch</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>

        <FieldLabel>Scan Type (select multiple)</FieldLabel>
        {examsByCategory.map((cat) => (
          <div key={cat.key} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: theme.gold, marginBottom: 5 }}>{cat.label}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {cat.items.map((ex) => {
                const active = form.scan_type_ids.includes(ex.id);
                return (
                  <button
                    type="button"
                    key={ex.id}
                    onClick={() => toggleScan(ex.id)}
                    style={{
                      padding: "5px 10px",
                      borderRadius: 999,
                      fontSize: 11,
                      border: `1px solid ${active ? theme.gold : "#ddd"}`,
                      background: active ? theme.goldLight : "#fff",
                      color: theme.navy,
                      cursor: "pointer",
                    }}
                  >
                    {ex.name} {ex.price ? `— ${formatMoney(ex.price)} EGP` : ""}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <FieldLabel>Referring Doctor</FieldLabel>
        <input
          style={inp}
          disabled={walkIn}
          value={selectedDoctor ? `${selectedDoctor.name} (${selectedDoctor.clinic_code})` : doctorQuery}
          onChange={(e) => {
            setSelectedDoctor(null);
            setDoctorQuery(e.target.value);
          }}
          placeholder="Search doctor by name or clinic code..."
        />
        {doctorResults.length > 0 && !selectedDoctor && (
          <div style={{ border: "1px solid #eee", borderRadius: 8, marginTop: 4, marginBottom: 8 }}>
            {doctorResults.map((d) => (
              <div key={d.id} onClick={() => selectDoctor(d)} style={{ padding: 8, cursor: "pointer", fontSize: 12 }}>
                {d.name} — {d.clinic_name} ({d.clinic_code})
              </div>
            ))}
          </div>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, margin: "8px 0 16px" }}>
          <input type="checkbox" checked={walkIn} onChange={(e) => { setWalkIn(e.target.checked); setSelectedDoctor(null); }} />
          Walk-in (no referring doctor)
        </label>

        <div style={{ background: "#faf9fb", borderRadius: 10, padding: 12, marginBottom: 14 }}>
          <TotalRow label="Sum Before Discount" value={sumBeforeDiscount} />
          {discountPct > 0 && <TotalRow label={`Discount (${discountPct}%)`} value={-discountAmount} negative />}
          <TotalRow label="Amount Due" value={sumAfterDiscount} bold />
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginBottom: 10 }}>
          <input type="checkbox" checked={form.discount_on} onChange={(e) => setForm({ ...form, discount_on: e.target.checked })} />
          Apply Discount
        </label>
        {form.discount_on && (
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <FieldLabel>Discount %</FieldLabel>
              <input
                type="number"
                style={inp}
                value={form.discount_pct}
                onChange={(e) => {
                  const val = e.target.value;
                  const overCap = Number(val) > 20 && form.discount_reason === "Referred Patient";
                  setForm({ ...form, discount_pct: val, discount_reason: overCap ? "" : form.discount_reason });
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <FieldLabel>Reason</FieldLabel>
              <select style={inp} value={form.discount_reason} onChange={(e) => setForm({ ...form, discount_reason: e.target.value })}>
                <option value="">Select...</option>
                {DISCOUNT_REASONS.map((r) => (
                  <option key={r} value={r} disabled={r === "Referred Patient" && Number(form.discount_pct) > 20}>
                    {r}{r === "Referred Patient" && Number(form.discount_pct) > 20 ? " (max 20%)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <FieldLabel>Payment Method</FieldLabel>
            <select style={inp} value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <FieldLabel>Amount Paid</FieldLabel>
            <input style={inp} value={form.amount_paid} onChange={(e) => setForm({ ...form, amount_paid: e.target.value })} placeholder="0.00" />
          </div>
        </div>
        <p style={{ fontSize: 11, color: theme.gray, margin: "4px 0 0" }}>
          Payment status is set automatically from the amount entered above compared to the total due - no need to pick it manually.
        </p>

        {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}
        <button type="submit" disabled={saving} style={{ ...actionBtn, marginTop: 6 }}>
          {saving ? "Saving..." : "Add Scan"}
        </button>
      </form>
    </Modal>
  );
}

function EditVisitModal({ visit, isAdmin, onClose, onSaved }) {
  const { profile } = usePermissions();
  const [branches, setBranches] = useState([]);
  const [examTypes, setExamTypes] = useState([]);
  const [doctorQuery, setDoctorQuery] = useState("");
  const [doctorResults, setDoctorResults] = useState([]);
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [walkIn, setWalkIn] = useState(!visit.doctor_id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const [form, setForm] = useState({
    exam_date: visit.exam_date || "",
    branch_id: visit.branch_id || "",
    scan_type_ids: [],
    discount_on: Number(visit.discount_pct) > 0,
    discount_pct: visit.discount_pct || 0,
    discount_reason: visit.discount_reason || "",
    discount_reason_other: "",
    notes: visit.notes || "",
    // New money coming in now (e.g. settling the remaining balance on a
    // partially-paid visit) is captured separately from every other field
    // here - it isn't a correction to the visit record itself, it's a new
    // payment event, and needs to be logged as its own visit_payments row
    // dated today rather than baked into the visit's stored totals.
    new_payment_amount: "",
    new_payment_method: "Cash",
  });

  useEffect(() => {
    async function init() {
      const [{ data: b }, { data: e }] = await Promise.all([
        supabase.from("branches").select("id, name").eq("is_active", true),
        supabase.from("exam_types").select("id, name, price, category").eq("is_active", true).order("name"),
      ]);
      setBranches(b || []);
      setExamTypes(e || []);
      // Match the visit's existing scan_types (stored as name strings) back to
      // exam_type ids, so the same checkboxes used at creation time can show
      // which ones are currently selected on this visit.
      const currentNames = new Set(visit.scan_types || []);
      const matchedIds = (e || []).filter((ex) => currentNames.has(ex.name)).map((ex) => ex.id);
      setForm((f) => ({ ...f, scan_type_ids: matchedIds }));

      if (visit.doctor_id) {
        const { data: d } = await supabase
          .from("doctors")
          .select("id, name, clinic_name, clinic_code, discount_pct, special_note")
          .eq("id", visit.doctor_id)
          .maybeSingle();
        if (d) setSelectedDoctor(d);
      }
      setLoaded(true);
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!doctorQuery) {
      setDoctorResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("doctors")
        .select("id, name, clinic_name, clinic_code, discount_pct, special_note")
        .or(`name.ilike.%${doctorQuery}%,clinic_code.ilike.%${doctorQuery}%`)
        .limit(8);
      setDoctorResults(data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [doctorQuery]);

  function toggleScan(id) {
    setForm((f) => ({
      ...f,
      scan_type_ids: f.scan_type_ids.includes(id) ? f.scan_type_ids.filter((x) => x !== id) : [...f.scan_type_ids, id],
    }));
  }

  function selectDoctor(d) {
    setSelectedDoctor(d);
    setDoctorResults([]);
    setForm((f) => ({ ...f, discount_on: true, discount_pct: 20, discount_reason: "Referred Patient" }));
  }

  const selectedExams = examTypes.filter((e) => form.scan_type_ids.includes(e.id));
  const sumBeforeDiscount = selectedExams.reduce((s, e) => s + (Number(e.price) || 0), 0);
  const discountPct = form.discount_on ? Number(form.discount_pct) || 0 : 0;
  const discountAmount = sumBeforeDiscount * (discountPct / 100);
  const sumAfterDiscount = sumBeforeDiscount - discountAmount;
  const alreadyPaid = Number(visit.amount_paid) || 0;
  // Reflects the amount due as it stands with whatever's currently selected
  // in this form (scan types, discount), not the visit's stored amount_due -
  // if those are being changed in this same edit, "remaining" should answer
  // "remaining after this edit goes through", not the pre-edit number.
  const projectedNewPayment = Number(form.new_payment_amount) || 0;
  const remainingForSettlement = sumAfterDiscount - alreadyPaid - projectedNewPayment;

  const examsByCategory = CATEGORY_ORDER.map((cat) => ({
    key: cat,
    label: CATEGORY_LABELS[cat],
    items: examTypes.filter((e) => (e.category || "misc") === cat),
  })).filter((c) => c.items.length > 0);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!walkIn && !selectedDoctor) {
      setError('Select a referring doctor, or check "Walk-in, no referring doctor."');
      return;
    }
    if (form.scan_type_ids.length === 0) {
      setError("Select at least one scan type.");
      return;
    }
    setSaving(true);
    const scanNames = selectedExams.map((ex) => ex.name);
    const finalReason = form.discount_reason === "Other" ? form.discount_reason_other : form.discount_reason;

    const requestedValues = {
      exam_date: form.exam_date || null,
      scan_types: scanNames,
      doctor_id: walkIn ? null : selectedDoctor?.id || null,
      branch_id: form.branch_id || null,
      amount_due: sumAfterDiscount || null,
      discount_pct: discountPct,
      discount_reason: form.discount_on ? finalReason : null,
      notes: form.notes || null,
    };
    const previousValues = {
      exam_date: visit.exam_date || null,
      scan_types: visit.scan_types || [],
      doctor_id: visit.doctor_id || null,
      branch_id: visit.branch_id || null,
      amount_due: visit.amount_due,
      // Normalized the same way the form initializes discount_pct (null -> 0)
      // so a visit that never had a discount doesn't show a false "changed"
      // diff in Action Center just because null and 0 aren't the same value.
      discount_pct: visit.discount_pct || 0,
      discount_reason: visit.discount_reason,
      notes: visit.notes,
    };

    const newPaymentAmount = Number(form.new_payment_amount) || 0;
    if (newPaymentAmount < 0) {
      setError("Payment amount can't be negative.");
      setSaving(false);
      return;
    }

    if (isAdmin) {
      // Admin edits apply immediately - requiring admin to approve their own
      // edit would be a pointless, circular step.
      const { error: err } = await supabase.from("visits").update(requestedValues).eq("id", visit.id);
      if (err) {
        setSaving(false);
        setError(err.message);
        return;
      }
      if (newPaymentAmount > 0) {
        // Same shape as the existing quick Log Payment action: no paid_at
        // override, so it defaults to now() - the day the money actually
        // came in, not the visit's original date, which is what makes this
        // count correctly in today's cash-in-hand for whoever logged it.
        const { error: payErr } = await supabase.from("visit_payments").insert({
          visit_id: visit.id,
          amount: newPaymentAmount,
          payment_method: form.new_payment_method,
          created_by_id: profile?.id || null,
          created_by_name: profile?.name || null,
        });
        if (payErr) {
          setSaving(false);
          setError(payErr.message);
          return;
        }
      }
      setSaving(false);
      logActivity({
        actorId: profile?.id,
        actorName: profile?.name,
        actorType: "admin",
        action: "visit_edited",
        entityType: "visit",
        entityId: visit.id,
        details: { previousValues, requestedValues, newPaymentAmount: newPaymentAmount || undefined },
      });
    } else {
      const { error: err } = await supabase.from("visit_edit_requests").insert({
        visit_id: visit.id,
        previous_values: previousValues,
        requested_values: requestedValues,
        requested_by_id: profile?.id || null,
        requested_by_name: profile?.name || null,
        // Held separately until an admin approves the request - the actual
        // visit_payments row (and the cash-ledger entry it auto-creates)
        // only gets created at that point, attributed back to this
        // requester, not whichever admin approves it later.
        pending_payment_amount: newPaymentAmount || null,
        pending_payment_method: newPaymentAmount > 0 ? form.new_payment_method : null,
      });
      setSaving(false);
      if (err) {
        setError(err.message);
        return;
      }
    }
    onSaved();
  }

  if (!loaded) {
    return (
      <Modal title="Edit Visit" onClose={onClose} wide>
        <p style={{ color: theme.gray, fontSize: 13 }}>Loading...</p>
      </Modal>
    );
  }

  return (
    <Modal title="Edit Visit" onClose={onClose} wide>
      {!isAdmin && (
        <p style={{ fontSize: 12, background: "#fff8e1", color: "#8a6d00", padding: "10px 12px", borderRadius: 8, marginTop: 0, marginBottom: 14 }}>
          This change will be sent to Action Center for admin approval - it won't apply until approved.
        </p>
      )}
      <form onSubmit={handleSubmit}>
        <FieldLabel>Visit Date</FieldLabel>
        <input
          type="date"
          style={inp}
          value={form.exam_date}
          onChange={(e) => setForm({ ...form, exam_date: e.target.value })}
        />

        <FieldLabel>Branch</FieldLabel>
        <select style={inp} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
          <option value="">Select branch</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>

        <FieldLabel>Scan Type (select multiple)</FieldLabel>
        {examsByCategory.map((cat) => (
          <div key={cat.key} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: theme.gray, textTransform: "uppercase", marginBottom: 4 }}>{cat.label}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {cat.items.map((ex) => (
                <label
                  key={ex.id}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "6px 10px", borderRadius: 8,
                    border: `1px solid ${form.scan_type_ids.includes(ex.id) ? theme.gold : "#ddd"}`,
                    background: form.scan_type_ids.includes(ex.id) ? theme.goldLight : "#fff", cursor: "pointer",
                  }}
                >
                  <input type="checkbox" checked={form.scan_type_ids.includes(ex.id)} onChange={() => toggleScan(ex.id)} />
                  {ex.name} <span style={{ color: theme.gray }}>({Number(ex.price).toFixed(0)} EGP)</span>
                </label>
              ))}
            </div>
          </div>
        ))}

        <FieldLabel>Referring Doctor</FieldLabel>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={walkIn}
            onChange={(e) => {
              setWalkIn(e.target.checked);
              if (e.target.checked) setSelectedDoctor(null);
            }}
          />
          Walk-in, no referring doctor
        </label>
        {!walkIn && (
          <>
            {selectedDoctor ? (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderRadius: 8, background: "#faf9fb", marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: theme.navy, fontWeight: 600 }}>{selectedDoctor.name} - {selectedDoctor.clinic_name}</span>
                <button type="button" onClick={() => setSelectedDoctor(null)} style={{ fontSize: 12, color: theme.gray, background: "none", border: "none", cursor: "pointer" }}>Change</button>
              </div>
            ) : (
              <>
                <input style={inp} value={doctorQuery} onChange={(e) => setDoctorQuery(e.target.value)} placeholder="Search doctor by name or clinic code" />
                {doctorResults.map((d) => (
                  <div key={d.id} onClick={() => selectDoctor(d)} style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #f0f0f0", fontSize: 13 }}>
                    {d.name} - {d.clinic_name} ({d.clinic_code})
                  </div>
                ))}
              </>
            )}
          </>
        )}

        <div style={{ background: "#faf9fb", borderRadius: 8, padding: 12, margin: "10px 0" }}>
          <TotalRow label="Sum Before Discount" value={sumBeforeDiscount} />
          {discountPct > 0 && <TotalRow label={`Discount (${discountPct}%)`} value={-discountAmount} negative />}
          <TotalRow label="Amount Due" value={sumAfterDiscount} bold />
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginBottom: 10 }}>
          <input type="checkbox" checked={form.discount_on} onChange={(e) => setForm({ ...form, discount_on: e.target.checked })} />
          Apply Discount
        </label>
        {form.discount_on && (
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <FieldLabel>Discount %</FieldLabel>
              <input
                type="number"
                style={inp}
                value={form.discount_pct}
                onChange={(e) => {
                  const val = e.target.value;
                  const overCap = Number(val) > 20 && form.discount_reason === "Referred Patient";
                  setForm({ ...form, discount_pct: val, discount_reason: overCap ? "" : form.discount_reason });
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <FieldLabel>Reason</FieldLabel>
              <select style={inp} value={form.discount_reason} onChange={(e) => setForm({ ...form, discount_reason: e.target.value })}>
                <option value="">Select...</option>
                {DISCOUNT_REASONS.map((r) => (
                  <option key={r} value={r} disabled={r === "Referred Patient" && Number(form.discount_pct) > 20}>
                    {r}{r === "Referred Patient" && Number(form.discount_pct) > 20 ? " (max 20%)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div style={{ background: "#faf9fb", borderRadius: 10, padding: "12px 14px", margin: "14px 0" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: theme.gray, textTransform: "uppercase", marginBottom: 8 }}>Financial Summary</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 13 }}>
            <span style={{ color: theme.gray }}>Original amount:</span>
            <span style={{ textAlign: "right", color: theme.navy }}>{sumBeforeDiscount.toFixed(2)} EGP</span>
            {discountPct > 0 && (
              <>
                <span style={{ color: theme.gray }}>Discount ({discountPct}%):</span>
                <span style={{ textAlign: "right", color: "#b45309" }}>-{discountAmount.toFixed(2)} EGP</span>
              </>
            )}
            <span style={{ color: theme.gray, fontWeight: 700 }}>Amount due:</span>
            <span style={{ textAlign: "right", color: theme.navy, fontWeight: 700 }}>{sumAfterDiscount.toFixed(2)} EGP</span>
            <span style={{ color: theme.gray }}>Already paid:</span>
            <span style={{ textAlign: "right", color: theme.navy }}>{alreadyPaid.toFixed(2)} EGP</span>
            {projectedNewPayment > 0 && (
              <>
                <span style={{ color: theme.gray }}>This payment:</span>
                <span style={{ textAlign: "right", color: "#2e7d32" }}>+{projectedNewPayment.toFixed(2)} EGP</span>
              </>
            )}
            <span style={{ color: theme.gray, fontWeight: 700 }}>Remaining for settlement:</span>
            <span style={{ textAlign: "right", fontWeight: 700, color: remainingForSettlement > 0.01 ? "#ba1a1a" : "#2e7d32" }}>
              {remainingForSettlement.toFixed(2)} EGP
            </span>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <div style={{ flex: 1 }}>
              <FieldLabel>Record a New Payment (optional)</FieldLabel>
              <input
                type="number"
                style={inp}
                value={form.new_payment_amount}
                onChange={(e) => setForm({ ...form, new_payment_amount: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div style={{ flex: 1 }}>
              <FieldLabel>&nbsp;</FieldLabel>
              <select style={inp} value={form.new_payment_method} onChange={(e) => setForm({ ...form, new_payment_method: e.target.value })}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          <p style={{ fontSize: 11, color: theme.gray, margin: "4px 0 0" }}>
            E.g. the patient just paid off the rest of a partial balance. Logged with today's date, not the visit's date, so it counts correctly in today's cash-in-hand.
            {!isAdmin && " Like the rest of this form, it won't take effect until an admin approves it."}
          </p>
        </div>

        <FieldLabel>Notes</FieldLabel>
        <input style={inp} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />

        {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}
        <button type="submit" disabled={saving} style={{ ...actionBtn, marginTop: 6 }}>
          {saving ? "Saving..." : isAdmin ? "Save Changes" : "Submit for Approval"}
        </button>
      </form>
    </Modal>
  );
}

function Modal({ title, children, onClose, wide }) {
  // Header stays fixed at the top of the modal while only the body below it
  // scrolls - a flex column with the header as a non-shrinking child and the
  // body as the one scrollable region, rather than the whole card (header
  // included) scrolling as one block.
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,11,56,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 16, width: wide ? 480 : 380, maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "26px 26px 14px", flexShrink: 0, borderBottom: "1px solid #f0f0f0" }}>
          <h3 style={{ margin: 0, color: theme.navy, fontSize: 17 }}>{title}</h3>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 18, cursor: "pointer", color: theme.gray }}>×</button>
        </div>
        <div style={{ padding: "14px 26px 26px", overflowY: "auto", minHeight: 0 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
function FieldLabel({ children }) {
  return <label style={{ fontSize: 11, fontWeight: 600, color: theme.navy, display: "block", marginBottom: 4, marginTop: 8 }}>{children}</label>;
}
function TotalRow({ label, value, bold, negative }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: bold ? 14 : 12 }}>
      <span style={{ color: bold ? theme.navy : theme.gray, fontWeight: bold ? 700 : 500 }}>{label}</span>
      <span style={{ color: negative ? "#ba1a1a" : theme.navy, fontWeight: bold ? 700 : 600 }}>{formatMoney(value, { decimals: 2 })} EGP</span>
    </div>
  );
}

function StageChip({ label, active, onClick, timestamp, byName }) {
  const tooltip = active && timestamp
    ? `${label} on ${new Date(timestamp).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}${byName ? ` by ${byName}` : ""}`
    : onClick
    ? "Click to toggle"
    : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={tooltip}
      style={{
        fontSize: 11,
        padding: "4px 10px",
        borderRadius: 999,
        fontWeight: 700,
        border: "none",
        background: active ? "#e8f5e9" : "#f5f5f5",
        color: active ? "#2e7d32" : "#aaa",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {active ? "✓" : "○"} {label}
    </button>
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
const inp = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13, boxSizing: "border-box", marginBottom: 10, fontFamily: "inherit" };
const editLabel = { display: "block", fontSize: 11, color: "#48464E", fontWeight: 600, marginBottom: 4 };
const editInp = { width: "100%", padding: "9px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, boxSizing: "border-box" };
