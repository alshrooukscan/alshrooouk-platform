"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";

export default function PurchaseOrdersPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [balances, setBalances] = useState({});
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [entries, setEntries] = useState([]);
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data: s } = await supabase.from("suppliers").select("*").order("name");
    const { data: b } = await supabase.rpc("get_supplier_balances");
    setSuppliers(s || []);
    const balMap = {};
    (b || []).forEach((row) => (balMap[row.supplier_id] = Number(row.balance)));
    setBalances(balMap);
    setLoading(false);
  }

  async function openSupplier(supplier) {
    setSelectedSupplier(supplier);
    const { data } = await supabase
      .from("purchase_orders")
      .select("*")
      .eq("supplier_id", supplier.id)
      .order("entry_date", { ascending: false });
    setEntries(data || []);
  }

  const totalOwed = Object.values(balances).reduce((s, b) => s + (b > 0 ? b : 0), 0);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 12, color: theme.gray }}>
            <Link href="/dashboard/stock" style={{ color: theme.gray }}>Stock</Link> &gt; Purchase Orders
          </p>
          <h1 style={{ color: theme.navy, margin: "4px 0" }}>Purchase Orders</h1>
          <p style={{ color: theme.gray, margin: 0 }}>
            Supplier debt ledger. A purchase adds to what we owe, a payment reduces it.
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, color: theme.gray }}>TOTAL OWED TO SUPPLIERS</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: totalOwed > 0 ? "#ba1a1a" : theme.navy }}>{totalOwed.toFixed(2)} EGP</div>
        </div>
      </div>

      <button onClick={() => setShowAddSupplier(true)} style={outlineBtn}>+ Add Supplier</button>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 20, marginTop: 20 }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Suppliers</h3>
          {loading && <p style={{ color: theme.gray, fontSize: 13 }}>Loading...</p>}
          {!loading && suppliers.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>No suppliers yet, add one above.</p>}
          {suppliers.map((s) => {
            const bal = balances[s.id] || 0;
            const active = selectedSupplier?.id === s.id;
            return (
              <div
                key={s.id}
                onClick={() => openSupplier(s)}
                style={{
                  padding: "12px 10px",
                  borderRadius: 8,
                  cursor: "pointer",
                  background: active ? theme.goldLight : "transparent",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 4,
                }}
              >
                <span style={{ color: theme.navy, fontWeight: 600 }}>{s.name}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: bal > 0 ? "#ba1a1a" : bal < 0 ? "#2e7d32" : theme.gray }}>
                  {bal.toFixed(2)} EGP
                </span>
              </div>
            );
          })}
        </div>

        <div style={{ background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          {!selectedSupplier && <p style={{ color: theme.gray, fontSize: 13 }}>Select a supplier to see their purchase/payment history.</p>}
          {selectedSupplier && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h3 style={{ color: theme.navy, margin: 0 }}>{selectedSupplier.name}</h3>
                <button onClick={() => setShowAddEntry(true)} style={smallPrimary}>+ Add Entry</button>
              </div>
              {entries.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>No entries yet.</p>}
              {entries.map((e) => (
                <div key={e.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f0f0f0", fontSize: 13 }}>
                  <div>
                    <span style={{ fontWeight: 600, color: theme.navy, textTransform: "capitalize" }}>{e.entry_type}</span>
                    {e.description && <span style={{ color: theme.gray }}> &middot; {e.description}</span>}
                    <div style={{ fontSize: 11, color: theme.gray }}>{e.entry_date}</div>
                  </div>
                  <span style={{ fontWeight: 700, color: e.amount > 0 ? "#ba1a1a" : "#2e7d32" }}>
                    {e.amount > 0 ? "+" : ""}{Number(e.amount).toFixed(2)} EGP
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {showAddSupplier && <AddSupplierModal onClose={() => setShowAddSupplier(false)} onSaved={load} />}
      {showAddEntry && selectedSupplier && (
        <AddEntryModal
          supplier={selectedSupplier}
          onClose={() => setShowAddEntry(false)}
          onSaved={() => {
            load();
            openSupplier(selectedSupplier);
          }}
        />
      )}
    </div>
  );
}

function AddSupplierModal({ onClose, onSaved }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name) return;
    setSaving(true);
    await supabase.from("suppliers").insert({ name, phone });
    setSaving(false);
    onSaved();
    onClose();
  }

  return (
    <Modal title="Add Supplier" onClose={onClose}>
      <FieldLabel>Supplier Name</FieldLabel>
      <input style={inp} value={name} onChange={(e) => setName(e.target.value)} />
      <FieldLabel>Phone (optional)</FieldLabel>
      <input style={inp} value={phone} onChange={(e) => setPhone(e.target.value)} />
      <button onClick={handleSave} disabled={saving} style={primaryBtn}>{saving ? "Saving..." : "Add Supplier"}</button>
    </Modal>
  );
}

function AddEntryModal({ supplier, onClose, onSaved }) {
  const [type, setType] = useState("purchase");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!amount) return;
    setSaving(true);
    // purchase = positive (debt owed), payment = negative (reduces debt)
    const signedAmount = type === "purchase" ? Math.abs(Number(amount)) : -Math.abs(Number(amount));
    await supabase.from("purchase_orders").insert({
      supplier_id: supplier.id,
      amount: signedAmount,
      entry_type: type,
      description,
      entry_date: date,
    });
    setSaving(false);
    onSaved();
    onClose();
  }

  return (
    <Modal title={`Add Entry — ${supplier.name}`} onClose={onClose}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[
          { key: "purchase", label: "Purchase (we owe)" },
          { key: "payment", label: "Payment (we paid)" },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setType(t.key)}
            style={{
              flex: 1,
              padding: "8px 0",
              borderRadius: 8,
              border: `1px solid ${type === t.key ? theme.gold : "#ddd"}`,
              background: type === t.key ? theme.goldLight : "#fff",
              color: theme.navy,
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <FieldLabel>Amount (EGP)</FieldLabel>
      <input style={inp} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
      <FieldLabel>Description (optional)</FieldLabel>
      <input style={inp} value={description} onChange={(e) => setDescription(e.target.value)} />
      <FieldLabel>Date</FieldLabel>
      <input type="date" style={inp} value={date} onChange={(e) => setDate(e.target.value)} />
      <button onClick={handleSave} disabled={saving} style={primaryBtn}>{saving ? "Saving..." : "Save Entry"}</button>
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

const inp = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box", marginBottom: 16 };
const primaryBtn = { width: "100%", padding: "12px 0", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer" };
const outlineBtn = { padding: "10px 20px", borderRadius: 8, border: `1px solid ${theme.navy}`, background: "#fff", color: theme.navy, fontWeight: 600, cursor: "pointer", fontSize: 13 };
const smallPrimary = { padding: "6px 14px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 12 };
