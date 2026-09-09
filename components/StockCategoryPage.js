"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabase";
import { theme } from "../lib/theme";
import { formatMoney } from "../lib/format";
import { exportToCsv } from "../lib/exportCsv";
import { usePermissions } from "../lib/usePermissions";

// One dedicated page per stock category (Dental, El3awama) - no in-page toggle,
// each is its own real route matching its own sidebar entry.
export default function StockCategoryPage({ category, title }) {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showCount, setShowCount] = useState(null); // item being counted
  const [editingImageId, setEditingImageId] = useState(null);
  const { profile } = usePermissions();

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

  const [cellError, setCellError] = useState("");

  // Saves one field of one row. Everything on this table was read-only, so any
  // correction - a typo in a name, a price that had moved, a miscount - meant
  // asking someone with database access.
  async function saveCell(item, field, raw) {
    setCellError("");
    const numeric = ["qty_remaining", "purchase_price", "sale_price"].includes(field);
    let value = numeric ? (raw === "" ? null : Number(raw)) : String(raw).trim();

    if (numeric && value !== null && (!Number.isFinite(value) || value < 0)) {
      setCellError("That needs to be a number, and not negative.");
      return false;
    }
    if (field === "name" && !value) {
      setCellError("An item needs a name.");
      return false;
    }
    // Physical stock cannot drop below what is already promised to placed
    // orders - those units are still on the shelf and someone is coming for
    // them. Releasing them means cancelling the order, not editing this number.
    if (field === "qty_remaining" && value !== null && value < Number(item.qty_reserved || 0)) {
      setCellError(
        `${item.name} has ${item.qty_reserved} unit(s) reserved for orders already placed, so the count cannot go below that.`
      );
      return false;
    }
    if (String(item[field] ?? "") === String(value ?? "")) return true;

    const { error } = await supabase.from("stock_items").update({ [field]: value }).eq("id", item.id);
    if (error) {
      setCellError(error.message);
      return false;
    }

    // A quantity change here is a stock adjustment that never went through a
    // purchase, sale or count, so it leaves no trace anywhere else. Recorded
    // so a shelf count that moved by hand can still be explained later.
    if (field === "qty_remaining") {
      const { data: sess } = await supabase.auth.getSession();
      await supabase.from("activity_log").insert({
        actor_id: sess.session?.user?.id || null,
        actor_name: profile?.name || null,
        actor_type: "admin",
        action: "stock_qty_adjusted",
        entity_type: "stock_item",
        entity_id: item.id,
        details: { item: item.name, from: item.qty_remaining, to: value },
      });
    }

    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, [field]: value } : i)));
    return true;
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

      {cellError && (
        <p style={{ background: "#fdecea", color: "#8c1d18", fontSize: 12.5, padding: "10px 12px", borderRadius: 8, marginBottom: 12 }}>
          {cellError}
        </p>
      )}
      <p style={{ fontSize: 12, color: theme.gray, margin: "0 0 10px" }}>
        Click any name, code, quantity or price to edit it. Enter saves, Escape cancels.
      </p>
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
                  <Td><EditableCell item={item} field="name" onSave={saveCell} /></Td>
                  <Td><EditableCell item={item} field="item_code" onSave={saveCell} placeholder="\u2014" /></Td>
                  <Td>
                    <EditableCell
                      item={item}
                      field="qty_remaining"
                      numeric
                      onSave={saveCell}
                      render={(v) => (
                        <span style={{ fontWeight: 700, color: (Number(v) || 0) <= 5 ? "#ba1a1a" : theme.navy }}>
                          {v ?? 0}
                          {Number(item.qty_reserved) > 0 && (
                            <span style={{ fontWeight: 400, fontSize: 11, color: theme.gray }}> ({item.qty_reserved} reserved)</span>
                          )}
                        </span>
                      )}
                    />
                  </Td>
                  <Td><EditableCell item={item} field="purchase_price" numeric onSave={saveCell} render={(v) => (v != null ? formatMoney(v) : "\u2014")} /></Td>
                  <Td><EditableCell item={item} field="sale_price" numeric onSave={saveCell} render={(v) => (v != null ? formatMoney(v) : "\u2014")} /></Td>
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
                      {/* The manual "Transaction" action was removed: stock now
                          moves through orders, counter sales and counts, and
                          quantities are editable in place. A second, silent way
                          to move stock only made the numbers harder to trust. */}
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
        + Add Item
      </button>

      {showAddItem && <AddItemModal category={category} title={title} onClose={() => setShowAddItem(false)} onSaved={load} />}
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

// TransactionModal removed with the manual stock-movement action above.
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
// A read-only value that turns into an input when clicked. Kept deliberately
// small: one field, one row, saved on Enter or on leaving the cell, abandoned
// on Escape. No edit mode to enter and no Save button to hunt for, because the
// common case is correcting a single number.
function EditableCell({ item, field, numeric, onSave, render, placeholder }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  function begin() {
    setDraft(item[field] ?? "");
    setEditing(true);
  }

  async function commit() {
    if (busy) return;
    setBusy(true);
    const ok = await onSave(item, field, draft);
    setBusy(false);
    // Stays open on a rejected value so the typing is not thrown away and the
    // reason is visible right next to it.
    if (ok) setEditing(false);
  }

  if (editing) {
    return (
      <input
        autoFocus
        type={numeric ? "number" : "text"}
        min={numeric ? 0 : undefined}
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        onFocus={(e) => e.target.select()}
        style={{
          width: numeric ? 90 : "100%", minWidth: 70, padding: "5px 7px",
          borderRadius: 6, border: `1px solid ${theme.navy}`, fontSize: 13,
          fontFamily: "inherit", boxSizing: "border-box",
        }}
      />
    );
  }

  const shown = render ? render(item[field]) : item[field];
  return (
    <span
      onClick={begin}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          begin();
        }
      }}
      title="Click to edit"
      style={{
        display: "inline-block", minWidth: 28, padding: "3px 6px", margin: "-3px -6px",
        borderRadius: 6, cursor: "text", borderBottom: "1px dashed #d8d8e0",
      }}
    >
      {shown === null || shown === undefined || shown === "" ? (placeholder ?? "\u2014") : shown}
    </span>
  );
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
