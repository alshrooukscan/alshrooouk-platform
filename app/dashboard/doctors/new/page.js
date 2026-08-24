"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import { formatPhone } from "../../../../lib/formatPhone";
import { resolveUniqueUsername } from "../../../../lib/uniqueUsername";
import { doctorPortalWhatsAppLink } from "../../../../lib/whatsapp";
import AccountCreatedModal from "../../../../components/AccountCreatedModal";

export default function NewDoctorPage() {
  const router = useRouter();
  const [branches, setBranches] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    phone: "",
    phone_2: "",
    email: "",
    clinic_name: "",
    clinic_code: "",
    branch_id: "",
    discount_pct: 0,
  });
  const [existingDoctors, setExistingDoctors] = useState([]);
  const [createdAccount, setCreatedAccount] = useState(null);
  const [newDoctorId, setNewDoctorId] = useState(null);

  useEffect(() => {
    const code = form.clinic_code.trim();
    if (code.length < 2) {
      setExistingDoctors([]);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("doctors").select("id, name, clinic_code, clinic_name").ilike("clinic_code", code).limit(5);
      setExistingDoctors(data || []);
    }, 400);
    return () => clearTimeout(t);
  }, [form.clinic_code]);

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
        phone: formatPhone(form.phone),
        phone_2: form.phone_2 ? formatPhone(form.phone_2) : null,
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

    const baseUsername = formatPhone(form.phone).replace(/\D/g, "") || form.clinic_code.toLowerCase().replace(/\s+/g, "");
    const username = await resolveUniqueUsername(supabase, "doctors", baseUsername);
    const { data: pwd } = await supabase.rpc("create_doctor_credentials", { p_doctor_id: data.id, p_username: username });

    setSaving(false);
    setNewDoctorId(data.id);
    setCreatedAccount({ username, password: pwd });
  }

  return (
    <div>
      {createdAccount && (
        <AccountCreatedModal
          username={createdAccount.username}
          password={createdAccount.password}
          whatsappLink={
            form.phone
              ? doctorPortalWhatsAppLink({
                  mobile: form.phone,
                  doctorName: form.name,
                  portalUrl: `${window.location.origin.replace("/dashboard", "")}/portal`,
                  username: createdAccount.username,
                  password: createdAccount.password,
                })
              : null
          }
          onContinue={() => router.push(`/dashboard/doctors/${newDoctorId}`)}
          continueLabel="Continue to Profile"
        />
      )}
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
            <Field label="Second Contact Number (optional)">
              <input style={inp} value={form.phone_2} onChange={(e) => setForm({ ...form, phone_2: e.target.value })} placeholder="+20 1X XXX XXXX" />
            </Field>
          </Row>
          <Field label="Email Address">
            <input style={inp} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="doctor@clinic.com" />
          </Field>
        </Section>

        <Section title="Practice Information">
          <Field label="Clinic / Hospital Name">
            <input style={inp} value={form.clinic_name} onChange={(e) => setForm({ ...form, clinic_name: e.target.value })} placeholder="e.g., Al Hayat Medical Center" />
          </Field>
          <Row>
            <Field label="Unique Clinic Code">
              <input style={inp} value={form.clinic_code} onChange={(e) => setForm({ ...form, clinic_code: e.target.value })} placeholder="e.g., 1021" />
              {existingDoctors.length > 0 && (
                <div style={{ background: "#fff8e1", border: "1px solid #ffe0b2", borderRadius: 8, padding: 10, marginTop: -8, marginBottom: 16, fontSize: 12 }}>
                  <span style={{ color: "#a97c00", fontWeight: 600 }}>
                    Already registered with this clinic code: {existingDoctors.map((d) => `${d.name} (${d.clinic_name || "—"})`).join(", ")}.
                  </span>{" "}
                  {existingDoctors.map((d) => (
                    <a key={d.id} href={`/dashboard/doctors/${d.id}`} target="_blank" rel="noreferrer" style={{ color: theme.gold, fontWeight: 700, textDecoration: "none", marginRight: 10 }}>
                      Open {d.name}'s profile →
                    </a>
                  ))}
                  <div style={{ color: theme.gray, marginTop: 4 }}>If this is a genuinely different doctor, that's fine, just make sure the name is different too.</div>
                </div>
              )}
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
