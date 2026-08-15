"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";

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
    amount_due: "",
    amount_paid: "",
    payment_status: "pending",
  });

  useEffect(() => {
    supabase.from("branches").select("id, name").eq("is_active", true).then(({ data }) => setBranches(data || []));
    supabase.from("exam_types").select("id, name, price").eq("is_active", true).order("name").then(({ data }) => setExamTypes(data || []));
  }, []);

  useEffect(() => {
    if (!doctorQuery) {
      setDoctorResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("doctors")
        .select("id, name, clinic_name, clinic_code")
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

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.name || !form.mobile) {
      setError("Name and mobile number are required.");
      return;
    }
    if (!walkIn && !selectedDoctor) {
      setError("Select a referring doctor, or check \"Walk-in, no referring doctor.\"");
      return;
    }
    setSaving(true);

    // check existing patient by mobile
    const { data: existing } = await supabase.from("patients").select("id").eq("mobile", form.mobile).maybeSingle();

    let patientId = existing?.id;
    if (!patientId) {
      const { data: newPatient, error: pErr } = await supabase
        .from("patients")
        .insert({
          name: form.name,
          mobile: form.mobile,
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

    const scanNames = examTypes.filter((e) => form.scan_type_ids.includes(e.id)).map((e) => e.name);

    const { data: visit, error: vErr } = await supabase
      .from("visits")
      .insert({
        patient_id: patientId,
        doctor_id: walkIn ? null : selectedDoctor?.id,
        branch_id: form.branch_id || null,
        scan_types: scanNames,
        amount_due: form.amount_due || null,
        discount_pct: form.discount_on ? form.discount_pct : 0,
        discount_reason: form.discount_on ? form.discount_reason : null,
        amount_paid: form.amount_paid || 0,
        payment_status: form.payment_status,
      })
      .select("id")
      .single();

    if (vErr) {
      setError(vErr.message);
      setSaving(false);
      return;
    }

    // generate patient portal credentials (only on first registration)
    if (!existing) {
      const username = form.mobile.replace(/\D/g, "");
      await supabase.rpc("create_patient_credentials", { p_patient_id: patientId, p_username: username });
    }

    setSaving(false);
    router.push(`/dashboard/patients/${patientId}`);
  }

  return (
    <div>
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
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {examTypes.map((ex) => {
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
                  {ex.name} {ex.price ? `— ${ex.price} EGP` : ""}
                </button>
              );
            })}
          </div>

          <label style={{ fontSize: 12, fontWeight: 600, color: theme.navy }}>Referring Doctor</label>
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
                <div
                  key={d.id}
                  onClick={() => {
                    setSelectedDoctor(d);
                    setDoctorResults([]);
                  }}
                  style={{ padding: 10, cursor: "pointer", fontSize: 13 }}
                >
                  {d.name} — {d.clinic_name} ({d.clinic_code})
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
          <Row>
            <Field label="Amount Due (EGP)">
              <input style={inp} value={form.amount_due} onChange={(e) => setForm({ ...form, amount_due: e.target.value })} placeholder="0.00" />
            </Field>
            <Field label="Amount Paid (EGP)">
              <input style={inp} value={form.amount_paid} onChange={(e) => setForm({ ...form, amount_paid: e.target.value })} placeholder="0.00" />
            </Field>
          </Row>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 12 }}>
            <input type="checkbox" checked={form.discount_on} onChange={(e) => setForm({ ...form, discount_on: e.target.checked })} />
            Apply Discount
          </label>
          {form.discount_on && (
            <Row>
              <Field label="Discount %">
                <input style={inp} value={form.discount_pct} onChange={(e) => setForm({ ...form, discount_pct: e.target.value })} />
              </Field>
              <Field label="Reason">
                <input style={inp} value={form.discount_reason} onChange={(e) => setForm({ ...form, discount_reason: e.target.value })} />
              </Field>
            </Row>
          )}
          <Field label="Payment Status">
            <select style={inp} value={form.payment_status} onChange={(e) => setForm({ ...form, payment_status: e.target.value })}>
              <option value="paid">Paid</option>
              <option value="partial">Partial</option>
              <option value="pending">Pending</option>
            </select>
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

const inp = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #ddd",
  fontSize: 14,
  boxSizing: "border-box",
  marginBottom: 16,
};
