"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";
import { formatMoney } from "../../lib/format";

// What needs reordering, and what has already gone wrong.
//
// Deliberately threshold-based, not a forecast: there are only a handful of
// recorded sales so far, so any "days of stock left" figure would be invented
// precision. Once sales history builds up, burn rate becomes worth adding.
export default function StockAlerts() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState("all");
  const [editing, setEditing] = useState(null);
  const [level, setLevel] = useState("");

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("stock_items")
      .select("id, name, category, qty_remaining, reorder_level, purchase_price, sale_price")
      .order("qty_remaining", { ascending: true });
    setItems(data || []);
    setLoading(false);
  }

  async function saveLevel(id) {
    const n = Number(level);
    if (isNaN(n) || n < 0) return;
    await supabase.from("stock_items").update({ reorder_level: n }).eq("id", id);
    setEditing(null);
    setLevel("");
    load();
  }

  if (loading) return <p style={{ color: theme.gray }}>Loading...</p>;

  const scoped = cat === "all" ? items : items.filter((i) => i.category === cat);
  const qty = (i) => Number(i.qty_remaining || 0);
  const lvl = (i) => Number(i.reorder_level ?? 3);

  const negative = scoped.filter((i) => qty(i) < 0);
  const zero = scoped.filter((i) => qty(i) === 0);
  const low = scoped.filter((i) => qty(i) > 0 && qty(i) <= lvl(i));
  const ok = scoped.filter((i) => qty(i) > lvl(i));

  // What it would cost to bring everything back up to its reorder level.
  const restockCost = [...negative, ...zero, ...low].reduce(
    (s, i) => s + Math.max(lvl(i) - qty(i), 0) * Number(i.purchase_price || 0), 0
  );

  const card = { background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" };

  const Group = ({ title, rows, tone, note }) => (
    <div style={{ ...card, marginBottom: 18 }}>
      <h3 style={{ margin: "0 0 2px", color: tone, fontSize: 15 }}>{title} ({rows.length})</h3>
      {note && <p style={{ fontSize: 12, color: theme.gray, margin: "0 0 12px" }}>{note}</p>}
      {rows.length === 0 && <p style={{ fontSize: 13, color: theme.gray, margin: 0 }}>Nothing here.</p>}
      {rows.map((i) => (
        <div key={i.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #f2f2f2" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: theme.navy, overflow: "hidden", textOverflow: "ellipsis" }}>{i.name}</div>
            <div style={{ fontSize: 11, color: theme.gray }}>
              {i.category === "dental" ? "Dental" : "El3awama"} · restock at {lvl(i)}
              {i.purchase_price ? ` · costs ${formatMoney(i.purchase_price)} EGP each` : ""}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: tone }}>{qty(i)}</span>
            {editing === i.id ? (
              <>
                <input value={level} onChange={(e) => setLevel(e.target.value)} placeholder={String(lvl(i))}
                  style={{ width: 54, padding: "5px 6px", borderRadius: 6, border: "1px solid #ddd", fontSize: 12 }} />
                <button onClick={() => saveLevel(i.id)} style={miniBtn(theme.navy, "#fff")}>Save</button>
                <button onClick={() => setEditing(null)} style={miniBtn("#fff", theme.navy)}>×</button>
              </>
            ) : (
              <button onClick={() => { setEditing(i.id); setLevel(String(lvl(i))); }} style={miniBtn("#fff", theme.navy)}>
                Set level
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <h1 style={{ color: theme.navy, marginBottom: 4 }}>Stock Alerts</h1>
      <p style={{ color: theme.gray, marginBottom: 18 }}>
        What has run out, what is about to, and what it would cost to restock.
      </p>

      <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
        {[{ k: "all", l: "All" }, { k: "dental", l: "Dental" }, { k: "el3awama", l: "El3awama" }].map((c) => (
          <button key={c.k} onClick={() => setCat(c.k)}
            style={{ padding: "8px 18px", borderRadius: 8, border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer",
              background: cat === c.k ? theme.navy : "#fff", color: cat === c.k ? "#fff" : theme.navy,
              boxShadow: "0 2px 8px rgba(39,33,77,0.06)" }}>{c.l}</button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 22 }}>
        {[
          { l: "Negative", v: negative.length, c: "#7a1010" },
          { l: "Out of stock", v: zero.length, c: "#ba1a1a" },
          { l: "Below reorder level", v: low.length, c: "#a97c00" },
          { l: "Cost to restock", v: `${formatMoney(restockCost)} EGP`, c: theme.navy },
        ].map((k) => (
          <div key={k.l} style={card}>
            <div style={{ fontSize: 10, color: theme.gray, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>{k.l}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: k.c }}>{k.v}</div>
          </div>
        ))}
      </div>

      <Group title="Negative stock" rows={negative} tone="#7a1010"
        note="More has been sold than was ever recorded coming in. Either a delivery was never entered, or a sale was recorded twice — worth checking before reordering." />
      <Group title="Out of stock" rows={zero} tone="#ba1a1a"
        note="These can still be ordered by doctors and will fail at checkout." />
      <Group title="Running low" rows={low} tone="#a97c00"
        note="At or below the restock level. Set a different level per item where the default of 3 doesn't fit." />

      <div style={{ ...card }}>
        <h3 style={{ margin: "0 0 8px", color: theme.navy, fontSize: 15 }}>Healthy stock ({ok.length})</h3>
        <p style={{ fontSize: 12, color: theme.gray, margin: 0 }}>
          {ok.length} item{ok.length === 1 ? "" : "s"} above their restock level.
        </p>
      </div>
    </div>
  );
}

function miniBtn(bg, fg) {
  return { padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", background: bg, color: fg, fontSize: 11, fontWeight: 700, cursor: "pointer" };
}
