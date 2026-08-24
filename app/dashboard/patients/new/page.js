"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import { formatMoney } from "../../../../lib/format";
import { formatPhone } from "../../../../lib/formatPhone";
import { resolveUniqueUsername } from "../../../../lib/uniqueUsername";
import { customerWhatsAppLink } from "../../../../lib/whatsapp";
import AccountCreatedModal from "../../../../components/AccountCreatedModal";

const CATEGORY_LABELS = { "2d": "2D", "3d": "3D", bundle: "Bundle", misc: "Misc" };
const CATEGORY_ORDER = ["2d", "3d", "bundle", "misc"];
const DISCOUNT_REASONS = ["Referred Patient", "Doctor / Doctor Relative", "Approved by Management", "Workers / Workers Relatives", "People in Need", "Insurance", "Other"];
const PAYMENT_METHODS = ["Cash", "InstaPay", "Wallet", "Visa"];

export default function NewPatientPage() {
  const router = useRouter();
  const [branches, setBranches] = useState([]);
  const [examTypes, setExamTypes] = useState([]);
  const [doctorQuery, setDoctorQuery] = useState("");
  const [doctorResults, setDoctorResults] = useState([]);
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [walkIn, setWalkIn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "",
    mobile: "",
    dob: "",
    email: "",
    preferred_contact: "WhatsApp",
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
  const [existingPatients, setExistingPatients] = useState([]);
  const [createdAccount, setCreatedAccount] = useState(null);
  const [newPatientId, setNewPatientId] = useState(null);

  useEffect(() => {
    const mobile = form.mobile.trim();
    if (mobile.length < 6) {
      setExistingPatients([]);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("patients").select("id, name, mobile").eq("mobile", mobile).limit(5);
      setExistingPatients(data || []);
    }, 400);
    return () => clearTimeout(t);
  }, [form.mobile]);

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
      scan_type_ids: f.scan_type_ids.includes(id)
        ? f.scan_type_ids.filter((x) => x !== id)
        : [...f.scan_type_ids, id],
    }));
  }

  function selectDoctor(d) {
    setSelectedDoctor(d);
    setDoctorResults([]);
    // Auto-fill discount and note from the doctor's own record, staff can still override.
    setForm((f) => ({
      ...f,
      discount_on: Number(d.discount_pct) > 0,
      discount_pct: d.discount_pct || 0,
      notes: d.special_note ? (f.notes ? f.notes + " | " + d.special_note : d.special_note) : f.notes,
    }));
  }

  // ---- Live totals ----
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
    if (!form.name || !form.mobile) {
      setError("Name and mobile number are required.");
      return;
    }
    if (!walkIn && !selectedDoctor) {
      setError('Select a referring doctor, or check "Walk-in, no referring doctor."');
      return;
    }
    setSaving(true);
    const normalizedMobile = formatPhone(form.mobile);

    const { data: existing } = await supabase.from("patients").select("id").eq("mobile", normalizedMobile).maybeSingle();

    let patientId = existing?.id;
    if (!patientId) {
      const { data: newPatient, error: pErr } = await supabase
        .from("patients")
        .insert({
          name: form.name,
          mobile: normalizedMobile,
          dob: form.dob || null,
          email: form.email || null,
          preferred_contact: form.preferred_contact,
        })
        .select("id")
        .single();
      if (pErr) {
        setError(pErr.message);
        setSaving(false);
        return;
      }
      patientId = newPatient.id;
    }

    const scanNames = selectedExams.map((e) => e.name);
    const finalReason = form.discount_reason === "Other" ? form.discount_reason_other : form.discount_reason;

    const { data: visit, error: vErr } = await supabase
      .from("visits")
      .insert({
        patient_id: patientId,
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
      })
      .select("id")
      .single();

    if (vErr) {
      setError(vErr.message);
      setSaving(false);
      return;
    }

    if (!existing) {
      const baseUsername = normalizedMobile.replace(/\D/g, "");
      const username = await resolveUniqueUsername(supabase, "patient_auth", baseUsername);
      const { data: pwd } = await supabase.rpc("create_patient_credentials", { p_patient_id: patientId, p_username: username });
      setSaving(false);
      setNewPatientId(patientId);
      setCreatedAccount({ username, password: pwd });
      return;
    }

    setSaving(false);
    router.push(`/dashboard/patients/${patientId}`);
  }

  return (
    <div>
      {createdAccount && (
        <AccountCreatedModal
          username={createdAccount.username}
          password={createdAccount.password}
          whatsappLink={
            form.mobile
              ? customerWhatsAppLink({
                  mobile: form.mobile,
                  patientName: form.name,
                  portalUrl: `${window.location.origin.replace("/dashboard", "")}/portal`,
                  username: createdAccount.username,
                  password: createdAccount.password,
                })
              : null
          }
          onContinue={() => router.push(`/dashboard/patients/${newPatientId}`)}
          continueLabel="Continue to Profile"
        />
      )}
      <p style={{ color: theme.gray, fontSize: 13, marginBottom: 8 }}>PATIENTS &gt; NEW REGISTRATION</p>
      <h1 style={{ color: theme.navy, marginBottom: 4 }}>Register Patient</h1>
      <p style={{ color: theme.gray, marginBottom: 24 }}>Enter the patient's personal, visit, and payment details.</p>

      <form onSubmit={handleSubmit}>
        <Section title="Patient Details">
          <Row>
            <Field label="Full Name">
              <input style={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g., Sarah Johnson" />
            </Field>
            <Field label="Mobile Number">
              <input style={inp} value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="+20 10 123 4567" />
              {existingPatients.length > 0 && (
                <div style={{ background: "#fff8e1", border: "1px solid #ffe0b2", borderRadius: 8, padding: 10, marginTop: -8, marginBottom: 16, fontSize: 12 }}>
                  <span style={{ color: "#a97c00", fontWeight: 600 }}>
                    Already registered with this number: {existingPatients.map((p) => p.name).join(", ")}.
                  </span>{" "}
                  {existingPatients.map((p) => (
                    <a key={p.id} href={`/dashboard/patients/${p.id}`} target="_blank" rel="noreferrer" style={{ color: theme.gold, fontWeight: 700, textDecoration: "none", marginRight: 10 }}>
                      Open {p.name}'s profile →
                    </a>
                  ))}
                  <div style={{ color: theme.gray, marginTop: 4 }}>If this is a different person sharing the same number (e.g. family), it's fine to continue registering below.</div>
                </div>
              )}
            </Field>
          </Row>
          <Row>
            <Field label="Date of Birth">
              <input type="date" style={inp} value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} />
            </Field>
            <Field label="Email (Optional)">
              <input style={inp} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="sarah@example.com" />
            </Field>
          </Row>
          <Field label="Preferred Contact Method">
            <select style={inp} value={form.preferred_contact} onChange={(e) => setForm({ ...form, preferred_contact: e.target.value })}>
              <option>WhatsApp</option>
              <option>Phone Call</option>
              <option>Email</option>
            </select>
          </Field>
        </Section>

        <Section title="Visit Details">
          <Field label="Branch">
            <select style={inp} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
              <option value="">Select branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </Field>

          <label style={{ fontSize: 12, fontWeight: 600, color: theme.navy, display: "block", margin: "12px 0 6px" }}>
            Scan Type (select multiple)
          </label>
          {examsByCategory.map((cat) => (
            <div key={cat.key} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: theme.gold, marginBottom: 6, letterSpacing: 0.5 }}>{cat.label}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {cat.items.map((ex) => {
                  const active = form.scan_type_ids.includes(ex.id);
                  return (
                    <button
                      type="button"
                      key={ex.id}
                      onClick={() => toggleScan(ex.id)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 999,
                        fontSize: 12,
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

          <label style={{ fontSize: 12, fontWeight: 600, color: theme.navy, marginTop: 8, display: "block" }}>Referring Doctor</label>
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
                <div key={d.id} onClick={() => selectDoctor(d)} style={{ padding: 10, cursor: "pointer", fontSize: 13 }}>
                  {d.name} — {d.clinic_name} ({d.clinic_code})
                  {Number(d.discount_pct) > 0 && <span style={{ color: theme.gold, marginLeft: 6, fontSize: 11 }}>({d.discount_pct}% discount auto-applies)</span>}
                </div>
              ))}
            </div>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 8, marginBottom: 16 }}>
            <input
              type="checkbox"
              checked={walkIn}
              onChange={(e) => {
                setWalkIn(e.target.checked);
                setSelectedDoctor(null);
              }}
            />
            Patient is a walk-in (no referring doctor)
          </label>
        </Section>

        <Section title="Payment">
          <div style={{ background: "#faf9fb", borderRadius: 10, padding: 14, marginBottom: 16 }}>
            <TotalRow label="Sum Before Discount" value={sumBeforeDiscount} />
            {discountPct > 0 && <TotalRow label={`Discount (${discountPct}%)`} value={-discountAmount} negative />}
            <TotalRow label="Sum After Discount (Amount Due)" value={sumAfterDiscount} bold />
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 12 }}>
            <input type="checkbox" checked={form.discount_on} onChange={(e) => setForm({ ...form, discount_on: e.target.checked })} />
            Apply Discount
          </label>
          {form.discount_on && (
            <>
              <Row>
                <Field label="Discount %">
                  <input type="number" style={inp} value={form.discount_pct} onChange={(e) => setForm({ ...form, discount_pct: e.target.value })} />
                </Field>
                <Field label="Reason">
                  <select style={inp} value={form.discount_reason} onChange={(e) => setForm({ ...form, discount_reason: e.target.value })}>
                    <option value="">Select reason...</option>
                    {DISCOUNT_REASONS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </Field>
              </Row>
              {form.discount_reason === "Other" && (
                <Field label="Specify Reason">
                  <input style={inp} value={form.discount_reason_other} onChange={(e) => setForm({ ...form, discount_reason_other: e.target.value })} />
                </Field>
              )}
            </>
          )}

          <Row>
            <Field label="Payment Method">
              <select style={inp} value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label="Amount Paid (EGP)">
              <input style={inp} value={form.amount_paid} onChange={(e) => setForm({ ...form, amount_paid: e.target.value })} placeholder="0.00" />
            </Field>
          </Row>
          <Field label="Payment Status">
            <select style={inp} value={form.payment_status} onChange={(e) => setForm({ ...form, payment_status: e.target.value })}>
              <option value="paid">Paid</option>
              <option value="partial">Partial</option>
              <option value="pending">Pending</option>
            </select>
          </Field>
          <Field label="Notes">
            <textarea style={{ ...inp, minHeight: 70, resize: "vertical" }} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Any extra notes about this visit..." />
          </Field>
        </Section>

        {error && <p style={{ color: "#ba1a1a", marginBottom: 12 }}>{error}</p>}

        <button
          type="submit"
          disabled={saving}
          style={{
            padding: "14px 32px",
            borderRadius: 8,
            border: "none",
            background: theme.navy,
            color: "#fff",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {saving ? "Registering..." : "Register Patient"}
        </button>
      </form>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginBottom: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
      <h3 style={{ color: theme.navy, marginTop: 0 }}>{title}</h3>
      {children}
    </div>
  );
}
function Row({ children }) {
  return <div style={{ display: "flex", gap: 16 }}>{children}</div>;
}
function Field({ label, children }) {
  return (
    <div style={{ flex: 1, marginBottom: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: theme.navy, display: "block", marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}
function TotalRow({ label, value, bold, negative }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: bold ? 15 : 13 }}>
      <span style={{ color: bold ? theme.navy : theme.gray, fontWeight: bold ? 700 : 500 }}>{label}</span>
      <span style={{ color: negative ? "#ba1a1a" : theme.navy, fontWeight: bold ? 700 : 600 }}>{formatMoney(value, { decimals: 2 })} EGP</span>
    </div>
  );
}

const inp = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #ddd",
  fontSize: 14,
  boxSizing: "border-box",
  marginBottom: 16,
  fontFamily: "inherit",
};
