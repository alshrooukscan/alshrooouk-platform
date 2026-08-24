"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import { formatMoney } from "../../../../lib/format";
import { exportToCsv } from "../../../../lib/exportCsv";

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
            <Link href="/dashboard/stock/dental" style={{ color: theme.gray }}>Inventory Management</Link> &gt; Purchase Orders
          </p>
          <h1 style={{ color: theme.navy, margin: "4px 0" }}>Purchase Orders</h1>
          <p style={{ color: theme.gray, margin: 0 }}>
            Supplier debt ledger. A purchase adds to what we owe, a payment reduces it.
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, color: theme.gray }}>TOTAL OWED TO SUPPLIERS</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: totalOwed > 0 ? "#ba1a1a" : theme.navy }}>{formatMoney(totalOwed, { decimals: 2 })} EGP</div>
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
                  {formatMoney(bal, { decimals: 2 })} EGP
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
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => exportToCsv(`${selectedSupplier.name}-ledger.csv`, entries.map((e) => ({ Date: e.entry_date, Type: e.entry_type, "PO Number": e.po_number || "", Description: e.description || "", Amount: e.amount })))}
                    style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontWeight: 600, fontSize: 12, cursor: "pointer" }}
                  >
                    Export CSV
                  </button>
                  <button onClick={() => setShowAddEntry(true)} style={smallPrimary}>+ Add Entry</button>
                </div>
              </div>
              {entries.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>No entries yet.</p>}
              {entries.map((e) => (
                <div key={e.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f0f0f0", fontSize: 13 }}>
                  <div>
                    <span style={{ fontWeight: 600, color: theme.navy, textTransform: "capitalize" }}>
                      {e.entry_type}{e.po_number ? ` — PO-${e.po_number}` : ""}
                    </span>
                    {e.description && <span style={{ color: theme.gray }}> &middot; {e.description}</span>}
                    <div style={{ fontSize: 11, color: theme.gray }}>{e.entry_date}</div>
                  </div>
                  <span style={{ fontWeight: 700, color: e.amount > 0 ? "#ba1a1a" : "#2e7d32" }}>
                    {e.amount > 0 ? "+" : ""}{formatMoney(e.amount, { decimals: 2 })} EGP
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
  const [assignedPoNumber, setAssignedPoNumber] = useState(null);

  const [stockItems, setStockItems] = useState([]);
  const [lineItems, setLineItems] = useState([{ mode: "existing", itemId: "", newName: "", newCategory: "dental", qty: "", unitPrice: "" }]);

  useEffect(() => {
    if (type === "purchase") {
      supabase.from("stock_items").select("id, name, item_code, category, purchase_price").order("name").then(({ data }) => setStockItems(data || []));
    }
  }, [type]);

  const lineItemsTotal = lineItems.reduce((sum, li) => sum + (Number(li.qty) || 0) * (Number(li.unitPrice) || 0), 0);
  const useLineItems = type === "purchase" && lineItems.some((li) => (li.mode === "existing" && li.itemId) || (li.mode === "new" && li.newName));

  function updateLine(idx, field, value) {
    setLineItems((prev) => prev.map((li, i) => (i === idx ? { ...li, [field]: value } : li)));
  }
  function addLine() {
    setLineItems((prev) => [...prev, { mode: "existing", itemId: "", newName: "", newCategory: "dental", qty: "", unitPrice: "" }]);
  }
  function removeLine(idx) {
    setLineItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    const finalAmount = useLineItems ? lineItemsTotal : Number(amount);
    if (!finalAmount) return;
    setSaving(true);

    // Apply real inventory changes for each line item. Purchased on credit doesn't hit
    // cash_ledger here, only the supplier debt ledger, cash_ledger reflects it later
    // when an actual payment entry is recorded, avoiding double-counting.
    if (useLineItems) {
      for (const li of lineItems) {
        const qty = Number(li.qty) || 0;
        const unitPrice = Number(li.unitPrice) || 0;
        if (!qty) continue;

        if (li.mode === "existing" && li.itemId) {
          const { data: fresh } = await supabase.from("stock_items").select("qty_remaining").eq("id", li.itemId).single();
          await supabase
            .from("stock_items")
            .update({ qty_remaining: (fresh?.qty_remaining || 0) + qty, purchase_price: unitPrice || undefined })
            .eq("id", li.itemId);
        } else if (li.mode === "new" && li.newName) {
          const code = `${li.newCategory === "dental" ? "DEN" : "EL"}-${Date.now().toString().slice(-5)}`;
          await supabase.from("stock_items").insert({
            category: li.newCategory,
            item_code: code,
            name: li.newName,
            purchase_price: unitPrice,
            qty_remaining: qty,
          });
        }
      }
    }

    const signedAmount = type === "purchase" ? Math.abs(finalAmount) : -Math.abs(finalAmount);
    let poNumber = null;
    if (type === "purchase") {
      const { data } = await supabase.rpc("next_po_number");
      poNumber = data;
    }

    const itemsSummary = useLineItems
      ? lineItems
          .filter((li) => (li.mode === "existing" && li.itemId) || (li.mode === "new" && li.newName))
          .map((li) => {
            const name = li.mode === "existing" ? stockItems.find((s) => s.id === li.itemId)?.name : li.newName;
            return `${name} x${li.qty}`;
          })
          .join(", ")
      : null;

    await supabase.from("purchase_orders").insert({
      supplier_id: supplier.id,
      amount: signedAmount,
      entry_type: type,
      description: description || itemsSummary,
      entry_date: date,
      po_number: poNumber,
    });
    setSaving(false);
    if (poNumber) setAssignedPoNumber(poNumber);
    onSaved();
    if (!poNumber) onClose();
  }

  if (assignedPoNumber) {
    return (
      <Modal title="Purchase Order Created" onClose={onClose}>
        <p style={{ fontSize: 14, color: theme.gray }}>Assigned automatically, continuing from the last PO on file. Inventory has been updated for any items added.</p>
        <div style={{ fontSize: 28, fontWeight: 700, color: theme.navy, textAlign: "center", padding: "16px 0" }}>PO-{assignedPoNumber}</div>
        <button onClick={onClose} style={primaryBtn}>Done</button>
      </Modal>
    );
  }

  return (
    <Modal title={`Add Entry — ${supplier.name}`} onClose={onClose} wide={type === "purchase"}>
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

      {type === "purchase" ? (
        <>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 12 }}>
            Select items from your current stock, or add a new item on the fly for either Dental or El3awama. Quantities update inventory immediately. A PO number is assigned automatically.
          </p>
          {lineItems.map((li, idx) => (
            <div key={idx} style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <button type="button" onClick={() => updateLine(idx, "mode", "existing")} style={{ ...miniToggle, ...(li.mode === "existing" ? miniToggleActive : {}) }}>Existing Item</button>
                <button type="button" onClick={() => updateLine(idx, "mode", "new")} style={{ ...miniToggle, ...(li.mode === "new" ? miniToggleActive : {}) }}>Add New Item</button>
                {lineItems.length > 1 && (
                  <button type="button" onClick={() => removeLine(idx)} style={{ marginLeft: "auto", border: "none", background: "none", color: "#ba1a1a", cursor: "pointer", fontSize: 12 }}>Remove</button>
                )}
              </div>

              {li.mode === "existing" ? (
                <select value={li.itemId} onChange={(e) => updateLine(idx, "itemId", e.target.value)} style={{ ...inp, marginBottom: 8 }}>
                  <option value="">Select item...</option>
                  {stockItems.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.category}, {s.item_code})</option>
                  ))}
                </select>
              ) : (
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input placeholder="New item name" value={li.newName} onChange={(e) => updateLine(idx, "newName", e.target.value)} style={{ ...inp, marginBottom: 0, flex: 2 }} />
                  <select value={li.newCategory} onChange={(e) => updateLine(idx, "newCategory", e.target.value)} style={{ ...inp, marginBottom: 0, flex: 1 }}>
                    <option value="dental">Dental</option>
                    <option value="el3awama">El3awama</option>
                  </select>
                </div>
              )}

              <div style={{ display: "flex", gap: 8 }}>
                <input type="number" placeholder="Qty" value={li.qty} onChange={(e) => updateLine(idx, "qty", e.target.value)} style={{ ...inp, marginBottom: 0 }} />
                <input type="number" placeholder="Unit Price (EGP)" value={li.unitPrice} onChange={(e) => updateLine(idx, "unitPrice", e.target.value)} style={{ ...inp, marginBottom: 0 }} />
              </div>
            </div>
          ))}
          <button type="button" onClick={addLine} style={{ ...outlineBtn, marginBottom: 16, fontSize: 12, padding: "6px 14px" }}>+ Add Another Item</button>

          {useLineItems && (
            <div style={{ background: "#faf9fb", borderRadius: 8, padding: 12, marginBottom: 16, display: "flex", justifyContent: "space-between", fontWeight: 700, color: theme.navy }}>
              <span>Total</span>
              <span>{lineItemsTotal.toFixed(2)} EGP</span>
            </div>
          )}

          {!useLineItems && (
            <>
              <FieldLabel>Or just enter a total amount (no items)</FieldLabel>
              <input style={inp} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </>
          )}
        </>
      ) : (
        <>
          <FieldLabel>Amount (EGP)</FieldLabel>
          <input style={inp} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </>
      )}

      <FieldLabel>Description (optional)</FieldLabel>
      <input style={inp} value={description} onChange={(e) => setDescription(e.target.value)} />
      <FieldLabel>Date</FieldLabel>
      <input type="date" style={inp} value={date} onChange={(e) => setDate(e.target.value)} />
      <button onClick={handleSave} disabled={saving} style={primaryBtn}>{saving ? "Saving..." : "Save Entry"}</button>
    </Modal>
  );
}

function Modal({ title, children, onClose, wide }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,11,56,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: wide ? 480 : 380, maxHeight: "88vh", overflowY: "auto" }}>
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
const miniToggle = { padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontSize: 11, cursor: "pointer" };
const miniToggleActive = { border: `1px solid ${theme.gold}`, background: theme.goldLight, fontWeight: 700 };
