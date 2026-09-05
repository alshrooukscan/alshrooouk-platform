"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import { loadFaceModels, extractDescriptor } from "../../../../lib/faceMatch";
import { formatPhone } from "../../../../lib/formatPhone";
import { resolveUniqueUsername } from "../../../../lib/uniqueUsername";
import { employeePortalWhatsAppLink } from "../../../../lib/whatsapp";
import AccountCreatedModal from "../../../../components/AccountCreatedModal";
import { APP_URL } from "../../../../lib/appUrl";

export default function NewEmployeePage() {
  const router = useRouter();
  const [deductionRules, setDeductionRules] = useState([]);
  const [excuseRules, setExcuseRules] = useState([]);
  const [selectedDeductions, setSelectedDeductions] = useState([]);
  const [selectedExcuses, setSelectedExcuses] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoBase64, setPhotoBase64] = useState(null);
  const [photoFilename, setPhotoFilename] = useState(null);
  const [descriptor, setDescriptor] = useState(null);
  const [faceStatus, setFaceStatus] = useState("");
  const [createdAccount, setCreatedAccount] = useState(null);
  const [newEmployeeId, setNewEmployeeId] = useState(null);
  const [form, setForm] = useState({
    name: "",
    national_id: "",
    phone: "",
    role: "",
    fixed_salary: "",
    variable_salary: "",
    hourly_rate: "",
  });

  useEffect(() => {
    supabase.from("deduction_rules").select("id, name, value").then(({ data }) => setDeductionRules(data || []));
    supabase.from("excuse_rules").select("id, name, value").then(({ data }) => setExcuseRules(data || []));
  }, []);

  function toggle(list, setList, id) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  async function handlePhotoPicked(e) {
    const file = e.target.files[0];
    if (!file) return;
    setDescriptor(null);
    setFaceStatus("Loading face detection...");
    setPhotoFilename(file.name);

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      setPhotoPreview(dataUrl);
      setPhotoBase64(dataUrl.split(",")[1]);

      const img = new window.Image();
      img.onload = async () => {
        try {
          await loadFaceModels();
          setFaceStatus("Detecting face...");
          const result = await extractDescriptor(img);
          if (!result) {
            setFaceStatus("No face detected in this photo - try a clearer, front-facing photo.");
            return;
          }
          setDescriptor(result);
          setFaceStatus("Face detected. This photo will be used to verify this employee at clock in/out.");
        } catch (err) {
          setFaceStatus("Could not process this photo: " + err.message);
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.name) {
      setError("Name is required.");
      return;
    }
    setSaving(true);

    // Creating the employee goes through the server route: salary and national
    // ID are written with the service role there, so signed-in staff no longer
    // need write access to the employees table itself.
    const { data: sess } = await supabase.auth.getSession();
    const createRes = await fetch("/api/hr/employee", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sess.session?.access_token}`,
      },
      body: JSON.stringify({
        name: form.name,
        national_id: form.national_id || null,
        phone: formatPhone(form.phone),
        role: form.role,
        fixed_salary: form.fixed_salary || 0,
        variable_salary: form.variable_salary || 0,
        hourly_rate: form.hourly_rate || null,
      }),
    });
    const createJson = await createRes.json();
    if (!createRes.ok) {
      setError(createJson.error || "Could not create employee.");
      setSaving(false);
      return;
    }
    const emp = createJson.employee;
    const hrId = emp.hr_id;

    const baseUsername = formatPhone(form.phone).replace(/\D/g, "") || hrId.toLowerCase().replace(/-/g, "");
    const username = await resolveUniqueUsername(supabase, "employees", baseUsername);
    const { data: pwd } = await supabase.rpc("create_employee_credentials", { p_employee_id: emp.id, p_username: username });

    const assignments = [
      ...selectedDeductions.map((rid) => ({ employee_id: emp.id, deduction_rule_id: rid })),
      ...selectedExcuses.map((rid) => ({ employee_id: emp.id, excuse_rule_id: rid })),
    ];
    if (assignments.length > 0) {
      await supabase.from("employee_rule_assignments").insert(assignments);
    }

    if (descriptor) {
      const { data: session } = await supabase.auth.getSession();
      await fetch("/api/hr/enroll-face", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token}` },
        body: JSON.stringify({ employeeId: emp.id, descriptor, filename: photoFilename, mimeType: "image/jpeg", base64: photoBase64 }),
      });
    }

    setSaving(false);
    setNewEmployeeId(emp.id);
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
              ? employeePortalWhatsAppLink({
                  mobile: form.phone,
                  employeeName: form.name,
                  portalUrl: `${APP_URL}/portal`,
                  username: createdAccount.username,
                  password: createdAccount.password,
                })
              : null
          }
          onContinue={() => router.push(`/dashboard/hr/${newEmployeeId}`)}
          continueLabel="Continue to Profile"
        />
      )}
      <p style={{ color: theme.gray, fontSize: 13, marginBottom: 8 }}>HUMAN RESOURCES</p>
      <h1 style={{ color: theme.navy, marginBottom: 24 }}>Add Employee</h1>

      <form onSubmit={handleSubmit}>
        <Section title="Employee Details">
          <Row>
            <Field label="Full Name">
              <input style={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="National ID">
              <input style={inp} value={form.national_id} onChange={(e) => setForm({ ...form, national_id: e.target.value })} />
            </Field>
          </Row>
          <Row>
            <Field label="Phone">
              <input style={inp} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+20 1X XXX XXXX" />
            </Field>
            <Field label="Role">
              <input style={inp} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="e.g., Lab Technician" />
            </Field>
          </Row>
          <Row>
            <Field label="Fixed Salary (EGP)">
              <input style={inp} value={form.fixed_salary} onChange={(e) => setForm({ ...form, fixed_salary: e.target.value })} />
            </Field>
            <Field label="Variable Salary (EGP)">
              <input style={inp} value={form.variable_salary} onChange={(e) => setForm({ ...form, variable_salary: e.target.value })} />
            </Field>
          </Row>
          <Field label="Hourly Rate (EGP, optional, leave blank for salaried employees)">
            <input style={inp} value={form.hourly_rate} onChange={(e) => setForm({ ...form, hourly_rate: e.target.value })} placeholder="e.g., 50" />
          </Field>
        </Section>

        <Section title="Face Enrollment (for clock in/out verification)">
          <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 12 }}>
            Optional but recommended. A clear, front-facing photo lets the system verify this employee's identity
            when they sign in or out. Processed entirely in your browser, nothing is sent to any outside face-recognition service.
          </p>
          <input type="file" accept="image/*" onChange={handlePhotoPicked} style={{ marginBottom: 10 }} />
          {photoPreview && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
              <img src={photoPreview} alt="Preview" style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8, border: "1px solid #ddd" }} />
              <p style={{ fontSize: 12, color: descriptor ? "#2e7d32" : theme.gray, fontWeight: descriptor ? 700 : 400, maxWidth: 320 }}>{faceStatus}</p>
            </div>
          )}
        </Section>

        <Section title="Deduction Rules">
          {deductionRules.length === 0 && <p style={{ fontSize: 13, color: theme.gray }}>No deduction rules yet. Add some in Settings first.</p>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {deductionRules.map((r) => (
              <RuleChip key={r.id} active={selectedDeductions.includes(r.id)} onClick={() => toggle(selectedDeductions, setSelectedDeductions, r.id)}>
                {r.name} ({r.value})
              </RuleChip>
            ))}
          </div>
        </Section>

        <Section title="Excuse / Absence Rules">
          {excuseRules.length === 0 && <p style={{ fontSize: 13, color: theme.gray }}>No excuse rules yet. Add some in Settings first.</p>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {excuseRules.map((r) => (
              <RuleChip key={r.id} active={selectedExcuses.includes(r.id)} onClick={() => toggle(selectedExcuses, setSelectedExcuses, r.id)}>
                {r.name}
              </RuleChip>
            ))}
          </div>
        </Section>

        {error && <p style={{ color: "#ba1a1a", marginBottom: 12 }}>{error}</p>}

        <button type="submit" disabled={saving} style={{ padding: "14px 32px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
          {saving ? "Saving..." : "Add Employee"}
        </button>
      </form>
    </div>
  );
}

function RuleChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
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
      {children}
    </button>
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
const inp = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box", marginBottom: 16 };
