"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import { theme } from "../../../lib/theme";
import { usePermissions } from "../../../lib/usePermissions";

const MODULES = [
  { key: "dashboard", label: "Dashboard / P&L" },
  { key: "patients", label: "Patients" },
  { key: "doctors", label: "Doctors" },
  { key: "stock", label: "Stock" },
  { key: "hr", label: "HR & Payroll" },
  { key: "cash_expenses", label: "Cash Expenses" },
  { key: "vendors", label: "External Reports" },
  { key: "settings", label: "Settings" },
];

export default function SettingsPage() {
  const { isAdmin, loading: permsLoading } = usePermissions();
  const [branches, setBranches] = useState([]);
  const [deductionRules, setDeductionRules] = useState([]);
  const [excuseRules, setExcuseRules] = useState([]);
  const [staffUsers, setStaffUsers] = useState([]);
  const [newBranch, setNewBranch] = useState("");
  const [expandedBranch, setExpandedBranch] = useState(null);
  const [branchDraft, setBranchDraft] = useState({});
  const [newDeduction, setNewDeduction] = useState({ name: "", value: "" });
  const [newExcuse, setNewExcuse] = useState({ name: "", value: "" });
  const [showAddUser, setShowAddUser] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    const { data: b } = await supabase.from("branches").select("*").order("created_at");
    const { data: d } = await supabase.from("deduction_rules").select("*").order("created_at");
    const { data: e } = await supabase.from("excuse_rules").select("*").order("created_at");
    const { data: u } = await supabase.from("staff_profiles").select("*").order("created_at");
    setBranches(b || []);
    setDeductionRules(d || []);
    setExcuseRules(e || []);
    setStaffUsers(u || []);
  }

  async function toggleBranch(branch) {
    await supabase.from("branches").update({ is_active: !branch.is_active }).eq("id", branch.id);
    loadAll();
  }

  function openBranchEditor(branch) {
    setExpandedBranch(branch.id === expandedBranch ? null : branch.id);
    setBranchDraft({
      drive_folder_id: branch.drive_folder_id || "",
      latitude: branch.latitude ?? "",
      longitude: branch.longitude ?? "",
      geofence_radius_m: branch.geofence_radius_m ?? 150,
    });
  }

  async function saveBranchDetails(branch) {
    await supabase
      .from("branches")
      .update({
        drive_folder_id: branchDraft.drive_folder_id || null,
        latitude: branchDraft.latitude === "" ? null : Number(branchDraft.latitude),
        longitude: branchDraft.longitude === "" ? null : Number(branchDraft.longitude),
        geofence_radius_m: branchDraft.geofence_radius_m === "" ? 150 : Number(branchDraft.geofence_radius_m),
      })
      .eq("id", branch.id);
    setExpandedBranch(null);
    loadAll();
  }

  async function addBranch() {
    if (!newBranch) return;
    await supabase.from("branches").insert({ name: newBranch, is_active: true });
    setNewBranch("");
    loadAll();
  }

  async function addDeduction() {
    if (!newDeduction.name) return;
    await supabase.from("deduction_rules").insert({ name: newDeduction.name, value: newDeduction.value || 0, rule_type: "fixed" });
    setNewDeduction({ name: "", value: "" });
    loadAll();
  }

  async function updateDeductionValue(rule, value) {
    await supabase.from("deduction_rules").update({ value }).eq("id", rule.id);
    loadAll();
  }

  async function addExcuse() {
    if (!newExcuse.name) return;
    await supabase.from("excuse_rules").insert({ name: newExcuse.name, value: newExcuse.value || 0, rule_type: "fixed" });
    setNewExcuse({ name: "", value: "" });
    loadAll();
  }

  async function toggleUserActive(user) {
    await supabase.from("staff_profiles").update({ is_active: !user.is_active }).eq("id", user.id);
    loadAll();
  }

  async function toggleUserPermission(user, moduleKey) {
    const updated = { ...user.permissions, [moduleKey]: !user.permissions?.[moduleKey] };
    await supabase.from("staff_profiles").update({ permissions: updated }).eq("id", user.id);
    loadAll();
  }

  return (
    <div>
      <h1 style={{ color: theme.navy, marginBottom: 24 }}>Settings</h1>

      {!permsLoading && isAdmin && (
        <Section title="Drive Folder Name Review" subtitle="1,765 patients found with a similarly-named, unlinked Drive folder. Review and link the real matches.">
          <Link
            href="/dashboard/settings/drive-review"
            style={{
              display: "inline-block",
              padding: "10px 20px",
              borderRadius: 8,
              background: theme.navy,
              color: "#fff",
              fontWeight: 700,
              textDecoration: "none",
              fontSize: 13,
            }}
          >
            Review Matches
          </Link>
        </Section>
      )}

      {!permsLoading && isAdmin && (
        <Section title="Login As" subtitle="See exactly what any patient, doctor, employee, or staff member sees.">
          <Link
            href="/dashboard/settings/login-as"
            style={{
              display: "inline-block",
              padding: "10px 20px",
              borderRadius: 8,
              background: theme.navy,
              color: "#fff",
              fontWeight: 700,
              textDecoration: "none",
              fontSize: 13,
            }}
          >
            Open Login As
          </Link>
        </Section>
      )}

      {!permsLoading && isAdmin && (
        <Section title="Staff Users" subtitle="Admin only. Control which parts of the system each staff member can access.">
          {staffUsers.map((u) => (
            <div key={u.id} style={{ borderBottom: "1px solid #f0f0f0", padding: "12px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div>
                  <span style={{ color: theme.navy, fontWeight: 700 }}>{u.name}</span>
                  <span style={{ color: theme.gray, fontSize: 12, marginLeft: 8 }}>{u.email}</span>
                  {u.role === "admin" && (
                    <span style={{ marginLeft: 8, fontSize: 10, padding: "2px 8px", borderRadius: 999, background: theme.goldLight, color: theme.navy, fontWeight: 700 }}>ADMIN</span>
                  )}
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                  {u.is_active ? "Active" : "Disabled"}
                  <input type="checkbox" checked={u.is_active} onChange={() => toggleUserActive(u)} />
                </label>
              </div>
              {u.role !== "admin" && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {MODULES.map((m) => (
                    <button
                      key={m.key}
                      onClick={() => toggleUserPermission(u, m.key)}
                      style={{
                        padding: "4px 10px",
                        borderRadius: 999,
                        fontSize: 11,
                        border: `1px solid ${u.permissions?.[m.key] ? theme.gold : "#ddd"}`,
                        background: u.permissions?.[m.key] ? theme.goldLight : "#fff",
                        color: theme.navy,
                        cursor: "pointer",
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          <button onClick={() => setShowAddUser(true)} style={{ ...smallPrimary, marginTop: 12 }}>+ Add Staff User</button>
        </Section>
      )}

      <Section title="Branches">
        {branches.map((b) => (
          <div key={b.id} style={{ borderBottom: "1px solid #f0f0f0", paddingBottom: 10, marginBottom: 10 }}>
            <div style={{ ...row, border: "none", padding: 0 }}>
              <span style={{ color: theme.navy, fontWeight: 600 }}>{b.name}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <button onClick={() => openBranchEditor(b)} style={{ fontSize: 12, color: theme.gold, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
                  {expandedBranch === b.id ? "Close" : "Drive & Location"}
                </button>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  {b.is_active ? "Active" : "Inactive"}
                  <input type="checkbox" checked={b.is_active} onChange={() => toggleBranch(b)} />
                </label>
              </div>
            </div>
            {expandedBranch === b.id && (
              <div style={{ marginTop: 10, padding: 12, background: "#faf9fb", borderRadius: 8, display: "grid", gap: 8 }}>
                <div>
                  <span style={{ fontSize: 11, color: theme.gray }}>Drive folder ID for this branch (root for anything filed under it)</span>
                  <input
                    style={inp}
                    value={branchDraft.drive_folder_id}
                    onChange={(e) => setBranchDraft({ ...branchDraft, drive_folder_id: e.target.value })}
                    placeholder="Drive folder ID"
                  />
                  <p style={{ fontSize: 11, color: theme.gray, margin: "4px 0 0" }}>
                    Share this folder with elsherouk-drive-uploader@elsherouk-drive-integration.iam.gserviceaccount.com
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 11, color: theme.gray }}>Latitude</span>
                    <input style={inp} value={branchDraft.latitude} onChange={(e) => setBranchDraft({ ...branchDraft, latitude: e.target.value })} placeholder="30.0444" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 11, color: theme.gray }}>Longitude</span>
                    <input style={inp} value={branchDraft.longitude} onChange={(e) => setBranchDraft({ ...branchDraft, longitude: e.target.value })} placeholder="31.2357" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 11, color: theme.gray }}>Radius (m)</span>
                    <input style={inp} value={branchDraft.geofence_radius_m} onChange={(e) => setBranchDraft({ ...branchDraft, geofence_radius_m: e.target.value })} placeholder="150" />
                  </div>
                </div>
                <button onClick={() => saveBranchDetails(b)} style={{ ...smallPrimary, alignSelf: "flex-start" }}>Save</button>
              </div>
            )}
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input style={inp} value={newBranch} onChange={(e) => setNewBranch(e.target.value)} placeholder="New branch name" />
          <button onClick={addBranch} style={smallPrimary}>+ Add Branch</button>
        </div>
      </Section>

      <Section title="Deduction Rules">
        <p style={{ fontSize: 12, color: theme.gray, marginTop: -8 }}>
          Editing a rule's value here changes the next payslip generated for any employee assigned to it, no code change needed.
        </p>
        {deductionRules.map((r) => (
          <div key={r.id} style={row}>
            <span style={{ color: theme.navy, fontWeight: 600 }}>{r.name}</span>
            <input
              style={{ ...inp, width: 100, marginBottom: 0 }}
              defaultValue={r.value}
              onBlur={(e) => updateDeductionValue(r, e.target.value)}
            />
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input style={inp} value={newDeduction.name} onChange={(e) => setNewDeduction({ ...newDeduction, name: e.target.value })} placeholder="Rule name (e.g., Late Arrival)" />
          <input style={{ ...inp, width: 100 }} value={newDeduction.value} onChange={(e) => setNewDeduction({ ...newDeduction, value: e.target.value })} placeholder="EGP" />
          <button onClick={addDeduction} style={smallPrimary}>+ Add</button>
        </div>
      </Section>

      <Section title="Excuse / Absence Rules">
        {excuseRules.map((r) => (
          <div key={r.id} style={row}>
            <span style={{ color: theme.navy, fontWeight: 600 }}>{r.name}</span>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input style={inp} value={newExcuse.name} onChange={(e) => setNewExcuse({ ...newExcuse, name: e.target.value })} placeholder="Rule name (e.g., Sick Leave)" />
          <button onClick={addExcuse} style={smallPrimary}>+ Add</button>
        </div>
      </Section>

      {showAddUser && <AddUserModal onClose={() => setShowAddUser(false)} onSaved={loadAll} />}
    </div>
  );
}

function AddUserModal({ onClose, onSaved }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [permissions, setPermissions] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  function togglePerm(key) {
    setPermissions((p) => ({ ...p, [key]: !p[key] }));
  }

  async function handleSave() {
    if (!name || !email) {
      setError("Name and email are required.");
      return;
    }
    setSaving(true);
    setError("");
    const { data: session } = await supabase.auth.getSession();
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token}` },
      body: JSON.stringify({ name, email, permissions }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error || "Failed to create user");
      return;
    }
    setResult(data);
    onSaved();
  }

  if (result) {
    return (
      <Modal title="Staff User Created" onClose={onClose}>
        <p style={{ fontSize: 13, color: theme.gray }}>Share these credentials with {name}. This password is shown only once.</p>
        <div style={{ background: "#faf9fb", borderRadius: 8, padding: 12, fontSize: 13, marginBottom: 16 }}>
          <div><strong>Email:</strong> {result.email}</div>
          <div><strong>Temporary Password:</strong> {result.tempPassword}</div>
        </div>
        <button onClick={onClose} style={primaryBtn}>Done</button>
      </Modal>
    );
  }

  return (
    <Modal title="Add Staff User" onClose={onClose}>
      <FieldLabel>Full Name</FieldLabel>
      <input style={inp} value={name} onChange={(e) => setName(e.target.value)} />
      <FieldLabel>Email</FieldLabel>
      <input style={inp} value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
      <FieldLabel>Access Permissions</FieldLabel>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
        {MODULES.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => togglePerm(m.key)}
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              fontSize: 12,
              border: `1px solid ${permissions[m.key] ? theme.gold : "#ddd"}`,
              background: permissions[m.key] ? theme.goldLight : "#fff",
              color: theme.navy,
              cursor: "pointer",
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
      {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}
      <button onClick={handleSave} disabled={saving} style={primaryBtn}>{saving ? "Creating..." : "Create User"}</button>
    </Modal>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,11,56,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: 380 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: theme.navy }}>{title}</h3>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 18, cursor: "pointer", color: theme.gray }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
function FieldLabel({ children }) {
  return <label style={{ fontSize: 12, fontWeight: 600, color: theme.navy, display: "block", marginBottom: 6 }}>{children}</label>;
}

function Section({ title, subtitle, children }) {
  return (
    <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginBottom: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
      <h3 style={{ color: theme.navy, marginTop: 0, marginBottom: subtitle ? 4 : 16 }}>{title}</h3>
      {subtitle && <p style={{ fontSize: 12, color: theme.gray, marginTop: 0, marginBottom: 16 }}>{subtitle}</p>}
      {children}
    </div>
  );
}

const row = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f0f0f0" };
const inp = { flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box", marginBottom: 16, width: "100%" };
const smallPrimary = { padding: "0 16px", height: 36, borderRadius: 8, border: "none", background: "#27214D", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 13 };
const primaryBtn = { width: "100%", padding: "12px 0", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer" };
