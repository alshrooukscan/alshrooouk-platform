"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";
import { formatMoney } from "../../lib/format";

// Laid out to match Dental Stock Orders, because staff switch between the two
// tabs and a different shape on each side makes them read twice.
//
// The figures are NOT the dental ones renamed. El3awama has no doctor-request
// flow - nobody orders F&B through the doctor portal - so there is nothing
// awaiting review and nothing to deliver. Inventing those two cards to fill
// the row would have meant two boxes reading zero forever, which teaches
// people to stop reading the row. Its real work is the counter: what was sold,
// what was collected, what is still on account, and staff tabs.
const PAYMENT_LABEL = {
  cash: "Cash", visa: "Visa", instapay: "InstaPay", wallet: "Wallet",
  vodafone_cash: "Wallet", staff_tab: "Staff tab", postponed: "On account",
};

export default function El3awamaOrdersPanel() {
  const [sales, setSales] = useState([]);
  const [lines, setLines] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [{ data: s }, { data: l }] = await Promise.all([
      supabase
        .from("counter_sales")
        .select("id, receipt_no, net_amount, gross_amount, payment_method, sale_type, entry_date, created_by_name, note, customer_type, customer_id")
        .eq("brand", "el3awama_stock")
        .order("entry_date", { ascending: false })
        .limit(300),
      supabase
        .from("customer_ar_ledger")
        .select("customer_type, customer_id, direction, amount")
        .eq("brand", "el3awama_stock"),
    ]);
    setSales(s || []);
    setLedger(l || []);

    const ids = (s || []).map((x) => x.id);
    if (ids.length) {
      const { data: li } = await supabase
        .from("counter_sale_items")
        .select("sale_id, item_name, quantity")
        .in("sale_id", ids);
      setLines(li || []);
    } else {
      setLines([]);
    }
    setLoading(false);
  }

  const collected = sales
    .filter((x) => x.payment_method !== "postponed")
    .reduce((sum, x) => sum + Number(x.net_amount || 0), 0);
  const sold = sales.reduce((sum, x) => sum + Number(x.net_amount || 0), 0);
  const outstanding = ledger.reduce(
    (sum, l) => sum + (l.direction === "charge" ? Number(l.amount) : -Number(l.amount)),
    0
  );
  const onAccount = sales.filter((x) => x.payment_method === "postponed").length;
  const staffTabs = sales.filter((x) => x.sale_type === "staff_tab").length;

  const topItems = Object.entries(
    lines.reduce((acc, l) => {
      acc[l.item_name] = (acc[l.item_name] || 0) + Number(l.quantity || 0);
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]).slice(0, 6);

  const unpaid = sales.filter((x) => x.payment_method === "postponed");

  const shown = sales.filter((x) => {
    if (filter === "account") return x.payment_method === "postponed";
    if (filter === "tab") return x.sale_type === "staff_tab";
    if (filter === "paid") return x.payment_method !== "postponed" && x.sale_type !== "staff_tab";
    return true;
  });

  return (
    <div>
      <h1 style={{ color: theme.navy, marginBottom: 4 }}>El3awama Stock Orders</h1>
      <p style={{ color: theme.gray, marginBottom: 20 }}>
        Sales taken at the El3awama counter &mdash; what was sold, what was collected, and what is still on account.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 22 }}>
        {[
          { label: "Outstanding", value: `${formatMoney(outstanding)} EGP`, color: outstanding > 0 ? "#ba1a1a" : theme.navy },
          { label: "Collected", value: `${formatMoney(collected)} EGP`, color: "#1e7a3c" },
          { label: "Total sold", value: `${formatMoney(sold)} EGP`, color: theme.navy },
          { label: "On account", value: onAccount, color: onAccount ? "#a97c00" : theme.navy },
          { label: "Staff tabs", value: staffTabs, color: theme.navy },
        ].map((k) => (
          <div key={k.label} style={card}>
            <div style={{ fontSize: 10, color: theme.gray, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>{k.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 22 }}>
        <div style={card}>
          <h3 style={{ margin: "0 0 10px", color: theme.navy, fontSize: 15 }}>Sales still on account</h3>
          {unpaid.length === 0 && <p style={{ color: theme.gray, fontSize: 13, margin: 0 }}>Nobody owes anything.</p>}
          {unpaid.slice(0, 6).map((x) => (
            <div key={x.id} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #f2f2f2", fontSize: 13 }}>
              <span style={{ color: theme.navy, fontWeight: 600 }}>{x.receipt_no || x.entry_date}</span>
              <span style={{ color: "#ba1a1a", fontWeight: 700 }}>{formatMoney(x.net_amount)} EGP</span>
            </div>
          ))}
        </div>
        <div style={card}>
          <h3 style={{ margin: "0 0 10px", color: theme.navy, fontSize: 15 }}>Most sold items</h3>
          {topItems.length === 0 && <p style={{ color: theme.gray, fontSize: 13, margin: 0 }}>Nothing sold yet.</p>}
          {topItems.map(([name, qty]) => (
            <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #f2f2f2", fontSize: 13 }}>
              <span style={{ color: theme.navy }}>{name}</span>
              <span style={{ color: theme.gray, fontWeight: 700 }}>{qty}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {[
          { k: "all", l: "All" },
          { k: "account", l: "On account" },
          { k: "tab", l: "Staff tabs" },
          { k: "paid", l: "Paid" },
        ].map((f) => (
          <button
            key={f.k}
            onClick={() => setFilter(f.k)}
            style={{
              padding: "7px 16px", borderRadius: 8, border: "none", fontSize: 12, fontWeight: 700,
              cursor: "pointer", background: filter === f.k ? theme.navy : "#fff",
              color: filter === f.k ? "#fff" : theme.navy, boxShadow: "0 2px 8px rgba(39,33,77,0.06)",
            }}
          >
            {f.l}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: theme.gray, fontSize: 13 }}>Loading...</p>}
      {!loading && shown.length === 0 && (
        <p style={{ color: theme.gray, fontSize: 13 }}>
          {sales.length === 0 ? "No counter sales recorded for El3awama yet." : "Nothing matches this filter."}
        </p>
      )}
      {shown.map((x) => (
        <div key={x.id} style={{ ...card, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ color: theme.navy, fontWeight: 700 }}>
              {x.receipt_no || "Counter sale"}
              {x.sale_type === "staff_tab" && (
                <span style={{ marginLeft: 8, fontSize: 10, padding: "2px 8px", borderRadius: 999, background: "#e8eefc", color: theme.navy, fontWeight: 700 }}>
                  Staff tab
                </span>
              )}
              {x.payment_method === "postponed" && (
                <span style={{ marginLeft: 8, fontSize: 10, padding: "2px 8px", borderRadius: 999, background: "#fdecea", color: "#ba1a1a", fontWeight: 700 }}>
                  On account
                </span>
              )}
            </div>
            <div style={{ color: theme.gray, fontSize: 12, marginTop: 2 }}>
              {x.entry_date} &middot; {PAYMENT_LABEL[x.payment_method] || x.payment_method}
              {x.created_by_name ? ` · ${x.created_by_name}` : ""}
              {x.note ? ` · ${x.note}` : ""}
            </div>
          </div>
          <div style={{ color: theme.navy, fontWeight: 700, whiteSpace: "nowrap" }}>{formatMoney(x.net_amount)} EGP</div>
        </div>
      ))}
    </div>
  );
}

const card = { background: "#fff", borderRadius: 12, padding: 16, boxShadow: "0 2px 10px rgba(39,33,77,0.05)" };
