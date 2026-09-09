"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";
import { formatMoney } from "../../lib/format";

// El3awama has no doctor-request flow the way Dental does - nobody orders F&B
// through the doctor portal - so its orders are the counter sales taken at the
// till. This lists them rather than inventing a second order type that nothing
// in the business actually produces.
const PAYMENT_LABEL = {
  cash: "Cash",
  visa: "Visa",
  instapay: "InstaPay",
  wallet: "Wallet",
  vodafone_cash: "Wallet",
  staff_tab: "Staff tab",
  postponed: "On account",
};

export default function El3awamaOrdersPanel() {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("counter_sales")
      .select("id, receipt_no, net_amount, payment_method, entry_date, created_by_name, note, sale_type")
      .eq("brand", "el3awama_stock")
      .order("entry_date", { ascending: false })
      .limit(200);
    setSales(data || []);
    setLoading(false);
  }

  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
      <h2 style={{ color: theme.navy, fontSize: 18, margin: "0 0 4px" }}>El3awama Counter Sales</h2>
      <p style={{ color: theme.gray, fontSize: 13, margin: "0 0 16px" }}>
        Walk-up sales taken at the till, most recent first.
      </p>
      {loading && <p style={{ color: theme.gray, fontSize: 13 }}>Loading...</p>}
      {!loading && sales.length === 0 && (
        <p style={{ color: theme.gray, fontSize: 13 }}>No counter sales recorded for El3awama yet.</p>
      )}
      {sales.map((s) => (
        <div
          key={s.id}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            padding: "10px 0",
            borderBottom: "1px solid #f0f0f0",
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ color: theme.navy, fontWeight: 600 }}>
              {s.receipt_no || "Counter sale"}
              {s.sale_type === "staff_tab" && (
                <span style={{ marginLeft: 8, fontSize: 11, color: theme.gray }}>staff tab</span>
              )}
            </div>
            <div style={{ color: theme.gray, fontSize: 12 }}>
              {s.entry_date} · {PAYMENT_LABEL[s.payment_method] || s.payment_method}
              {s.created_by_name ? ` · ${s.created_by_name}` : ""}
            </div>
          </div>
          <div style={{ color: theme.navy, fontWeight: 700 }}>{formatMoney(s.net_amount)} EGP</div>
        </div>
      ))}
    </div>
  );
}
