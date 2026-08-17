"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";

export default function NewDoctorPage() {
  const router = useRouter();
  const [branches, setBranches] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    clinic_name: "",
    clinic_code: "",
    branch_id: "",
    discount_pct: 0,
  });

  useEffect(() => {
    supabase.from("branches").select("id, name").eq("is_active", true).then(({ data }) => setBranches(data || []));
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.name || !form.clinic_code) {
      setError("Name and Clinic Code are required.");
      return;
    }
    setSaving(true);

    const { data, error: err } = await supabase
      .from("doctors")
      .insert({
        name: form.name,
        phone: form.phone,
        email: form.email || null,
        clinic_name: form.clinic_name,
        clinic_code: form.clinic_code,
        unique_code: `${form.clinic_code}_${form.name}`.trim(),
        branch_id: form.branch_id || null,
        discount_pct: form.discount_pct || 0,
      })
      .select("id")
      .single();

    if (err) {
      setSaving(false);
      if (err.code === "23505") {
        setError(`A doctor with Clinic Code "${form.clinic_code}" and this exact name is already registered. If this is a different doctor sharing a clinic code, that's fine, just make sure the name differs.`);
      } else {
        setError(err.message);
      }
      return;
    }

    const username = form.clinic_code.toLowerCase().replace(/\s+/g, "");
    await supabase.rpc("create_doctor_credentials", { p_doctor_id: data.id, p_username: username });

    setSaving(false);
    router.push(`/dashboard/doctors/${data.id}`);
  }

  return (
    <div>
      <p style={{ color: theme.gray, fontSize: 13, marginBottom: 8 }}>DOCTORS DIRECTORY</p>
      <h1 style={{ color: theme.navy, marginBottom: 4 }}>Register New Physician</h1>
      <p style={{ color: theme.gray, marginBottom: 24 }}>
        This profile will be used for lab result delivery and referral tracking.
      </p>

      <form onSubmit={handleSubmit}>
        <Section title="Physician Profile">
          <Field label="Full Name (including titles)">
            <input style={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g., Dr. Ahmed Youssef" />
          </Field>
          <Row>
            <Field label="Primary Contact Number">
              <input style={inp} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+20 1X XXX XXXX" />
            </Field>
            <Field label="Email Address">
              <input style={inp} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="doctor@clinic.com" />
            </Field>
          </Row>
        </Section>

        <Section title="Practice Information">
          <Field label="Clinic / Hospital Name">
            <input style={inp} value={form.clinic_name} onChange={(e) => setForm({ ...form, clinic_name: e.target.value })} placeholder="e.g., Al Hayat Medical Center" />
          </Field>
          <Row>
            <Field label="Unique Clinic Code">
              <input style={inp} value={form.clinic_code} onChange={(e) => setForm({ ...form, clinic_code: e.target.value })} placeholder="e.g., 1021" />
            </Field>
            <Field label="Primary Associated Branch">
              <select style={inp} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
                <option value="">Select branch</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </Field>
          </Row>
          <Field label="Discount %">
            <input style={inp} value={form.discount_pct} onChange={(e) => setForm({ ...form, discount_pct: e.target.value })} placeholder="0" />
          </Field>
        </Section>

        {error && <p style={{ color: "#ba1a1a", marginBottom: 12 }}>{error}</p>}

        <button
          type="submit"
          disabled={saving}
          style={{ padding: "14px 32px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer" }}
        >
          {saving ? "Registering..." : "Register Doctor"}
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
    <div style={{ flex: 1 }}>
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
