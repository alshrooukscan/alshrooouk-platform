"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import { formatMoney } from "../../../../lib/format";
import { exportToCsv } from "../../../../lib/exportCsv";
import { usePermissions } from "../../../../lib/usePermissions";

// Every purchase, payment and return goes through a database function now.
// This screen used to read the quantity, add to it and write it back from the
// browser, then create the PO afterwards: two people saving at once could lose
// stock, a failed PO left stock added with no PO behind it, and nothing tied a
// PO to what it put on the shelf.

const METHODS = [
  { key: "cash", label: "Cash" },
  { key: "instapay", label: "InstaPay" },
  { key: "visa", label: "Visa" },
  { key: "wallet", label: "Wallet" },
];
const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.key, m.label]));
const CASH_BOXES = [
  { key: "dental_stock", label: "Dental stock cash" },
  { key: "el3awama_stock", label: "El3awama cash" },
  { key: "scan", label: "Scan cash" },
];

// Dates are stored as YYYY-MM-DD. Shown as DD/MM/YYYY everywhere on this page.
function formatDate(value) {
  const raw = String(value || "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : raw || "-";
}
// Today in Cairo, which is what the database checks against.
function cairoToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
}
const qtyText = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function PurchaseOrdersPage() {
  const { isAdmin } = usePermissions();
  const [suppliers, setSuppliers] = useState([]);
  const [balances, setBalances] = useState({});
  const [selected, setSelected] = useState(null);
  const [entries, setEntries] = useState([]);
  const [lines, setLines] = useState({});
  const [tab, setTab] = useState("orders");
  const [expanded, setExpanded] = useState(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null); // {kind, ...}
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [{ data: s }, { data: b }] = await Promise.all([
      supabase.from("suppliers").select("*").order("name"),
      supabase.rpc("get_supplier_balances"),
    ]);
    setSuppliers(s || []);
    const map = {};
    (b || []).forEach((r) => (map[r.supplier_id] = Number(r.balance)));
    setBalances(map);
    setLoading(false);
  }

  async function openSupplier(supplier) {
    setSelected(supplier);
    setExpanded(null);
    const { data } = await supabase
      .from("purchase_orders")
      .select("*")
      .eq("supplier_id", supplier.id)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });
    setEntries(data || []);
    const poIds = (data || []).filter((e) => e.entry_type === "purchase").map((e) => e.id);
    if (poIds.length) {
      const { data: ls } = await supabase.from("purchase_order_lines").select("*").in("po_id", poIds).order("created_at");
      const grouped = {};
      (ls || []).forEach((l) => (grouped[l.po_id] = [...(grouped[l.po_id] || []), l]));
      setLines(grouped);
    } else setLines({});
  }

  async function refresh() {
    await load();
    if (selected) await openSupplier(selected);
  }

  const totalOwed = Object.values(balances).reduce((s, b) => s + (b > 0 ? b : 0), 0);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (!showCancelled && e.status === "void") return false;
      if (tab === "orders" && e.entry_type !== "purchase") return false;
      if (tab === "payments" && e.entry_type !== "payment") return false;
      if (tab === "returns" && e.entry_type !== "return") return false;
      if (!q) return true;
      const hay = [e.po_number ? `po-${e.po_number}` : "", e.description, e.paid_by_name, e.created_by_name,
        ...(lines[e.id] || []).map((l) => l.item_name)].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [entries, lines, tab, showCancelled, search]);

  function exportCsv() {
    exportToCsv(`${selected.name}-ledger.csv`, entries.map((e) => ({
      Date: formatDate(e.entry_date),
      Type: e.entry_type,
      "PO Number": e.po_number ? `PO-${e.po_number}` : "",
      Items: (lines[e.id] || []).map((l) => `${l.item_name} x${qtyText(l.qty)} @ ${l.unit_price}`).join("; ") || e.description || "",
      Amount: e.amount,
      Method: e.payment_method ? METHOD_LABEL[e.payment_method] : "",
      ...(isAdmin ? { "Paid by": e.paid_by_name || "" } : {}),
      Status: e.status === "void" ? "Cancelled" : "Active",
      "Recorded by": e.created_by_name || "",
    })));
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 16, flexWrap: "wrap" }}>
        <div>
          <p style={{ fontSize: 12, color: theme.gray }}>
            <Link href="/dashboard/stock/dental" style={{ color: theme.gray }}>Inventory Management</Link> &gt; Purchase Orders
          </p>
          <h1 style={{ color: theme.navy, margin: "4px 0" }}>Purchase Orders</h1>
          <p style={{ color: theme.gray, margin: 0 }}>A purchase adds the items to stock and to what we owe. A payment or a return reduces what we owe.</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, color: theme.gray }}>TOTAL OWED TO SUPPLIERS</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: totalOwed > 0 ? "#ba1a1a" : theme.navy }}>{formatMoney(totalOwed, { decimals: 2 })} EGP</div>
        </div>
      </div>

      <button onClick={() => setModal({ kind: "supplier" })} style={outlineBtn}>+ Add Supplier</button>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 300px) 1fr", gap: 20, marginTop: 20 }}>
        <div style={card}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Suppliers</h3>
          {loading && <p style={muted}>Loading...</p>}
          {!loading && suppliers.length === 0 && <p style={muted}>No suppliers yet, add one above.</p>}
          {suppliers.map((s) => {
            const bal = balances[s.id] || 0;
            return (
              <div key={s.id} onClick={() => openSupplier(s)}
                style={{ padding: "12px 10px", borderRadius: 8, cursor: "pointer", background: selected?.id === s.id ? theme.goldLight : "transparent",
                  display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 8 }}>
                <span style={{ color: theme.navy, fontWeight: 600 }}>{s.name}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: bal > 0 ? "#ba1a1a" : bal < 0 ? "#2e7d32" : theme.gray, whiteSpace: "nowrap" }}>
                  {formatMoney(bal, { decimals: 2 })}
                </span>
              </div>
            );
          })}
        </div>

        <div style={{ ...card, minWidth: 0 }}>
          {!selected && <p style={muted}>Select a supplier to see their purchase orders and payments.</p>}
          {selected && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
                <div>
                  <h3 style={{ color: theme.navy, margin: 0 }}>{selected.name}</h3>
                  <div style={{ fontSize: 13, color: theme.gray, marginTop: 2 }}>
                    Balance: <strong style={{ color: (balances[selected.id] || 0) > 0 ? "#ba1a1a" : "#2e7d32" }}>{formatMoney(balances[selected.id] || 0, { decimals: 2 })} EGP</strong>
                    {(balances[selected.id] || 0) > 0 ? " owed" : (balances[selected.id] || 0) < 0 ? " in our favour" : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button onClick={exportCsv} style={ghostBtn}>Export CSV</button>
                  <button onClick={() => setModal({ kind: "payment" })} style={ghostBtn}>+ Record Payment</button>
                  <button onClick={() => setModal({ kind: "po" })} style={smallPrimary}>+ New Purchase Order</button>
                </div>
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
                {[["orders", "Purchase orders"], ["payments", "Payments"], ["returns", "Returns"], ["all", "All entries"]].map(([k, l]) => (
                  <button key={k} onClick={() => setTab(k)} style={{ ...tabBtn, ...(tab === k ? tabBtnActive : {}) }}>{l}</button>
                ))}
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search PO number or item" style={{ ...inp, marginBottom: 0, width: 200, padding: "6px 10px", fontSize: 12 }} />
                <label style={{ fontSize: 12, color: theme.gray, display: "flex", alignItems: "center", gap: 4 }}>
                  <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Show cancelled
                </label>
              </div>

              {visible.length === 0 && <p style={muted}>Nothing here yet.</p>}
              {visible.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table style={table}>
                    <thead>
                      <tr>
                        <th style={th}>Date</th>
                        <th style={th}>Entry</th>
                        <th style={th}>Details</th>
                        <th style={{ ...th, textAlign: "right" }}>Amount (EGP)</th>
                        <th style={th}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((e) => (
                        <Fragment key={e.id}>
                          <tr onClick={() => e.entry_type === "purchase" && setExpanded(expanded === e.id ? null : e.id)}
                            style={{ cursor: e.entry_type === "purchase" ? "pointer" : "default", opacity: e.status === "void" ? 0.55 : 1, background: expanded === e.id ? "#faf7ef" : "transparent" }}>
                            <td style={td}>{formatDate(e.entry_date)}{e.date_reason && <div title={e.date_reason} style={tiny}>Backdated</div>}</td>
                            <td style={td}>
                              <strong style={{ color: theme.navy }}>
                                {e.entry_type === "purchase" ? (e.is_consolidated ? "Consolidated PO" : `PO-${e.po_number ?? "-"}`)
                                  : e.entry_type === "payment" ? (e.is_consolidated ? "Consolidated Payment" : "Payment") : "Return"}
                              </strong>
                              {e.created_by_name && <div style={tiny}>by {e.created_by_name}</div>}
                            </td>
                            <td style={{ ...td, maxWidth: 360 }}>
                              {e.entry_type === "purchase" && (lines[e.id]?.length
                                ? <span>{lines[e.id].length} item{lines[e.id].length > 1 ? "s" : ""} <span style={{ color: theme.gray }}>· {lines[e.id].map((l) => l.item_name).slice(0, 3).join(", ")}{lines[e.id].length > 3 ? "…" : ""}</span></span>
                                : <span style={{ color: theme.gray }}>{e.description || "No item lines recorded"}</span>)}
                              {e.entry_type === "payment" && (
                                <span>
                                  {e.payment_method ? METHOD_LABEL[e.payment_method] : <span style={{ color: theme.gray }}>Method not recorded</span>}
                                  {isAdmin && e.paid_by_name && <span style={{ color: theme.gray }}> · paid by {e.paid_by_name}</span>}
                                  {e.description && <div style={tiny}>{e.description}</div>}
                                </span>
                              )}
                              {e.entry_type === "return" && <span style={{ color: theme.gray }}>{e.description}</span>}
                            </td>
                            <td style={{ ...td, textAlign: "right", fontWeight: 700, color: e.amount > 0 ? "#ba1a1a" : "#2e7d32", whiteSpace: "nowrap" }}>
                              {e.amount > 0 ? "+" : ""}{formatMoney(e.amount, { decimals: 2 })}
                            </td>
                            <td style={td}>
                              {e.status === "void"
                                ? <span title={e.void_reason || ""} style={{ ...badge, background: "#fdecea", color: "#ba1a1a" }}>{e.replaced_by_id ? "Edited" : "Cancelled"}</span>
                                : <span style={{ ...badge, background: "#e8f5e9", color: "#2e7d32" }}>Active</span>}
                              {isAdmin && e.entry_type === "payment" && e.status !== "void" && !e.is_consolidated && (
                                <button onClick={(ev) => { ev.stopPropagation(); setModal({ kind: "voidPayment", entry: e }); }} style={linkBtn}>Cancel</button>
                              )}
                            </td>
                          </tr>
                          {expanded === e.id && (
                            <tr>
                              <td colSpan={5} style={{ padding: "4px 12px 16px", background: "#faf7ef" }}>
                                <PoDetail po={e} lines={lines[e.id] || []} isAdmin={isAdmin}
                                  onReturn={(line) => setModal({ kind: "return", line, po: e })}
                                  onEdit={() => setModal({ kind: "po", editing: e, editingLines: lines[e.id] || [] })}
                                  onVoid={() => setModal({ kind: "voidPo", entry: e })} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {modal?.kind === "supplier" && <AddSupplierModal onClose={() => setModal(null)} onSaved={load} />}
      {modal?.kind === "po" && selected && (
        <PurchaseOrderModal supplier={selected} suppliers={suppliers} editing={modal.editing} editingLines={modal.editingLines}
          onClose={() => setModal(null)} onSaved={refresh} />
      )}
      {modal?.kind === "payment" && selected && <PaymentModal supplier={selected} onClose={() => setModal(null)} onSaved={refresh} />}
      {modal?.kind === "return" && <ReturnModal line={modal.line} po={modal.po} onClose={() => setModal(null)} onSaved={refresh} />}
      {modal?.kind === "voidPo" && (
        <ReasonModal title={`Cancel PO-${modal.entry.po_number}`} confirmLabel="Cancel purchase order"
          note="The items come off the shelf and the amount comes off what we owe. It stays in the history as cancelled."
          onClose={() => setModal(null)}
          onConfirm={(reason) => supabase.rpc("void_purchase_order", { p_po_id: modal.entry.id, p_reason: reason })}
          onDone={refresh} />
      )}
      {modal?.kind === "voidPayment" && (
        <ReasonModal title="Cancel payment" confirmLabel="Cancel payment"
          note="The amount goes back onto what we owe. If it was paid in cash by an employee, it goes back into their cash in hand."
          onClose={() => setModal(null)}
          onConfirm={(reason) => supabase.rpc("void_supplier_payment", { p_payment_id: modal.entry.id, p_reason: reason })}
          onDone={refresh} />
      )}
    </div>
  );
}

function PoDetail({ po, lines, isAdmin, onReturn, onEdit, onVoid }) {
  const total = lines.reduce((s, l) => s + Number(l.line_total || 0), 0);
  return (
    <div>
      {lines.length > 0 ? (
        <table style={{ ...table, background: "#fff", borderRadius: 8, marginTop: 8 }}>
          <thead>
            <tr>
              <th style={th}>Item</th>
              <th style={{ ...th, textAlign: "right" }}>Qty</th>
              <th style={{ ...th, textAlign: "right" }}>Unit price</th>
              <th style={{ ...th, textAlign: "right" }}>Line total</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td style={td}>{l.item_name}{Number(l.qty_returned) > 0 && <div style={tiny}>{qtyText(l.qty_returned)} returned</div>}</td>
                <td style={{ ...td, textAlign: "right" }}>{qtyText(l.qty)}</td>
                <td style={{ ...td, textAlign: "right" }}>{formatMoney(l.unit_price, { decimals: 2 })}</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{formatMoney(l.line_total, { decimals: 2 })}</td>
                <td style={{ ...td, textAlign: "right" }}>
                  {po.status !== "void" && Number(l.qty) > Number(l.qty_returned) && <button onClick={() => onReturn(l)} style={linkBtn}>Return</button>}
                </td>
              </tr>
            ))}
            <tr>
              <td style={{ ...td, fontWeight: 700 }} colSpan={3}>Total</td>
              <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{formatMoney(total, { decimals: 2 })}</td>
              <td style={td}></td>
            </tr>
          </tbody>
        </table>
      ) : (
        <p style={{ ...muted, margin: "8px 0" }}>{po.is_consolidated ? "All purchases before the system went live, combined into one entry." : "This entry was recorded without item lines."}</p>
      )}
      {po.status === "void" && po.void_reason && <p style={{ fontSize: 12, color: "#ba1a1a", margin: "8px 0 0" }}>{po.replaced_by_id ? "Edited" : "Cancelled"} by {po.voided_by_name}: {po.void_reason}</p>}
      {po.date_reason && <p style={{ fontSize: 12, color: theme.gray, margin: "8px 0 0" }}>Date reason: {po.date_reason}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        {lines.length > 0 && <a href={`/dashboard/stock/purchase-orders/${po.id}/invoice`} target="_blank" rel="noreferrer" style={{ ...ghostBtn, textDecoration: "none" }}>Invoice</a>}
        {isAdmin && po.status !== "void" && !po.is_consolidated && lines.length > 0 && <button onClick={onEdit} style={ghostBtn}>Edit</button>}
        {isAdmin && po.status !== "void" && !po.is_consolidated && <button onClick={onVoid} style={{ ...ghostBtn, color: "#ba1a1a", borderColor: "#f3c7c3" }}>Cancel PO</button>}
      </div>
    </div>
  );
}

function DateField({ date, setDate, reason, setReason }) {
  const today = cairoToday();
  return (
    <>
      <FieldLabel>Date</FieldLabel>
      <input type="date" max={today} style={inp} value={date} onChange={(e) => setDate(e.target.value)} />
      {date && date < today && (
        <>
          <FieldLabel>Reason for the earlier date</FieldLabel>
          <input style={inp} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. invoice arrived late" />
        </>
      )}
    </>
  );
}

function PurchaseOrderModal({ supplier, suppliers, editing, editingLines, onClose, onSaved }) {
  const blank = { mode: "existing", itemId: "", newName: "", newCategory: "dental", newSale: "", qty: "", unitPrice: "" };
  const [supplierId, setSupplierId] = useState(editing?.supplier_id || supplier.id);
  const [items, setItems] = useState([]);
  const [rows, setRows] = useState(editing
    ? editingLines.map((l) => ({ ...blank, itemId: l.stock_item_id, qty: String(l.qty), unitPrice: String(l.unit_price) }))
    : [blank]);
  const [description, setDescription] = useState(editing?.description || "");
  const [date, setDate] = useState(editing?.entry_date || cairoToday());
  const [dateReason, setDateReason] = useState(editing?.date_reason || "");
  const [editReason, setEditReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);

  useEffect(() => {
    supabase.from("stock_items").select("id, name, item_code, category, purchase_price, qty_remaining").order("name")
      .then(({ data }) => setItems(data || []));
  }, []);

  const total = rows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.unitPrice) || 0), 0);
  const update = (i, patch) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    setError("");
    const payload = [];
    for (const r of rows) {
      const filled = r.mode === "existing" ? r.itemId : r.newName.trim();
      if (!filled && !r.qty && !r.unitPrice) continue;
      if (!filled) return setError("Choose an item on every line, or remove the empty line.");
      if (!(Number(r.qty) > 0)) return setError("Every line needs a quantity above zero.");
      if (r.unitPrice === "" || Number(r.unitPrice) < 0) return setError("Every line needs a unit price.");
      if (r.mode === "existing") payload.push({ stock_item_id: r.itemId, qty: Number(r.qty), unit_price: Number(r.unitPrice) });
      else {
        if (r.newSale === "") return setError(`Set a sale price for ${r.newName.trim()}.`);
        payload.push({ new_item: { name: r.newName.trim(), category: r.newCategory, sale_price: Number(r.newSale) }, qty: Number(r.qty), unit_price: Number(r.unitPrice) });
      }
    }
    if (payload.length === 0) return setError("Add at least one item.");
    if (editing && !editReason.trim()) return setError("Give the reason for the edit.");
    setSaving(true);
    const { data, error: err } = editing
      ? await supabase.rpc("edit_purchase_order", { p_po_id: editing.id, p_supplier_id: supplierId, p_date: date, p_date_reason: dateReason || null,
          p_description: description || null, p_lines: payload, p_amount: null, p_reason: editReason })
      : await supabase.rpc("create_purchase_order", { p_supplier_id: supplierId, p_date: date, p_date_reason: dateReason || null,
          p_description: description || null, p_lines: payload, p_amount: null });
    setSaving(false);
    if (err) return setError(err.message);
    onSaved();
    setDone(data?.po_number);
  }

  if (done) {
    return (
      <Modal title={editing ? "Purchase order updated" : "Purchase order created"} onClose={onClose}>
        <p style={{ fontSize: 14, color: theme.gray }}>The items are on the shelf and the amount is on {supplier.name}&apos;s balance.</p>
        <div style={{ fontSize: 28, fontWeight: 700, color: theme.navy, textAlign: "center", padding: "16px 0" }}>PO-{done}</div>
        <button onClick={onClose} style={primaryBtn}>Done</button>
      </Modal>
    );
  }

  return (
    <Modal title={editing ? `Edit PO-${editing.po_number}` : `New purchase order`} onClose={onClose} wide>
      {editing && <p style={{ fontSize: 12, color: theme.navy, background: "#f6efdd", padding: "10px 12px", borderRadius: 8, marginTop: 0 }}>
        Saving replaces this order with the corrected one under the same number. Stock moves by the difference, and the original stays in the history as edited.</p>}
      <FieldLabel>Supplier</FieldLabel>
      <select style={inp} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>

      <FieldLabel>Items</FieldLabel>
      {rows.map((r, i) => (
        <div key={i} style={{ border: "1px solid #eee", borderRadius: 10, padding: 12, marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <button type="button" onClick={() => update(i, { mode: "existing" })} style={{ ...miniToggle, ...(r.mode === "existing" ? miniToggleActive : {}) }}>Existing item</button>
            {!editing && <button type="button" onClick={() => update(i, { mode: "new" })} style={{ ...miniToggle, ...(r.mode === "new" ? miniToggleActive : {}) }}>New item</button>}
            {rows.length > 1 && <button type="button" onClick={() => setRows((p) => p.filter((_, j) => j !== i))} style={{ ...miniToggle, marginLeft: "auto", color: "#ba1a1a" }}>Remove</button>}
          </div>
          {r.mode === "existing" ? (
            <ItemPicker items={items} value={r.itemId} onChange={(id) => {
              const it = items.find((x) => x.id === id);
              update(i, { itemId: id, unitPrice: r.unitPrice || (it?.purchase_price != null ? String(it.purchase_price) : "") });
            }} />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 8 }}>
              <input style={inp} placeholder="Item name" value={r.newName} onChange={(e) => update(i, { newName: e.target.value })} />
              <select style={inp} value={r.newCategory} onChange={(e) => update(i, { newCategory: e.target.value })}>
                <option value="dental">Dental</option>
                <option value="el3awama">El3awama</option>
              </select>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: r.mode === "new" ? "1fr 1fr 1fr" : "1fr 1fr", gap: 8 }}>
            <input style={inp} type="number" min="0" placeholder="Qty" value={r.qty} onChange={(e) => update(i, { qty: e.target.value })} />
            <input style={inp} type="number" min="0" placeholder="Unit price (EGP)" value={r.unitPrice} onChange={(e) => update(i, { unitPrice: e.target.value })} />
            {r.mode === "new" && <input style={inp} type="number" min="0" placeholder="Sale price" value={r.newSale} onChange={(e) => update(i, { newSale: e.target.value })} />}
          </div>
          {Number(r.qty) > 0 && r.unitPrice !== "" && (
            <div style={{ fontSize: 12, color: theme.gray, textAlign: "right", marginTop: -8 }}>Line total: <strong>{formatMoney(Number(r.qty) * Number(r.unitPrice), { decimals: 2 })} EGP</strong></div>
          )}
        </div>
      ))}
      <button type="button" onClick={() => setRows((p) => [...p, blank])} style={{ ...outlineBtn, marginBottom: 12 }}>+ Add another item</button>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: "#f7f7f8", borderRadius: 8, marginBottom: 16 }}>
        <span style={{ fontWeight: 600, color: theme.navy }}>Order total</span>
        <span style={{ fontWeight: 700, color: theme.navy }}>{formatMoney(total, { decimals: 2 })} EGP</span>
      </div>

      <FieldLabel>Note (optional)</FieldLabel>
      <input style={inp} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. supplier invoice number" />
      <DateField date={date} setDate={setDate} reason={dateReason} setReason={setDateReason} />
      {editing && (<><FieldLabel>Reason for the edit</FieldLabel><input style={inp} value={editReason} onChange={(e) => setEditReason(e.target.value)} /></>)}
      {error && <p style={errText}>{error}</p>}
      <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? "Saving..." : editing ? "Save changes" : "Create purchase order"}</button>
    </Modal>
  );
}

function ItemPicker({ items, value, onChange }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((it) => !s || it.name.toLowerCase().includes(s) || String(it.item_code || "").includes(s) || it.id === value);
  }, [items, q, value]);
  return (
    <>
      <input style={{ ...inp, marginBottom: 6 }} placeholder="Search item by name or code" value={q} onChange={(e) => setQ(e.target.value)} />
      <select style={inp} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select item...</option>
        {["dental", "el3awama"].map((cat) => (
          <optgroup key={cat} label={cat === "dental" ? "Dental" : "El3awama"}>
            {shown.filter((it) => it.category === cat).map((it) => (
              <option key={it.id} value={it.id}>{it.item_code ? `${it.item_code} · ` : ""}{it.name} (in stock: {qtyText(it.qty_remaining || 0)})</option>
            ))}
          </optgroup>
        ))}
      </select>
    </>
  );
}

function PaymentModal({ supplier, onClose, onSaved }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [payers, setPayers] = useState([]);
  const [payer, setPayer] = useState("");
  const [cashBox, setCashBox] = useState("dental_stock");
  const [held, setHeld] = useState({});
  const [note, setNote] = useState("");
  const [date, setDate] = useState(cairoToday());
  const [dateReason, setDateReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const [{ data: emps }, { data: admins }, { data: custody }] = await Promise.all([
        supabase.from("employees").select("id, name").eq("is_active", true).order("name"),
        supabase.from("staff_profiles").select("id, name").eq("role", "admin").eq("is_active", true).order("name"),
        supabase.from("staff_custody_monitor").select("employee_id, scan_cash, material_cash, fnb_cash"),
      ]);
      setPayers([
        ...(emps || []).map((e) => ({ value: `emp:${e.id}`, label: e.name })),
        ...(admins || []).map((a) => ({ value: `admin:${a.name}`, label: `${a.name} (admin)` })),
      ]);
      const h = {};
      (custody || []).forEach((c) => (h[c.employee_id] = { scan: Number(c.scan_cash), dental_stock: Number(c.material_cash), el3awama_stock: Number(c.fnb_cash) }));
      setHeld(h);
    })();
  }, []);

  const empId = payer.startsWith("emp:") ? payer.slice(4) : null;
  const fromCustody = method === "cash" && empId;
  const holding = fromCustody ? held[empId]?.[cashBox] ?? 0 : null;

  async function save() {
    setError("");
    if (!(Number(amount) > 0)) return setError("Enter the amount paid.");
    if (!payer) return setError("Choose who paid.");
    setSaving(true);
    const { error: err } = await supabase.rpc("record_supplier_payment", {
      p_supplier_id: supplier.id, p_amount: Number(amount), p_date: date, p_date_reason: dateReason || null, p_method: method,
      p_paid_by_employee_id: empId, p_paid_by_name: empId ? null : payer.slice(6), p_cash_brand: fromCustody ? cashBox : null, p_note: note || null,
    });
    setSaving(false);
    if (err) return setError(err.message);
    onSaved();
    onClose();
  }

  return (
    <Modal title={`Record payment to ${supplier.name}`} onClose={onClose}>
      <FieldLabel>Amount (EGP)</FieldLabel>
      <input style={inp} type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
      <FieldLabel>Paid by</FieldLabel>
      <select style={inp} value={payer} onChange={(e) => setPayer(e.target.value)}>
        <option value="">Choose...</option>
        {payers.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>
      <FieldLabel>Payment method</FieldLabel>
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {METHODS.map((m) => (
          <button key={m.key} type="button" onClick={() => setMethod(m.key)} style={{ ...miniToggle, padding: "8px 14px", fontSize: 13, ...(method === m.key ? miniToggleActive : {}) }}>{m.label}</button>
        ))}
      </div>
      {fromCustody && (
        <>
          <FieldLabel>Taken from</FieldLabel>
          <select style={inp} value={cashBox} onChange={(e) => setCashBox(e.target.value)}>
            {CASH_BOXES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <p style={{ fontSize: 12, color: Number(amount) > holding ? "#ba1a1a" : theme.gray, marginTop: -8 }}>
            Holding {formatMoney(holding, { decimals: 2 })} EGP in this cash. The payment comes out of it.
          </p>
        </>
      )}
      <FieldLabel>Note (optional)</FieldLabel>
      <input style={inp} value={note} onChange={(e) => setNote(e.target.value)} />
      <DateField date={date} setDate={setDate} reason={dateReason} setReason={setDateReason} />
      {error && <p style={errText}>{error}</p>}
      <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? "Saving..." : "Record payment"}</button>
    </Modal>
  );
}

function ReturnModal({ line, po, onClose, onSaved }) {
  const [batch, setBatch] = useState(null);
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (line.batch_id) supabase.from("stock_batches").select("id, qty_remaining, purchase_price").eq("id", line.batch_id).single().then(({ data }) => setBatch(data));
  }, [line.batch_id]);
  const max = batch ? Math.min(Number(batch.qty_remaining), Number(line.qty) - Number(line.qty_returned)) : 0;

  async function save() {
    setError("");
    const q = Number(qty);
    if (!(q > 0)) return setError("Enter how many units are going back.");
    if (q > max) return setError(`Only ${qtyText(max)} left from this delivery.`);
    setSaving(true);
    const { error: err } = await supabase.rpc("return_to_supplier", { p_batch_id: line.batch_id, p_qty: q, p_reason: reason || null, p_date: null, p_date_reason: null });
    setSaving(false);
    if (err) return setError(err.message);
    onSaved();
    onClose();
  }

  return (
    <Modal title="Return to supplier" onClose={onClose}>
      <p style={{ fontSize: 13, color: theme.gray, marginTop: 0 }}>{line.item_name} · PO-{po.po_number} · {batch ? `${qtyText(max)} can go back` : "Loading..."}</p>
      <FieldLabel>How many go back</FieldLabel>
      <input type="number" min="1" max={max} style={inp} value={qty} onChange={(e) => setQty(e.target.value)} />
      <FieldLabel>Reason</FieldLabel>
      <input style={inp} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. damaged, expired, wrong item" />
      <p style={{ fontSize: 12, color: theme.navy, background: "#f6efdd", padding: "10px 12px", borderRadius: 8 }}>
        The units leave stock and {formatMoney((Number(qty) || 0) * Number(line.unit_price), { decimals: 2 })} EGP comes off what we owe, at the price on this order.
      </p>
      {error && <p style={errText}>{error}</p>}
      <button onClick={save} disabled={saving || !batch} style={primaryBtn}>{saving ? "Saving..." : "Record return"}</button>
    </Modal>
  );
}

function ReasonModal({ title, note, confirmLabel, onClose, onConfirm, onDone }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function go() {
    if (!reason.trim()) return setError("Give the reason.");
    setSaving(true);
    const { error: err } = await onConfirm(reason.trim());
    setSaving(false);
    if (err) return setError(err.message);
    onDone();
    onClose();
  }
  return (
    <Modal title={title} onClose={onClose}>
      <p style={{ fontSize: 13, color: theme.gray, marginTop: 0 }}>{note}</p>
      <FieldLabel>Reason</FieldLabel>
      <input style={inp} value={reason} onChange={(e) => setReason(e.target.value)} />
      {error && <p style={errText}>{error}</p>}
      <button onClick={go} disabled={saving} style={{ ...primaryBtn, background: "#ba1a1a" }}>{saving ? "Saving..." : confirmLabel}</button>
    </Modal>
  );
}

function AddSupplierModal({ onClose, onSaved }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    if (!name.trim()) return setError("Enter the supplier name.");
    setSaving(true);
    const { error: err } = await supabase.from("suppliers").insert({ name: name.trim(), phone: phone || null });
    setSaving(false);
    if (err) return setError(err.message.includes("duplicate") ? "A supplier with that name already exists." : err.message);
    onSaved();
    onClose();
  }
  return (
    <Modal title="Add Supplier" onClose={onClose}>
      <FieldLabel>Supplier Name</FieldLabel>
      <input style={inp} value={name} onChange={(e) => setName(e.target.value)} />
      <FieldLabel>Phone (optional)</FieldLabel>
      <input style={inp} value={phone} onChange={(e) => setPhone(e.target.value)} />
      {error && <p style={errText}>{error}</p>}
      <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? "Saving..." : "Add Supplier"}</button>
    </Modal>
  );
}

function Modal({ title, children, onClose, wide }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,11,56,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 24, width: "100%", maxWidth: wide ? 560 : 400, maxHeight: "90vh", overflowY: "auto" }}>
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

const card = { background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" };
const muted = { color: theme.gray, fontSize: 13 };
const tiny = { fontSize: 11, color: theme.gray, marginTop: 2 };
const errText = { fontSize: 12, color: "#b42318", margin: "0 0 12px" };
const table = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const th = { textAlign: "left", padding: "8px 10px", fontSize: 11, color: theme.gray, fontWeight: 700, textTransform: "uppercase", borderBottom: "1px solid #eee", whiteSpace: "nowrap" };
const td = { padding: "10px", borderBottom: "1px solid #f3f3f3", verticalAlign: "top", color: theme.navy };
const badge = { fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, display: "inline-block" };
const inp = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box", marginBottom: 16 };
const primaryBtn = { width: "100%", padding: "12px 0", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer" };
const outlineBtn = { padding: "10px 20px", borderRadius: 8, border: `1px solid ${theme.navy}`, background: "#fff", color: theme.navy, fontWeight: 600, cursor: "pointer", fontSize: 13 };
const ghostBtn = { padding: "6px 14px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontWeight: 600, fontSize: 12, cursor: "pointer", display: "inline-block" };
const smallPrimary = { padding: "6px 14px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 12 };
const linkBtn = { border: "none", background: "none", color: theme.navy, textDecoration: "underline", cursor: "pointer", fontSize: 12, padding: "0 0 0 8px" };
const tabBtn = { padding: "6px 12px", borderRadius: 999, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontSize: 12, cursor: "pointer" };
const tabBtnActive = { border: `1px solid ${theme.gold}`, background: theme.goldLight, fontWeight: 700 };
const miniToggle = { padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontSize: 11, cursor: "pointer" };
const miniToggleActive = { border: `1px solid ${theme.gold}`, background: theme.goldLight, fontWeight: 700 };
