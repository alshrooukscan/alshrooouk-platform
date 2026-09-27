"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../../../../lib/supabase";
import { theme } from "../../../../../../lib/theme";
import { formatMoney } from "../../../../../../lib/format";

// A purchase invoice for one PO, laid out for A4 printing or saving as PDF from
// the browser's print dialog.

function formatDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "-";
}
const qtyText = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function PurchaseInvoicePage() {
  const { id } = useParams();
  const [po, setPo] = useState(null);
  const [lines, setLines] = useState([]);
  const [supplier, setSupplier] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const { data: p, error: e } = await supabase.from("purchase_orders").select("*").eq("id", id).maybeSingle();
      if (e || !p) return setError("Purchase order not found.");
      const [{ data: ls }, { data: s }] = await Promise.all([
        supabase.from("purchase_order_lines").select("*").eq("po_id", id).order("created_at"),
        supabase.from("suppliers").select("*").eq("id", p.supplier_id).maybeSingle(),
      ]);
      setPo(p);
      setLines(ls || []);
      setSupplier(s);
    })();
  }, [id]);

  if (error) return <p style={{ padding: 24, color: "#ba1a1a" }}>{error}</p>;
  if (!po) return <p style={{ padding: 24, color: theme.gray }}>Loading...</p>;
  const total = lines.reduce((s, l) => s + Number(l.line_total || 0), 0);
  const returned = lines.reduce((s, l) => s + Number(l.qty_returned || 0) * Number(l.unit_price || 0), 0);

  return (
    <div style={{ background: "#fff", maxWidth: 800, margin: "0 auto", padding: 32, color: theme.navy, fontFamily: "inherit" }}>
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff !important; } aside, nav { display: none !important; } } @page { size: A4; margin: 14mm; }`}</style>
      <div className="no-print" style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 16 }}>
        <button onClick={() => window.print()} style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer" }}>Print / Save as PDF</button>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: `3px solid ${theme.gold}`, paddingBottom: 16 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>Al Shrooouk Scan &amp; Lab</div>
          <div style={{ fontSize: 13, color: theme.gray }}>Purchase Invoice</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 26, fontWeight: 800 }}>PO-{po.po_number}</div>
          <div style={{ fontSize: 13, color: theme.gray }}>Date: {formatDate(po.entry_date)}</div>
          {po.status === "void" && <div style={{ fontSize: 13, fontWeight: 700, color: "#ba1a1a" }}>{po.replaced_by_id ? "EDITED, SEE NEWER VERSION" : "CANCELLED"}</div>}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", margin: "20px 0", fontSize: 13 }}>
        <div>
          <div style={{ color: theme.gray, fontSize: 11, textTransform: "uppercase", fontWeight: 700 }}>Supplier</div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{supplier?.name}</div>
          {supplier?.phone && <div>{supplier.phone}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: theme.gray, fontSize: 11, textTransform: "uppercase", fontWeight: 700 }}>Recorded by</div>
          <div>{po.created_by_name || "-"}</div>
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: theme.navy, color: "#fff" }}>
            <th style={cell}>#</th>
            <th style={{ ...cell, textAlign: "left" }}>Item</th>
            <th style={cell}>Qty</th>
            <th style={cell}>Unit price</th>
            <th style={cell}>Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ ...cell, textAlign: "center" }}>{i + 1}</td>
              <td style={{ ...cell, textAlign: "left" }}>{l.item_name}{Number(l.qty_returned) > 0 && <span style={{ color: theme.gray }}> ({qtyText(l.qty_returned)} returned)</span>}</td>
              <td style={cell}>{qtyText(l.qty)}</td>
              <td style={cell}>{formatMoney(l.unit_price, { decimals: 2 })}</td>
              <td style={cell}>{formatMoney(l.line_total, { decimals: 2 })}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <table style={{ fontSize: 14, minWidth: 260 }}>
          <tbody>
            <tr><td style={{ padding: "4px 12px", color: theme.gray }}>Order total</td><td style={{ padding: "4px 0", textAlign: "right", fontWeight: 700 }}>{formatMoney(total, { decimals: 2 })} EGP</td></tr>
            {returned > 0 && <tr><td style={{ padding: "4px 12px", color: theme.gray }}>Returned</td><td style={{ padding: "4px 0", textAlign: "right" }}>-{formatMoney(returned, { decimals: 2 })} EGP</td></tr>}
            {returned > 0 && <tr><td style={{ padding: "4px 12px", fontWeight: 700 }}>Net</td><td style={{ padding: "4px 0", textAlign: "right", fontWeight: 800 }}>{formatMoney(total - returned, { decimals: 2 })} EGP</td></tr>}
          </tbody>
        </table>
      </div>
      {po.description && <p style={{ fontSize: 12, color: theme.gray, marginTop: 24 }}>Note: {po.description}</p>}
    </div>
  );
}

const cell = { padding: "8px 10px", textAlign: "right" };
