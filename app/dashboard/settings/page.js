"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { theme } from "../../../lib/theme";

export default function SettingsPage() {
  const [branches, setBranches] = useState([]);
  const [deductionRules, setDeductionRules] = useState([]);
  const [excuseRules, setExcuseRules] = useState([]);
  const [newBranch, setNewBranch] = useState("");
  const [newDeduction, setNewDeduction] = useState({ name: "", value: "" });
  const [newExcuse, setNewExcuse] = useState({ name: "", value: "" });

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    const { data: b } = await supabase.from("branches").select("*").order("created_at");
    const { data: d } = await supabase.from("deduction_rules").select("*").order("created_at");
    const { data: e } = await supabase.from("excuse_rules").select("*").order("created_at");
    setBranches(b || []);
    setDeductionRules(d || []);
    setExcuseRules(e || []);
  }

  async function toggleBranch(branch) {
    await supabase.from("branches").update({ is_active: !branch.is_active }).eq("id", branch.id);
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

  return (
    <div>
      <h1 style={{ color: theme.navy, marginBottom: 24 }}>Settings</h1>

      <Section title="Branches">
        {branches.map((b) => (
          <div key={b.id} style={row}>
            <span style={{ color: theme.navy, fontWeight: 600 }}>{b.name}</span>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              {b.is_active ? "Active" : "Inactive"}
              <input type="checkbox" checked={b.is_active} onChange={() => toggleBranch(b)} />
            </label>
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

const row = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f0f0f0" };
const inp = { flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box" };
const smallPrimary = { padding: "0 16px", borderRadius: 8, border: "none", background: "#27214D", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 13 };
