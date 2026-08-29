"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { theme } from "../../../lib/theme";
import { resolveUniqueUsername } from "../../../lib/uniqueUsername";

// Real, external clients only - the branch-named pseudo-clients used to
// attribute internal report requests are deliberately hidden here, since
// there's nothing for an admin to manage about them.
export default function ClientsPage() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [createdAccount, setCreatedAccount] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("clients").select("*").eq("is_pseudo", false).order("created_at", { ascending: false });
    setClients(data || []);
    setLoading(false);
  }

  async function handleAdd() {
    if (!name.trim()) {
      setError("Enter a client name.");
      return;
    }
    setSaving(true);
    setError("");
    const { data, error: err } = await supabase
      .from("clients")
      .insert({ name: name.trim(), contact_phone: phone || null, contact_email: email || null })
      .select("id")
      .single();
    if (err) {
      setSaving(false);
      setError(err.message);
      return;
    }
    const baseUsername = phone.replace(/\D/g, "") || name.toLowerCase().replace(/\s+/g, "");
    const username = await resolveUniqueUsername(supabase, "clients", baseUsername);
    const { data: pwd } = await supabase.rpc("create_client_credentials", { p_client_id: data.id, p_username: username });
    setSaving(false);
    setCreatedAccount({ username, password: pwd, name: name.trim() });
    setName("");
    setPhone("");
    setEmail("");
    setShowAdd(false);
    load();
  }

  return (
    <div>
      <h1 style={{ color: theme.navy, margin: "0 0 4px" }}>Clients Management</h1>
      <p style={{ color: theme.gray, margin: "0 0 24px" }}>External clients who log in to their own portal, upload requests, and see the status of past ones.</p>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ color: theme.navy, margin: 0 }}>All Clients</h3>
          <button onClick={() => setShowAdd((v) => !v)} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: theme.gold, color: theme.navy, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
            {showAdd ? "Cancel" : "+ Add Client"}
          </button>
        </div>

        {showAdd && (
          <div style={{ background: "#faf9fb", borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <label style={lbl}>Name</label>
            <input style={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="Client or company name" />
            <label style={lbl}>Contact Phone</label>
            <input style={inp} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01xxxxxxxxx" />
            <label style={lbl}>Contact Email (optional)</label>
            <input style={inp} value={email} onChange={(e) => setEmail(e.target.value)} />
            {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}
            <button onClick={handleAdd} disabled={saving} style={{ marginTop: 8, padding: "10px 20px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
              {saving ? "Creating..." : "Create Client & Generate Login"}
            </button>
          </div>
        )}

        {!loading && clients.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>No clients yet.</p>}
        <div style={{ display: "grid", gap: 8 }}>
          {clients.map((c) => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f0f0f0" }}>
              <div>
                <div style={{ fontWeight: 700, color: theme.navy, fontSize: 14 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: theme.gray }}>
                  {c.contact_phone && `${c.contact_phone} \u00b7 `}Username: {c.username || "not set"}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {createdAccount && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(18,11,56,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 26, width: 360 }}>
            <h3 style={{ marginTop: 0, color: theme.navy }}>Client Account Created</h3>
            <p style={{ fontSize: 13, color: theme.gray }}>Share these with {createdAccount.name} - shown only once.</p>
            <div style={{ background: "#faf9fb", borderRadius: 8, padding: 14, fontSize: 14 }}>
              <div><strong>Username:</strong> {createdAccount.username}</div>
              <div><strong>Password:</strong> {createdAccount.password}</div>
            </div>
            <button onClick={() => setCreatedAccount(null)} style={{ marginTop: 16, width: "100%", padding: "10px 0", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const lbl = { display: "block", fontSize: 11, color: "#48464E", fontWeight: 600, marginBottom: 4, marginTop: 10 };
const inp = { width: "100%", padding: "9px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, boxSizing: "border-box" };
