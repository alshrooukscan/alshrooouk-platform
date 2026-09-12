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
  const [stockFilter, setStockFilter] = useState("in"); // in | out | all
  const [openBatches, setOpenBatches] = useState(null); // item id whose deliveries are shown
  const [returnFor, setReturnFor] = useState(null); // batch being returned to its supplier
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [lowOnly, setLowOnly] = useState(false);
  const [noPriceOnly, setNoPriceOnly] = useState(false);
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

  // Sold-out items are hidden by default: 249 items of which a third are
  // finished makes the list of what you can actually sell hard to read. They
  // are not gone - "Sold out" brings back exactly those, with what was bought
  // and sold before they ran out.
  const filtered = items.filter((i) => {
    const q = query.toLowerCase();
    const hit = i.name?.toLowerCase().includes(q) || i.item_code?.toLowerCase().includes(q);
    if (!hit) return false;
    const qty = Number(i.qty_remaining || 0);
    if (lowOnly && qty > 5) return false;
    // An item with no purchase price has no margin and no batch cost, so it
    // reads as pure profit everywhere. Worth being able to list them.
    if (noPriceOnly && Number(i.purchase_price || 0) > 0) return false;
    if (stockFilter === "in") return qty > 0;
    if (stockFilter === "out") return qty <= 0;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    const va = a[sortBy], vb = b[sortBy];
    if (sortBy === "name" || sortBy === "item_code") {
      return String(va || "").localeCompare(String(vb || ""), undefined, { numeric: true }) * dir;
    }
    return ((Number(va) || 0) - (Number(vb) || 0)) * dir;
  });

  function sortOn(col) {
    if (sortBy === col) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("asc"); }
  }

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
        <select
          value={stockFilter}
          onChange={(e) => setStockFilter(e.target.value)}
          style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, color: theme.navy }}
        >
          <option value="in">In stock</option>
          <option value="out">Sold out</option>
          <option value="all">All items</option>
        </select>
        <button onClick={() => setShowAddItem(true)} style={outlineBtn}>+ Add Item</button>
        <Link href="/dashboard/stock/purchase-orders" style={{ ...outlineBtn, textDecoration: "none", display: "flex", alignItems: "center" }}>Purchase Orders</Link>
      </div>

      {cellError && (
        <p style={{ background: "#fdecea", color: "#8c1d18", fontSize: 12.5, padding: "10px 12px", borderRadius: 8, marginBottom: 12 }}>
          {cellError}
        </p>
      )}
      {/* 249 items is too many to read straight through, so the list can be
          narrowed to the questions people actually ask of it: what is running
          out, and what has no cost price and so shows a false margin. */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => setLowOnly(!lowOnly)} style={chip(lowOnly)}>Low stock (5 or fewer)</button>
        <button onClick={() => setNoPriceOnly(!noPriceOnly)} style={chip(noPriceOnly)}>Missing purchase price</button>
        {(lowOnly || noPriceOnly || stockFilter !== "in" || query) && (
          <button
            onClick={() => { setLowOnly(false); setNoPriceOnly(false); setStockFilter("in"); setQuery(""); }}
            style={{ ...chip(false), border: "none", color: theme.gray, textDecoration: "underline" }}
          >
            Clear filters
          </button>
        )}
        <span style={{ marginLeft: "auto", fontSize: 12, color: theme.gray }}>
          Showing {sorted.length} of {items.length} items
        </span>
      </div>
      <p style={{ fontSize: 12, color: theme.gray, margin: "0 0 10px" }}>
        Click any column heading to sort. Click any name, code, quantity or price to edit it &mdash; Enter saves, Escape cancels.
      </p>
      <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#faf9fb", textAlign: "left" }}>
              {category === "dental" && <Th>Image</Th>}
              <SortTh col="name" label="Item" sortBy={sortBy} sortDir={sortDir} onSort={sortOn} />
              <SortTh col="item_code" label="Code" sortBy={sortBy} sortDir={sortDir} onSort={sortOn} />
              <SortTh col="qty_remaining" label="Qty Remaining" sortBy={sortBy} sortDir={sortDir} onSort={sortOn} />
              <SortTh col="purchase_price" label="Purchase Price" sortBy={sortBy} sortDir={sortDir} onSort={sortOn} />
              <SortTh col="sale_price" label="Sale Price" sortBy={sortBy} sortDir={sortDir} onSort={sortOn} />
              <Th>Profit</Th>
              <Th>Variance</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((item) => {
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
                      {/* Cost differs per delivery - the same gloves bought at
                          145 in May and 155 in July are two different margins -
                          so the deliveries behind an item are worth opening. */}
                      <button
                        onClick={() => setOpenBatches(openBatches === item.id ? null : item.id)}
                        style={smallBtn}
                      >
                        {openBatches === item.id ? "Hide" : "Deliveries"}
                      </button>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {openBatches && (
          <BatchPanel
            item={items.find((i) => i.id === openBatches)}
            onClose={() => setOpenBatches(null)}
            onReturn={(b) => setReturnFor(b)}
            reloadKey={returnFor === null ? 1 : 0}
          />
        )}
        {!loading && sorted.length === 0 && (
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

      {returnFor && (
        <ReturnModal
          batch={returnFor}
          onClose={() => setReturnFor(null)}
          onSaved={() => { setReturnFor(null); load(); }}
        />
      )}
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
  const [form, setForm] = useState({
    name: "", qty_remaining: "", purchase_price: "", sale_price: "", reorder_level: "",
  });
  const [nextCode, setNextCode] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Shown before saving so staff can see what the item will be called, rather
  // than saving and then hunting for it in a list of 246.
  useEffect(() => {
    supabase
      .from("stock_items")
      .select("item_code")
      .eq("category", category)
      .then(({ data }) => {
        const highest = (data || [])
          .map((r) => parseInt(r.item_code, 10))
          .filter((n) => Number.isFinite(n));
        setNextCode(String((highest.length ? Math.max(...highest) : 0) + 1));
      });
  }, [category]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const num = (v) => (v === "" ? null : Number(v));

  async function handleSave() {
    if (!form.name.trim()) return setError("The item needs a name.");
    if (form.sale_price !== "" && form.purchase_price !== "" && Number(form.sale_price) < Number(form.purchase_price)) {
      return setError("The sale price is below the purchase price. Correct it, or leave the sale price blank for now.");
    }
    setSaving(true);
    setError("");
    // The code is left out entirely rather than sent empty, so the database
    // assigns the next one in this stock's sequence.
    const { data: created, error: err } = await supabase
      .from("stock_items")
      .insert({
        category,
        name: form.name.trim(),
        qty_remaining: num(form.qty_remaining) ?? 0,
        purchase_price: num(form.purchase_price),
        sale_price: num(form.sale_price),
        reorder_level: num(form.reorder_level) ?? 0,
      })
      .select("id")
      .single();

    if (err) {
      setSaving(false);
      return setError(err.message);
    }

    // The image is named after the item, so it can only be uploaded once the
    // item exists. If this fails the item is still saved - a picture can be
    // added from the table afterwards, and losing the whole entry over it
    // would be the worse outcome.
    if (imageFile && created?.id) {
      const ext = imageFile.name.split(".").pop();
      const path = `${created.id}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("stock-item-images")
        .upload(path, imageFile, { upsert: true });
      if (!upErr) {
        const { data: pub } = supabase.storage.from("stock-item-images").getPublicUrl(path);
        await supabase.from("stock_items").update({ image_url: pub.publicUrl }).eq("id", created.id);
      } else {
        setSaving(false);
        onSaved();
        return setError(`Item saved, but the image did not upload: ${upErr.message}. Add it from the table.`);
      }
    }

    setSaving(false);
    onSaved();
    onClose();
  }

  const half = { display: "flex", gap: 10 };
  const halfCol = { flex: 1, minWidth: 0 };

  return (
    <Modal title={`Add ${title} Item`} onClose={onClose}>
      <FieldLabel>Item Name</FieldLabel>
      <input style={inp} value={form.name} onChange={set("name")} placeholder="e.g., Lidocaine HCL 2%" />

      <FieldLabel>Item Code</FieldLabel>
      {/* Filled in and not editable. Codes are a single running sequence per
          stock and a typed one would either duplicate an existing line or
          leave a hole; the number is the platform's to keep, not a decision
          for whoever is standing at the counter. */}
      <input
        style={{ ...inp, background: "#f1f2f6", color: theme.gray, cursor: "not-allowed" }}
        value={nextCode ?? "..."}
        readOnly
        disabled
      />
      <p style={{ fontSize: 11, color: theme.gray, margin: "4px 0 0" }}>
        Next code in {title} stock, assigned automatically.
      </p>

      <div style={half}>
        <div style={halfCol}>
          <FieldLabel>Opening Quantity</FieldLabel>
          <input style={inp} type="number" min="0" value={form.qty_remaining} onChange={set("qty_remaining")} placeholder="0" />
        </div>
        <div style={halfCol}>
          <FieldLabel>Reorder Level</FieldLabel>
          <input style={inp} type="number" min="0" value={form.reorder_level} onChange={set("reorder_level")} placeholder="0" />
        </div>
      </div>

      <div style={half}>
        <div style={halfCol}>
          <FieldLabel>Purchase Price</FieldLabel>
          <input style={inp} type="number" min="0" step="0.01" value={form.purchase_price} onChange={set("purchase_price")} placeholder="EGP" />
        </div>
        <div style={halfCol}>
          <FieldLabel>Sale Price</FieldLabel>
          <input style={inp} type="number" min="0" step="0.01" value={form.sale_price} onChange={set("sale_price")} placeholder="EGP" />
        </div>
      </div>

      <FieldLabel>Image</FieldLabel>
      {/* The same upload the table rows use, into the same bucket with the same
          naming, so a picture added here sits alongside every other item's
          rather than depending on someone having a URL to hand. */}
      {imagePreview && (
        <img src={imagePreview} alt="" style={{ width: "100%", maxHeight: 160, objectFit: "cover", borderRadius: 8, marginBottom: 8 }} />
      )}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          const f = e.target.files?.[0];
          setImageFile(f || null);
          setImagePreview(f ? URL.createObjectURL(f) : null);
        }}
        style={{ fontSize: 13 }}
      />
      <p style={{ fontSize: 11, color: theme.gray, margin: "4px 0 0" }}>
        Optional. Shown here and on the card doctors see when browsing {title} stock in their portal.
      </p>

      {/* An opening quantity is a real movement: it opens a batch so the
          purchase ledger and the shelf count start life agreeing. */}
      {Number(form.qty_remaining) > 0 && !form.purchase_price && (
        <p style={{ fontSize: 11, color: "#8a6d00", margin: "8px 0 0" }}>
          With no purchase price, this opening stock is recorded at zero cost and the item will show no value.
        </p>
      )}

      {error && <p style={{ fontSize: 12, color: "#b42318", margin: "8px 0 0" }}>{error}</p>}

      <button onClick={handleSave} disabled={saving} style={{ ...primaryBtn, marginTop: 12 }}>
        {saving ? "Saving..." : "Save Item"}
      </button>
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
const cancelBtn = { flex: 1, padding: "12px 0", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontWeight: 600, cursor: "pointer" };
const outlineBtn = { padding: "0 20px", borderRadius: 8, border: `1px solid ${theme.navy}`, background: "#fff", color: theme.navy, fontWeight: 600, cursor: "pointer", fontSize: 13 };
const smallBtn = { padding: "5px 10px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontSize: 11, cursor: "pointer" };

// The deliveries behind one item. Cost differs per delivery, so a single
// blended purchase price on the row above hides where the margin actually
// comes from - and which delivery a return should go back to.
function BatchPanel({ item, onClose, onReturn }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("stock_batches")
        .select("id, po_number, supplier_name, purchase_price, sale_price, qty_in, qty_remaining, received_date, note")
        .eq("stock_item_id", item.id)
        .order("received_date", { ascending: true, nullsFirst: true })
        .order("created_at", { ascending: true });
      if (live) { setBatches(data || []); setLoading(false); }
    })();
    return () => { live = false; };
  }, [item.id]);

  const sold = batches.reduce((s, b) => s + (Number(b.qty_in) - Number(b.qty_remaining)), 0);
  const left = batches.reduce((s, b) => s + Number(b.qty_remaining), 0);

  return (
    <div style={{ borderTop: "1px solid #eceaf1", background: "#fafafd", padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, color: theme.navy }}>{item.name} &mdash; deliveries</div>
          <div style={{ fontSize: 12, color: theme.gray }}>
            {batches.length} deliveries &middot; {sold} sold &middot; {left} still on hand.
            Sales come out of the oldest delivery first.
          </div>
        </div>
        <button onClick={onClose} style={smallBtn}>Close</button>
      </div>

      {loading && <p style={{ fontSize: 13, color: theme.gray }}>Loading...</p>}
      {!loading && batches.length === 0 && (
        <p style={{ fontSize: 13, color: theme.gray }}>No deliveries recorded for this item yet.</p>
      )}
      {!loading && batches.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: theme.gray, fontSize: 11, textAlign: "left" }}>
              <th style={bth}>PO</th><th style={bth}>Supplier</th><th style={bth}>Received</th>
              <th style={bth}>Bought</th><th style={bth}>Sold</th><th style={bth}>Left</th>
              <th style={bth}>Buy</th><th style={bth}>Sell</th><th style={bth}>Profit made</th><th style={bth}></th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => {
              const used = Number(b.qty_in) - Number(b.qty_remaining);
              const margin = (Number(b.sale_price || 0) - Number(b.purchase_price || 0)) * used;
              return (
                <tr key={b.id} style={{ borderTop: "1px solid #eceaf1" }}>
                  <td style={btd}>{b.po_number || "\u2014"}</td>
                  <td style={btd}>{b.supplier_name || "\u2014"}</td>
                  <td style={btd}>{b.received_date || "\u2014"}</td>
                  <td style={btd}>{Number(b.qty_in)}</td>
                  <td style={btd}>{used}</td>
                  <td style={{ ...btd, fontWeight: 700, color: Number(b.qty_remaining) > 0 ? theme.navy : "#aaa" }}>
                    {Number(b.qty_remaining)}
                  </td>
                  <td style={btd}>{b.purchase_price ? formatMoney(b.purchase_price) : "\u2014"}</td>
                  <td style={btd}>{b.sale_price ? formatMoney(b.sale_price) : "\u2014"}</td>
                  <td style={{ ...btd, color: margin >= 0 ? "#1e7a3c" : "#ba1a1a" }}>
                    {used > 0 ? formatMoney(margin) : "\u2014"}
                  </td>
                  <td style={btd}>
                    {Number(b.qty_remaining) > 0 && (
                      <button onClick={() => onReturn({ ...b, item })} style={smallBtn}>Return</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Returning goods is not negative stock. The units go back to the supplier they
// came from, at the price that delivery was bought at, and their value is held
// as credit against that supplier's next invoice.
function ReturnModal({ batch, onClose, onSaved }) {
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const max = Number(batch.qty_remaining);
  const supplier = batch.supplier_name || "Main Dental Supplier";
  const value = (Number(qty) || 0) * Number(batch.purchase_price || 0);

  async function handleSave() {
    setError("");
    const q = Number(qty);
    if (!q || q <= 0) return setError("Enter how many units are going back.");
    if (q > max) return setError(`Only ${max} left in this delivery. You cannot return more than that.`);
    setSaving(true);
    try {
      const { data: ret, error: rErr } = await supabase
        .from("supplier_returns")
        .insert({
          supplier_name: supplier, stock_item_id: batch.item.id, batch_id: batch.id,
          qty: q, unit_cost: batch.purchase_price || 0,
          total_value: q * Number(batch.purchase_price || 0), reason: reason || null,
        })
        .select("id").single();
      if (rErr) throw new Error(rErr.message);

      const { error: cErr } = await supabase.from("supplier_credits").insert({
        supplier_name: supplier, direction: "credit",
        amount: q * Number(batch.purchase_price || 0), return_id: ret.id,
        note: `Returned ${q} x ${batch.item.name}`,
      });
      if (cErr) throw new Error(cErr.message);

      // Both the delivery and the item's own count come down, so the return
      // shows up wherever stock is read from.
      await supabase.from("stock_batches").update({ qty_remaining: max - q }).eq("id", batch.id);
      await supabase
        .from("stock_items")
        .update({ qty_remaining: Math.max(Number(batch.item.qty_remaining || 0) - q, 0) })
        .eq("id", batch.item.id);
      onSaved();
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  }

  return (
    <Modal title="Return to supplier" onClose={onClose}>
      <p style={{ fontSize: 13, color: theme.gray, marginTop: 0 }}>
        {batch.item.name} &middot; {batch.po_number || "no PO"} &middot; {max} left in this delivery.
      </p>
      <FieldLabel>How many go back</FieldLabel>
      <input type="number" min="1" max={max} value={qty} onChange={(e) => setQty(e.target.value)} style={inp} />
      <FieldLabel>Reason (optional)</FieldLabel>
      <input value={reason} onChange={(e) => setReason(e.target.value)} style={inp} />
      <p style={{ fontSize: 12, color: theme.navy, background: "#f6efdd", padding: "10px 12px", borderRadius: 8, marginTop: 12 }}>
        {supplier} will be credited <strong>{formatMoney(value)} EGP</strong> &mdash; {qty || 0} at{" "}
        {formatMoney(batch.purchase_price)} each, the price this delivery was bought at. Use it against their next invoice.
      </p>
      {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={onClose} style={cancelBtn}>Cancel</button>
        <button onClick={handleSave} disabled={saving} style={{ ...primaryBtn, flex: 1, width: "auto" }}>
          {saving ? "Saving..." : "Record Return"}
        </button>
      </div>
    </Modal>
  );
}

const bth = { padding: "6px 8px", fontWeight: 600 };
const btd = { padding: "7px 8px", color: theme.navy };

function SortTh({ col, label, sortBy, sortDir, onSort }) {
  const on = sortBy === col;
  return (
    <th
      onClick={() => onSort(col)}
      style={{
        padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 700,
        color: on ? theme.navy : theme.gray, textTransform: "uppercase",
        letterSpacing: "0.04em", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
      }}
    >
      {label}
      <span style={{ marginLeft: 6, color: on ? theme.gold : "#ccc" }}>
        {on ? (sortDir === "asc" ? "\u25B2" : "\u25BC") : "\u25B4"}
      </span>
    </th>
  );
}

const chip = (active) => ({
  padding: "7px 14px", borderRadius: 999,
  border: `1px solid ${active ? theme.navy : "#ddd"}`,
  background: active ? theme.navy : "#fff",
  color: active ? "#fff" : theme.navy,
  fontSize: 12.5, fontWeight: 600, cursor: "pointer",
});
