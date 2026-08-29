"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabase";
import { theme } from "../lib/theme";
import { formatMoney } from "../lib/format";
import { exportToCsv } from "../lib/exportCsv";

// One dedicated page per stock category (Dental, El3awama) - no in-page toggle,
// each is its own real route matching its own sidebar entry.
export default function StockCategoryPage({ category, title }) {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showTxn, setShowTxn] = useState(null); // item being transacted on
  const [showCount, setShowCount] = useState(null); // item being counted
  const [editingImageId, setEditingImageId] = useState(null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("stock_items")
      .select("*, stock_counts(physical_qty, expected_qty, variance, counted_at)")
      .eq("category", category)
      .order("name");
    setItems(data || []);
    setLoading(false);
  }

  const filtered = items.filter(
    (i) => i.name?.toLowerCase().includes(query.toLowerCase()) || i.item_code?.toLowerCase().includes(query.toLowerCase())
  );

  const totalValue = items.reduce((sum, i) => sum + (i.qty_remaining || 0) * (i.purchase_price || 0), 0);
  const lowStockCount = items.filter((i) => (i.qty_remaining || 0) <= 5).length;

  function latestVariance(item) {
    if (!item.stock_counts || item.stock_counts.length === 0) return null;
    const sorted = [...item.stock_counts].sort((a, b) => new Date(b.counted_at) - new Date(a.counted_at));
    return sorted[0];
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 12, color: theme.gray, margin: "0 0 4px" }}>
            <Link href="/dashboard/stock/dental" style={{ color: theme.gray }}>Inventory Management</Link> &gt; {title}
          </p>
          <h1 style={{ color: theme.navy, margin: 0 }}>{title}</h1>
        </div>
        <div style={{ display: "flex", gap: 24, textAlign: "right" }}>
          <div>
            <div style={{ fontSize: 11, color: theme.gray }}>TOTAL VALUE</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: theme.navy }}>{formatMoney(totalValue)} EGP</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: theme.gray }}>LOW STOCK ITEMS</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: lowStockCount > 0 ? "#ba1a1a" : theme.navy }}>{lowStockCount}</div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search item name or code..."
          style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14 }}
        />
        <button
          onClick={() => exportToCsv(`stock-${category}.csv`, filtered.map((i) => ({ Item: i.name, Code: i.item_code, "Qty Remaining": i.qty_remaining ?? 0, "Purchase Price": i.purchase_price ?? "", "Sale Price": i.sale_price ?? "" })))}
          style={outlineBtn}
        >
          Export CSV
        </button>
        <button onClick={() => setShowAddItem(true)} style={outlineBtn}>+ Add Item</button>
        <Link href="/dashboard/stock/purchase-orders" style={{ ...outlineBtn, textDecoration: "none", display: "flex", alignItems: "center" }}>Purchase Orders</Link>
      </div>

      <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#faf9fb", textAlign: "left" }}>
              {category === "dental" && <Th>Image</Th>}
              <Th>Item</Th>
              <Th>Code</Th>
              <Th>Qty Remaining</Th>
              <Th>Purchase Price</Th>
              <Th>Sale Price</Th>
              <Th>Profit</Th>
              <Th>Variance</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const profit = (item.sale_price || 0) - (item.purchase_price || 0);
              const profitPct = item.purchase_price ? ((profit / item.purchase_price) * 100).toFixed(0) : "\u2014";
              const variance = latestVariance(item);
              return (
                <tr key={item.id} style={{ borderTop: "1px solid #f0f0f0" }}>
                  {category === "dental" && (
                    <Td>
                      <div
                        onClick={() => setEditingImageId(item.id)}
                        style={{ width: 40, height: 40, borderRadius: 6, background: "#f0f0f0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}
                        title="Click to change image"
                      >
                        {item.image_url ? (
                          <img src={item.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          <span style={{ fontSize: 9, color: "#bbb" }}>+ Add</span>
                        )}
                      </div>
                    </Td>
                  )}
                  <Td>{item.name}</Td>
                  <Td>{item.item_code}</Td>
                  <Td>
                    <span style={{ fontWeight: 700, color: (item.qty_remaining || 0) <= 5 ? "#ba1a1a" : theme.navy }}>
                      {item.qty_remaining ?? 0}
                    </span>
                  </Td>
                  <Td>{item.purchase_price != null ? formatMoney(item.purchase_price) : "\u2014"}</Td>
                  <Td>{item.sale_price != null ? formatMoney(item.sale_price) : "\u2014"}</Td>
                  <Td>{item.purchase_price ? `${formatMoney(profit)} (${profitPct}%)` : "\u2014"}</Td>
                  <Td>
                    {variance ? (
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: 999,
                          fontSize: 11,
                          background: variance.variance === 0 ? "#e8f5e9" : "#fdecea",
                          color: variance.variance === 0 ? "#2e7d32" : "#ba1a1a",
                        }}
                      >
                        {variance.variance > 0 ? "+" : ""}{variance.variance}
                      </span>
                    ) : (
                      <span style={{ color: "#bbb" }}>—</span>
                    )}
                  </Td>
                  <Td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => setShowTxn(item)} style={smallBtn}>Transaction</button>
                      <button onClick={() => setShowCount(item)} style={smallBtn}>Count</button>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && filtered.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: theme.gray }}>No items yet in {title}.</div>
        )}
      </div>

      <button
        onClick={() => setShowAddItem(true)}
        style={{
          position: "fixed",
          bottom: 32,
          right: 32,
          padding: "14px 24px",
          borderRadius: 999,
          border: "none",
          background: `linear-gradient(135deg, ${theme.gold}, ${theme.goldLight})`,
          color: theme.navy,
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: "0 8px 24px rgba(169,139,77,0.4)",
        }}
      >
        + Add Transaction
      </button>

      {showAddItem && <AddItemModal category={category} title={title} onClose={() => setShowAddItem(false)} onSaved={load} />}
      {showTxn && <TransactionModal item={showTxn} onClose={() => setShowTxn(null)} onSaved={load} />}
      {showCount && <CountModal item={showCount} onClose={() => setShowCount(null)} onSaved={load} />}
      {editingImageId && (
        <ImageUploadModal
          item={items.find((i) => i.id === editingImageId)}
          onClose={() => setEditingImageId(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

function ImageUploadModal({ item, onClose, onSaved }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    const ext = file.name.split(".").pop();
    const path = `${item.id}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("stock-item-images").upload(path, file, { upsert: true });
    if (upErr) {
      setUploading(false);
      setError(upErr.message);
      return;
    }
    const { data: pub } = supabase.storage.from("stock-item-images").getPublicUrl(path);
    await supabase.from("stock_items").update({ image_url: pub.publicUrl }).eq("id", item.id);
    setUploading(false);
    onSaved();
    onClose();
  }

  return (
    <Modal title={`Image – ${item.name}`} onClose={onClose}>
      {item.image_url && (
        <img src={item.image_url} alt="" style={{ width: "100%", maxHeight: 200, objectFit: "cover", borderRadius: 8, marginBottom: 12 }} />
      )}
      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFile} disabled={uploading} />
      {uploading && <p style={{ fontSize: 12, color: theme.gray }}>Uploading...</p>}
      {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}
      <p style={{ fontSize: 11, color: theme.gray, marginTop: 10 }}>
        Shown both here and on the card doctors see when browsing Dental Stock in their portal.
      </p>
    </Modal>
  );
}

function AddItemModal({ category, title, onClose, onSaved }) {
  const [name, setName] = useState("");
  const [itemCode, setItemCode] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name) return;
    setSaving(true);
    await supabase.from("stock_items").insert({ category, name, item_code: itemCode, qty_remaining: 0 });
    setSaving(false);
    onSaved();
    onClose();
  }

  return (
    <Modal title={`Add ${title} Item`} onClose={onClose}>
      <FieldLabel>Item Name</FieldLabel>
      <input style={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Lidocaine HCL 2%" />
      <FieldLabel>Item Code</FieldLabel>
      <input style={inp} value={itemCode} onChange={(e) => setItemCode(e.target.value)} placeholder="e.g., DEN-LD-001" />
      <button onClick={handleSave} disabled={saving} style={primaryBtn}>{saving ? "Saving..." : "Save Item"}</button>
    </Modal>
  );
}

function TransactionModal({ item, onClose, onSaved }) {
  const [type, setType] = useState("purchase");
  const [qty, setQty] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("paid");
  const [amountPaid, setAmountPaid] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const total = (Number(qty) || 0) * (Number(unitPrice) || 0);

  async function handleSave() {
    if (!qty || !unitPrice) {
      setError("Quantity and unit price are required.");
      return;
    }
    setSaving(true);
    const paid = paymentStatus === "paid" ? total : paymentStatus === "pending" ? 0 : Number(amountPaid) || 0;
    const { error: err } = await supabase.rpc("record_stock_transaction", {
      p_item_id: item.id,
      p_type: type,
      p_qty: Number(qty),
      p_unit_price: Number(unitPrice),
      p_amount_paid: paid,
      p_payment_status: paymentStatus,
    });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <Modal title={`Record Transaction \u2014 ${item.name}`} onClose={onClose}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {["purchase", "sale"].map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            style={{
              flex: 1,
              padding: "8px 0",
              borderRadius: 8,
              border: `1px solid ${type === t ? theme.gold : "#ddd"}`,
              background: type === t ? theme.goldLight : "#fff",
              color: theme.navy,
              fontWeight: 700,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <FieldLabel>Quantity</FieldLabel>
      <input style={inp} value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />
      <FieldLabel>Unit Price (EGP)</FieldLabel>
      <input style={inp} value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="0.00" />
      {total > 0 && <p style={{ fontSize: 12, color: theme.gray, marginTop: -12, marginBottom: 12 }}>Total: {formatMoney(total, { decimals: 2 })} EGP</p>}

      <FieldLabel>{type === "sale" ? "Payment from Customer" : "Payment to Supplier"}</FieldLabel>
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {["paid", "partial", "pending"].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setPaymentStatus(s)}
            style={{
              flex: 1,
              padding: "6px 0",
              borderRadius: 6,
              fontSize: 11,
              border: `1px solid ${paymentStatus === s ? theme.gold : "#ddd"}`,
              background: paymentStatus === s ? theme.goldLight : "#fff",
              color: theme.navy,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {s}
          </button>
        ))}
      </div>
      {paymentStatus === "partial" && (
        <>
          <FieldLabel>Amount Actually Paid (EGP)</FieldLabel>
          <input style={inp} value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} placeholder="0.00" />
        </>
      )}

      {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}
      <button onClick={handleSave} disabled={saving} style={primaryBtn}>{saving ? "Saving..." : "Save Transaction"}</button>
    </Modal>
  );
}

function CountModal({ item, onClose, onSaved }) {
  const [physicalQty, setPhysicalQty] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  async function handleSave() {
    if (physicalQty === "") return;
    setSaving(true);
    const { data, error } = await supabase.rpc("record_stock_count", { p_item_id: item.id, p_physical_qty: Number(physicalQty) });
    setSaving(false);
    if (!error) {
      setResult(data);
      onSaved();
    }
  }

  return (
    <Modal title={`Physical Count \u2014 ${item.name}`} onClose={onClose}>
      <p style={{ fontSize: 13, color: theme.gray }}>System expects: <strong>{item.qty_remaining ?? 0}</strong></p>
      <FieldLabel>Physical Count</FieldLabel>
      <input style={inp} value={physicalQty} onChange={(e) => setPhysicalQty(e.target.value)} placeholder="0" />
      {result && (
        <p style={{ fontSize: 13, color: result.variance === 0 ? "#2e7d32" : "#ba1a1a" }}>
          Variance: {result.variance > 0 ? "+" : ""}{result.variance} {result.variance === 0 ? "(matches)" : "(flagged)"}
        </p>
      )}
      <button onClick={handleSave} disabled={saving} style={primaryBtn}>{saving ? "Saving..." : "Record Count"}</button>
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

function Th({ children }) {
  return <th style={{ padding: "12px 16px", fontSize: 11, color: theme.gray, fontWeight: 700, textTransform: "uppercase" }}>{children}</th>;
}
function Td({ children }) {
  return <td style={{ padding: "12px 16px", color: theme.navy }}>{children}</td>;
}
function FieldLabel({ children }) {
  return <label style={{ fontSize: 12, fontWeight: 600, color: theme.navy, display: "block", marginBottom: 6 }}>{children}</label>;
}

const inp = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box", marginBottom: 16 };
const primaryBtn = { width: "100%", padding: "12px 0", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer" };
const outlineBtn = { padding: "0 20px", borderRadius: 8, border: `1px solid ${theme.navy}`, background: "#fff", color: theme.navy, fontWeight: 600, cursor: "pointer", fontSize: 13 };
const smallBtn = { padding: "5px 10px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontSize: 11, cursor: "pointer" };
