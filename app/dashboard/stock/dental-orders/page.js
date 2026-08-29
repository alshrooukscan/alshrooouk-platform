"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import { formatMoney } from "../../../../lib/format";

const PAYMENT_LABEL = { cash: "Cash", visa: "Visa", instapay: "InstaPay", vodafone_cash: "Vodafone Cash" };

export default function DentalOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [itemsByOrder, setItemsByOrder] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("dental_orders")
      .select("*, doctors(name, clinic_name)")
      .order("created_at", { ascending: false });
    setOrders(data || []);
    setLoading(false);
  }

  async function toggleExpand(orderId) {
    if (expanded === orderId) {
      setExpanded(null);
      return;
    }
    setExpanded(orderId);
    if (!itemsByOrder[orderId]) {
      const { data } = await supabase.from("dental_order_items").select("*").eq("order_id", orderId);
      setItemsByOrder((prev) => ({ ...prev, [orderId]: data || [] }));
    }
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: theme.gray, margin: "0 0 4px" }}>Inventory Management</p>
      <h1 style={{ color: theme.navy, margin: "0 0 4px" }}>Dental Stock Orders</h1>
      <p style={{ color: theme.gray, margin: "0 0 24px" }}>Every order a doctor has placed through their portal's Dental Stock shop.</p>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        {!loading && orders.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>No orders yet.</p>}
        <div style={{ display: "grid", gap: 8 }}>
          {orders.map((o) => (
            <div key={o.id} style={{ borderBottom: "1px solid #f0f0f0", padding: "12px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => toggleExpand(o.id)}>
                <div>
                  <div style={{ fontWeight: 700, color: theme.navy, fontSize: 14 }}>{o.doctors?.name || "Unknown doctor"} - {o.doctors?.clinic_name}</div>
                  <div style={{ fontSize: 12, color: theme.gray }}>
                    {new Date(o.created_at).toLocaleString()} \u00b7 via {PAYMENT_LABEL[o.payment_method] || o.payment_method}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontWeight: 700, color: theme.navy, fontSize: 14 }}>{formatMoney(o.total_amount)} EGP</span>
                  <span style={{ color: theme.gold, fontSize: 12, fontWeight: 600 }}>{expanded === o.id ? "Hide" : "View"} items</span>
                </div>
              </div>
              {expanded === o.id && (
                <div style={{ marginTop: 10, paddingLeft: 4 }}>
                  {(itemsByOrder[o.id] || []).map((it) => (
                    <div key={it.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}>
                      <span>{it.item_name} \u00d7 {it.quantity}</span>
                      <span style={{ color: theme.gray }}>{formatMoney(it.line_total)} EGP</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
