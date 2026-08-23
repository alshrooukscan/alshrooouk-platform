"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { formatPhone } from "../../../../lib/formatPhone";
import { theme } from "../../../../lib/theme";
import { formatMoney } from "../../../../lib/format";
import { customerWhatsAppLink, scanWhatsAppLink, buildCustomerMessage, buildScanMessage } from "../../../../lib/whatsapp";

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
  const [showAddScan, setShowAddScan] = useState(false);
  const [whatsAppPicker, setWhatsAppPicker] = useState(false);

  useEffect(() => {
    load();
    loadFiles();
  }, [id]);

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
    const { data: session } = await supabase.auth.getSession();
    const uploaderEmail = session.session?.user?.email || null;
    const { data: profile } = uploaderEmail
      ? await supabase.from("staff_profiles").select("name").eq("email", uploaderEmail).maybeSingle()
      : { data: null };

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(",")[1];
      const res = await fetch("/api/drive/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: id,
          filename: file.name,
          mimeType: file.type,
          base64,
          fileType,
          uploaderEmail,
          uploaderName: profile?.name || uploaderEmail,
        }),
      });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
      } else {
        await loadFiles();
        await load();
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
      .select("id, scan_types, exam_date, payment_status, branch_id, doctor_id, amount_due, amount_paid, scanned, raw_data_uploaded, report_done, paid_at, scanned_at, raw_data_uploaded_at, report_done_at, doctors(name, phone, email, clinic_code), branches(name), invoices(id)")
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

  async function toggleStage(visit, field) {
    const newValue = !visit[field];
    const tsField = `${field}_at`;
    const update = { [field]: newValue, [tsField]: newValue ? new Date().toISOString() : null };
    await supabase.from("visits").update(update).eq("id", visit.id);
    setVisits((prev) => prev.map((v) => (v.id === visit.id ? { ...v, ...update } : v)));
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
              {formatPhone(patient.mobile)} {patient.email ? `· ${patient.email}` : ""}
            </p>
            {credentials && <p style={{ fontSize: 12, color: theme.gray }}>Portal username: {credentials.username}</p>}
          </div>
        </div>
      </div>

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
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                <StageChip label="Paid" active={v.payment_status === "paid"} timestamp={v.paid_at} />
                <StageChip
                  label="Scanned"
                  active={v.scanned}
                  timestamp={v.scanned_at}
                  onClick={() => toggleStage(v, "scanned")}
                />
                <StageChip
                  label="Raw Data Uploaded"
                  active={v.raw_data_uploaded}
                  timestamp={v.raw_data_uploaded_at}
                  onClick={() => toggleStage(v, "raw_data_uploaded")}
                />
                <StageChip
                  label="Report Done"
                  active={v.report_done}
                  timestamp={v.report_done_at}
                  onClick={() => toggleStage(v, "report_done")}
                />
                <StageChip label="Invoice Generated" active={(v.invoices || []).length > 0} />
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button onClick={() => handleScanWhatsApp(v)} style={smallBtn}>Send Scan WhatsApp</button>
                <button onClick={() => handleGenerateInvoice(v)} style={smallBtn}>Generate Invoice</button>
              </div>
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
          <label style={{ ...actionBtn, display: "block", textAlign: "center", opacity: uploading ? 0.6 : 1, background: theme.gold, color: theme.navy }}>
            {uploading ? "Uploading..." : "Upload Scan Files"}
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
    payment_status: "pending",
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
      discount_on: Number(d.discount_pct) > 0,
      discount_pct: d.discount_pct || 0,
      notes: d.special_note ? (f.notes ? f.notes + " | " + d.special_note : d.special_note) : f.notes,
    }));
  }

  const selectedExams = examTypes.filter((e) => form.scan_type_ids.includes(e.id));
  const sumBeforeDiscount = selectedExams.reduce((s, e) => s + (Number(e.price) || 0), 0);
  const discountPct = form.discount_on ? Number(form.discount_pct) || 0 : 0;
  const discountAmount = sumBeforeDiscount * (discountPct / 100);
  const sumAfterDiscount = sumBeforeDiscount - discountAmount;

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

    const { error: vErr } = await supabase.from("visits").insert({
      patient_id: patient.id,
      doctor_id: walkIn ? null : selectedDoctor?.id,
      branch_id: form.branch_id || null,
      scan_types: scanNames,
      amount_due: sumAfterDiscount || null,
      discount_pct: discountPct,
      discount_reason: form.discount_on ? finalReason : null,
      amount_paid: form.amount_paid || 0,
      payment_status: form.payment_status,
        paid_at: form.payment_status === "paid" ? new Date().toISOString() : null,
      payment_method: form.payment_method,
      notes: form.notes || null,
    });

    setSaving(false);
    if (vErr) {
      setError(vErr.message);
      return;
    }
    onSaved();
  }

  return (
    <Modal title={`Add New Scan — ${patient.name}`} onClose={onClose} wide>
      <form onSubmit={handleSubmit}>
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
              <input type="number" style={inp} value={form.discount_pct} onChange={(e) => setForm({ ...form, discount_pct: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <FieldLabel>Reason</FieldLabel>
              <select style={inp} value={form.discount_reason} onChange={(e) => setForm({ ...form, discount_reason: e.target.value })}>
                <option value="">Select...</option>
                {DISCOUNT_REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
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
        <FieldLabel>Payment Status</FieldLabel>
        <select style={inp} value={form.payment_status} onChange={(e) => setForm({ ...form, payment_status: e.target.value })}>
          <option value="paid">Paid</option>
          <option value="partial">Partial</option>
          <option value="pending">Pending</option>
        </select>

        {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}
        <button type="submit" disabled={saving} style={{ ...actionBtn, marginTop: 6 }}>
          {saving ? "Saving..." : "Add Scan"}
        </button>
      </form>
    </Modal>
  );
}

function Modal({ title, children, onClose, wide }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,11,56,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 26, width: wide ? 480 : 380, maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, color: theme.navy, fontSize: 17 }}>{title}</h3>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 18, cursor: "pointer", color: theme.gray }}>×</button>
        </div>
        {children}
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

function StageChip({ label, active, onClick, timestamp }) {
  const tooltip = active && timestamp
    ? `${label} on ${new Date(timestamp).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`
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
