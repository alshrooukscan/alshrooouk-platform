"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import { formatMoney } from "../../../../lib/format";
import { formatPhone } from "../../../../lib/formatPhone";
import { resolvePatientUsername } from "../../../../lib/uniqueUsername";
import { customerWhatsAppLink } from "../../../../lib/whatsapp";
import { usePermissions } from "../../../../lib/usePermissions";
import { syncPatientLastVisitDate } from "../../../../lib/syncPatientLastVisitDate";
import AccountCreatedModal from "../../../../components/AccountCreatedModal";
import { APP_URL } from "../../../../lib/appUrl";

const CATEGORY_LABELS = { "2d": "2D", "3d": "3D", bundle: "Bundle", misc: "Misc" };
const CATEGORY_ORDER = ["2d", "3d", "bundle", "misc"];
const DISCOUNT_REASONS = ["Referred Patient", "Doctor / Doctor Relative", "Approved by Management", "Workers / Workers Relatives", "People in Need", "Insurance", "Other"];
const PAYMENT_METHODS = ["Cash", "Visa", "InstaPay", "Wallet"];

export default function NewPatientPage() {
  const router = useRouter();
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
      // Partial match, not exact - a staff member typing digits should see
      // anyone whose number contains what's been typed so far, the same way
      // the main patient search bar works. Exact-only matching is what let
      // a duplicate patient slip through with a phone that was one digit off
      // from an existing record.
      const { data } = await supabase.from("patients").select("id, name, mobile").ilike("mobile", `%${mobile}%`).limit(5);
      setExistingPatients(data || []);
    }, 400);
    return () => clearTimeout(t);
  }, [form.mobile]);

  useEffect(() => {
    supabase.from("branches").select("id, name").eq("is_active", true).then(({ data }) => setBranches(data || []));
    supabase.from("exam_types").select("id, name, price, category, branch_id").eq("is_active", true).order("name").then(({ data }) => setExamTypes(data || []));
  }, []);

  // Staff work out of one branch, so the branch is prefilled from their own
  // profile rather than picked every time. Still editable - a manager covering
  // two sites needs to be able to change it.
  useEffect(() => {
    if (profile?.branch_id) {
      setForm((f) => (f.branch_id ? f : { ...f, branch_id: profile.branch_id }));
    }
  }, [profile?.branch_id]);

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
    // Fixed 20% "Referred Patient" discount, matching the same rule already
    // enforced on the existing-patient page - not the doctor's own
    // discount_pct field, which this form used to pull from directly and
    // had no cap on at all.
    setForm((f) => ({
      ...f,
      discount_on: true,
      discount_pct: 20,
      discount_reason: "Referred Patient",
      notes: d.special_note ? (f.notes ? f.notes + " | " + d.special_note : d.special_note) : f.notes,
    }));
  }

  // ---- Live totals ----
  const selectedExams = examTypes.filter((e) => form.scan_type_ids.includes(e.id));
  const sumBeforeDiscount = selectedExams.reduce((s, e) => s + (Number(e.price) || 0), 0);
  const discountPct = form.discount_on ? Number(form.discount_pct) || 0 : 0;
  const discountAmount = sumBeforeDiscount * (discountPct / 100);
  const sumAfterDiscount = sumBeforeDiscount - discountAmount;

  // Each branch owns its own scan list and prices. Rows with no branch set are
  // legacy/global and stay visible everywhere, so nothing disappears from the
  // form for a branch that hasn't had its list built out yet.
  const branchExamTypes = examTypes.filter(
    (e) => !form.branch_id || !e.branch_id || e.branch_id === form.branch_id
  );

  // Switching branch must drop any scan already ticked that the new branch does
  // not offer - otherwise the visit saves with a scan name that branch has no
  // price for, and the report trigger cannot resolve it either.
  useEffect(() => {
    if (!form.branch_id || !examTypes.length) return;
    const allowed = new Set(branchExamTypes.map((e) => e.id));
    setForm((f) =>
      f.scan_type_ids.every((sid) => allowed.has(sid))
        ? f
        : { ...f, scan_type_ids: f.scan_type_ids.filter((sid) => allowed.has(sid)) }
    );
  }, [form.branch_id, examTypes.length]);

  const examsByCategory = CATEGORY_ORDER.map((cat) => ({
    key: cat,
    label: CATEGORY_LABELS[cat],
    items: branchExamTypes.filter((e) => (e.category || "misc") === cat),
  })).filter((c) => c.items.length > 0);

  // One definition of "complete", used by the per-field flags, the summary
  // banner and the submit check alike, so they can never disagree about what
  // is missing. Keyed by field so each input can flag itself in place rather
  // than staff hunting for one error line at the bottom of a long form.
  const missingFields = {};
  if (!form.name.trim()) missingFields.name = "Enter the patient's full name.";
  if (!form.mobile.trim()) missingFields.mobile = "Enter a mobile number.";
  if (!form.branch_id) missingFields.branch_id = "Choose which branch this visit is at.";
  if (form.scan_type_ids.length === 0) missingFields.scan_types = "Select at least one scan type.";
  if (!walkIn && !selectedDoctor)
    missingFields.doctor = 'Select a referring doctor, or tick "Walk-in, no referring doctor."';
  if (form.discount_on) {
    if (!form.discount_reason) missingFields.discount_reason = "Choose a reason for the discount.";
    else if (form.discount_reason === "Other" && !form.discount_reason_other.trim())
      missingFields.discount_reason = "Describe the discount reason.";
    if (!(Number(form.discount_pct) > 0)) missingFields.discount_pct = "Enter a discount percentage above 0.";
  }
  const missingList = Object.values(missingFields);
  // Only shown after a save attempt. Flagging empty fields the moment the page
  // opens would mark a blank form as wrong before anyone has typed anything.
  const [attempted, setAttempted] = useState(false);
  const flag = (key) => (attempted ? missingFields[key] : null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setAttempted(true);
    if (missingList.length > 0) {
      setError(
        missingList.length === 1
          ? missingList[0]
          : `${missingList.length} fields still need to be filled in - they are marked in red below.`
      );
      return;
    }
    setSaving(true);
    // Everything past this point is wrapped so the button can never be left
    // stuck on "Registering...". Previously there was no try/catch here: any
    // thrown error or stalled network call skipped every setSaving(false) and
    // froze the form permanently, while the patient and visit rows it had
    // already written stayed behind as a half-created record.
    try {
    const normalizedMobile = formatPhone(form.mobile);

    // Match on phone AND name, not phone alone. The warning above tells staff
    // that a different person sharing a number (a family member) can just carry
    // on registering - but matching on phone alone silently filed that new
    // person's scan under whoever already held the number, so the second
    // patient never existed and their visit landed on a stranger's record.
    //
    // Same number + same name  -> same person, reuse the record.
    // Same number + a new name -> a different person, give them their own.
    const { data: sameNumber } = await supabase
      .from("patients")
      .select("id, name")
      .eq("mobile", normalizedMobile);

    const typedName = (form.name || "").trim().toLowerCase().replace(/\s+/g, " ");
    const sameHuman = (sameNumber || []).find(
      (p) => (p.name || "").trim().toLowerCase().replace(/\s+/g, " ") === typedName
    );

    let patientId = sameHuman?.id;
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
        // Written alongside the names so the edit form can re-open this visit
        // by id rather than by string match. Renaming a scan type in Settings
        // must never retroactively break a saved visit again.
        exam_type_ids: selectedExams.map((e) => e.id),
        amount_due: sumAfterDiscount,
        discount_pct: discountPct,
        discount_reason: form.discount_on ? finalReason : null,
        notes: form.notes || null,
      })
      .select("id")
      .single();

    if (vErr) {
      setError(vErr.message);
      setSaving(false);
      return;
    }

    await syncPatientLastVisitDate(supabase, patientId);

    // Logging the payment as a visit_payments row (rather than setting
    // amount_paid/payment_status directly on the visit) is what makes it
    // count as cash in this specific employee's hand: it's what
    // recompute_visit_payment() reads to set the visit's real payment
    // status, and what sync_visit_payment_to_expenses() reads to create the
    // confirmed expense ledger entry attributed to created_by_id. Setting
    // the visit's payment fields directly, like this form used to do, left
    // the payment invisible to both of those and to the employee's cash
    // ledger entirely.
    const paidNow = Number(form.amount_paid) || 0;
    if (paidNow > 0) {
      const { error: pErr } = await supabase.from("visit_payments").insert({
        visit_id: visit.id,
        amount: paidNow,
        payment_method: form.payment_method,
        created_by_id: profile?.id || null,
        created_by_name: profile?.name || null,
      });
      if (pErr) {
        setError(pErr.message);
        setSaving(false);
        return;
      }
    }

    if (!existing) {
      // The patient and their visit are already saved at this point. Portal
      // credentials are a convenience on top of that, so a failure here must
      // not discard the registration or strand the form - it hands over to
      // the profile with a note instead, and the account can be created from
      // there.
      try {
        const baseUsername = normalizedMobile.replace(/\D/g, "");
        const username = await resolvePatientUsername(baseUsername);
        const { data: pwd, error: cErr } = await supabase.rpc("create_patient_credentials", {
          p_patient_id: patientId,
          p_username: username,
        });
        if (cErr) throw new Error(cErr.message);
        setNewPatientId(patientId);
        setCreatedAccount({ username, password: pwd });
        return;
      } catch (credErr) {
        console.error("Portal credential creation failed", credErr);
        setError(
          "The patient and visit were saved, but the portal account could not be created (" +
            (credErr?.message || "unknown error") +
            "). You can create it from the patient's profile."
        );
        router.push(`/dashboard/patients/${patientId}`);
        return;
      }
    }

    router.push(`/dashboard/patients/${patientId}`);
    } catch (err) {
      // Anything unexpected surfaces as a message rather than a frozen button.
      console.error("Patient registration failed", err);
      setError(
        (err?.message || "Something went wrong while saving.") +
          " Search for the patient before trying again - part of the registration may already have been saved."
      );
    } finally {
      // Runs on every path, including the ones that return early, so the
      // button always comes back.
      setSaving(false);
    }
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
                  portalUrl: `${APP_URL}/portal`,
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
            <Field label="Full Name" required missing={flag("name")}>
              <input style={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g., Sarah Johnson" />
            </Field>
            <Field label="Mobile Number" required missing={flag("mobile")}>
              <input style={inp} value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="+20 10 123 4567" />
              {existingPatients.length > 0 && (
                <div style={{ background: "#fff8e1", border: "1px solid #ffe0b2", borderRadius: 8, padding: 10, marginTop: -8, marginBottom: 16, fontSize: 12 }}>
                  <span style={{ color: "#a97c00", fontWeight: 600 }}>
                    Already registered with this number: {existingPatients.map((p) => p.name).join(", ")}.
                  </span>{" "}
                  {existingPatients.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => router.push(`/dashboard/patients/${p.id}`)}
                      style={{ color: theme.gold, fontWeight: 700, textDecoration: "none", marginRight: 10, background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12 }}
                    >
                      Open {p.name}'s profile →
                    </button>
                  ))}
                  <div style={{ color: theme.gray, marginTop: 4 }}>
                    Opening a profile above leaves this form without saving it, so the new scan can be added to that existing patient instead.
                    If this is a different person who happens to share the same number (e.g. family), it's fine to continue registering below.
                  </div>
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
          <Field label="Branch" required missing={flag("branch_id")}>
            <select style={inp} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
              <option value="">Select branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </Field>

          <label style={{ fontSize: 12, fontWeight: 600, color: flag("scan_types") ? "#ba1a1a" : theme.navy, display: "block", margin: "12px 0 6px" }}>
            Scan Type (select multiple)<span style={{ color: "#ba1a1a", marginLeft: 3 }}>*</span>
          </label>
          {flag("scan_types") && (
            <p style={{ color: "#ba1a1a", fontSize: 11, margin: "0 0 8px", fontWeight: 600 }}>{flag("scan_types")}</p>
          )}
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

          <label style={{ fontSize: 12, fontWeight: 600, color: flag("doctor") ? "#ba1a1a" : theme.navy, marginTop: 8, display: "block" }}>
            Referring Doctor<span style={{ color: "#ba1a1a", marginLeft: 3 }}>*</span>
          </label>
          {flag("doctor") && (
            <p style={{ color: "#ba1a1a", fontSize: 11, margin: "4px 0 0", fontWeight: 600 }}>{flag("doctor")}</p>
          )}
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
                <Field label="Discount %" required missing={flag("discount_pct")}>
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
                </Field>
                <Field label="Reason" required missing={flag("discount_reason")}>
                  <select style={inp} value={form.discount_reason} onChange={(e) => setForm({ ...form, discount_reason: e.target.value })}>
                    <option value="">Select reason...</option>
                    {DISCOUNT_REASONS.map((r) => (
                      <option key={r} value={r} disabled={r === "Referred Patient" && Number(form.discount_pct) > 20}>
                        {r}{r === "Referred Patient" && Number(form.discount_pct) > 20 ? " (max 20%)" : ""}
                      </option>
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
function Field({ label, children, required, missing }) {
  return (
    <div style={{ flex: 1, marginBottom: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: missing ? "#ba1a1a" : theme.navy, display: "block", marginBottom: 6 }}>
        {label}
        {required && <span style={{ color: "#ba1a1a", marginLeft: 3 }}>*</span>}
      </label>
      {children}
      {missing && (
        <p style={{ color: "#ba1a1a", fontSize: 11, margin: "4px 0 0", fontWeight: 600 }}>{missing}</p>
      )}
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
