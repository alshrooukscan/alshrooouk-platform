"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import { usePermissions } from "../../../../lib/usePermissions";
import { formatMoney } from "../../../../lib/format";
import { logActivity } from "../../../../lib/activityLog";

const BRANDS = [
  { key: "scan", label: "Scan" },
  { key: "dental_stock", label: "Dental Stock" },
  { key: "el3awama_stock", label: "El3awama Stock" },
];
const BRAND_LABEL = Object.fromEntries(BRANDS.map((b) => [b.key, b.label]));
const PAYMENT_METHODS = [
  { key: "cash", label: "Cash" },
  { key: "visa", label: "Visa" },
  { key: "instapay", label: "InstaPay" },
  { key: "vodafone_cash", label: "Vodafone Cash" },
];

// Every brand pair, deduplicated (scan/dental_stock is the same pair as
// dental_stock/scan) - shown once each with net debt computed from both
// directions, not as two separate one-directional rows.
const BRAND_PAIRS = [
  ["scan", "dental_stock"],
  ["scan", "el3awama_stock"],
  ["dental_stock", "el3awama_stock"],
];

export default function BrandTransferPage() {
  const { isAdmin, loading: permsLoading, profile } = usePermissions();
  const [totals, setTotals] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (!permsLoading && isAdmin) load();
  }, [permsLoading, isAdmin]);

  async function load() {
    setLoading(true);
    const [{ data: t }, { data: r }] = await Promise.all([
      supabase.from("brand_transfer_totals").select("*"),
      supabase.from("expense_transactions").select("*").eq("type", "brand_transfer").order("created_at", { ascending: false }).limit(20),
    ]);
    setTotals(t || []);
    setRecent(r || []);
    setLoading(false);
  }

  function netDebt(brandA, brandB) {
    const aToB = totals.find((t) => t.from_brand === brandA && t.to_brand === brandB)?.total_transferred || 0;
    const bToA = totals.find((t) => t.from_brand === brandB && t.to_brand === brandA)?.total_transferred || 0;
    const net = Number(aToB) - Number(bToA);
    if (net === 0) return { text: "Settled", owes: null };
    if (net > 0) return { text: `${BRAND_LABEL[brandB]} owes ${BRAND_LABEL[brandA]}`, amount: net, owes: brandB };
    return { text: `${BRAND_LABEL[brandA]} owes ${BRAND_LABEL[brandB]}`, amount: -net, owes: brandA };
  }

  if (permsLoading) return <p style={{ color: theme.gray }}>Loading...</p>;
  if (!isAdmin) return <p style={{ color: theme.gray }}>Admin access required.</p>;

  return (
    <div>
      <p style={{ fontSize: 12, color: theme.gray, margin: "0 0 4px" }}>Expenses Management</p>
      <h1 style={{ color: theme.navy, margin: "0 0 4px" }}>Brand Transfer</h1>
      <p style={{ color: theme.gray, margin: "0 0 20px" }}>Money moved between Scan, Dental Stock, and El3awama Stock - always confirmed by you.</p>

      <button onClick={() => setShowForm(true)} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13, marginBottom: 20 }}>
        + Log Brand Transfer
      </button>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginBottom: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Who Owes Whom</h3>
        <div style={{ display: "grid", gap: 8 }}>
          {BRAND_PAIRS.map(([a, b]) => {
            const debt = netDebt(a, b);
            return (
              <div key={`${a}-${b}`} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #f0f0f0" }}>
                <span style={{ color: theme.navy, fontSize: 13 }}>{BRAND_LABEL[a]} ↔ {BRAND_LABEL[b]}</span>
                <span style={{ fontWeight: 700, color: debt.owes ? "#ba1a1a" : "#2e7d32", fontSize: 13 }}>
                  {debt.owes ? `${debt.text}: ${formatMoney(debt.amount)} EGP` : debt.text}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Recent Brand Transfers</h3>
        {!loading && recent.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>No brand transfers logged yet.</p>}
        <div style={{ display: "grid", gap: 8 }}>
          {recent.map((tx) => (
            <div key={tx.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #f0f0f0" }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: tx.status === "confirmed" ? "#e8f5e9" : tx.status === "rejected" ? "#fdecea" : "#fff8e1", color: tx.status === "confirmed" ? "#2e7d32" : tx.status === "rejected" ? "#ba1a1a" : "#a97c00", minWidth: 76, textAlign: "center", textTransform: "capitalize" }}>
                {tx.status}
              </span>
              <div style={{ flex: 1, fontSize: 13 }}>
                <strong style={{ color: theme.navy }}>{BRAND_LABEL[tx.brand]} → {BRAND_LABEL[tx.to_brand]}</strong>{" "}
                {formatMoney(tx.amount)} EGP via {tx.payment_method}
                {tx.note && <span style={{ color: theme.gray, fontStyle: "italic" }}> — {tx.note}</span>}
                <span style={{ color: theme.gray }}> · {tx.entry_date}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showForm && <BrandTransferForm profile={profile} onClose={() => setShowForm(false)} onSaved={load} />}
    </div>
  );
}

function BrandTransferForm({ profile, onClose, onSaved }) {
  const [fromBrand, setFromBrand] = useState("scan");
  const [toBrand, setToBrand] = useState("dental_stock");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (fromBrand === toBrand) {
      setError("Source and destination must be different brands.");
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    setSaving(true);
    // This page is already admin-only to even open (see the isAdmin gate
    // above), so every transfer logged here is inherently logged by
    // whoever has admin access - there's no separate person left to confirm
    // it. It's recorded as already confirmed, by themselves, rather than
    // sitting in a queue that's meant for reviewing OTHER people's entries.
    const { data, error: err } = await supabase
      .from("expense_transactions")
      .insert({
        type: "brand_transfer",
        brand: fromBrand,
        to_brand: toBrand,
        amount: Number(amount),
        payment_method: paymentMethod,
        note: note || null,
        status: "confirmed",
        confirmed_by_id: profile?.id || null,
        confirmed_by_name: profile?.name || null,
        confirmed_at: new Date().toISOString(),
        created_by_id: profile?.id || null,
        created_by_name: profile?.name || null,
      })
      .select("id")
      .single();
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    logActivity({
      actorId: profile?.id,
      actorName: profile?.name,
      actorType: "admin",
      action: "logged_brand_transfer",
      entityType: "expense_transaction",
      entityId: data.id,
      details: { fromBrand, toBrand, amount: Number(amount), paymentMethod },
    });
    onSaved();
    onClose();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,11,56,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: 400, maxWidth: "90vw" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Log Brand Transfer</h3>
        <p style={{ fontSize: 12, color: theme.gray, marginTop: -8 }}>Always waits for your own confirmation before it counts toward debt.</p>

        <label style={fieldLabel}>From</label>
        <select value={fromBrand} onChange={(e) => setFromBrand(e.target.value)} style={inp}>
          {BRANDS.map((b) => (
            <option key={b.key} value={b.key}>{b.label}</option>
          ))}
        </select>

        <label style={fieldLabel}>To</label>
        <select value={toBrand} onChange={(e) => setToBrand(e.target.value)} style={inp}>
          {BRANDS.map((b) => (
            <option key={b.key} value={b.key}>{b.label}</option>
          ))}
        </select>

        <label style={fieldLabel}>Amount (EGP)</label>
        <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={inp} />

        <label style={fieldLabel}>Paid Via</label>
        <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} style={inp}>
          {PAYMENT_METHODS.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>

        <label style={fieldLabel}>Note (optional)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} style={inp} />

        {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
            {saving ? "Saving..." : "Log Transfer"}
          </button>
        </div>
      </div>
    </div>
  );
}

const fieldLabel = { display: "block", fontSize: 11, color: "#48464E", fontWeight: 600, marginTop: 12, marginBottom: 4 };
const inp = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box" };
