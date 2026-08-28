"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import { usePermissions } from "../../../../lib/usePermissions";
import { formatMoney } from "../../../../lib/format";
import { logActivity } from "../../../../lib/activityLog";

const BRAND_LABEL = { scan: "Scan", dental_stock: "Dental Stock", el3awama_stock: "El3awama Stock" };
const TYPE_LABEL = {
  cash_out: "Cash Out",
  cash_transfer: "Cash Transfer",
  cash_collection: "Cash Collection",
  brand_transfer: "Brand Transfer",
  stock_sale: "Stock Sale",
  visit_collection: "Visit Collection",
};
const PAYMENT_LABEL = { cash: "Cash", visa: "Visa", instapay: "InstaPay", vodafone_cash: "Vodafone Cash" };

export default function ConfirmationQueuePage() {
  const { isAdmin, loading: permsLoading, profile } = usePermissions();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [statusFilter, setStatusFilter] = useState("pending");

  useEffect(() => {
    if (!permsLoading && isAdmin) load();
  }, [permsLoading, isAdmin, statusFilter]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("expense_transactions")
      .select("*, from_employee:from_employee_id(name), to_employee:to_employee_id(name)")
      .eq("status", statusFilter)
      .order("created_at", { ascending: false });
    setItems(data || []);
    setLoading(false);
  }

  async function review(item, newStatus) {
    setBusyId(item.id);
    const { data: session } = await supabase.auth.getSession();
    await supabase
      .from("expense_transactions")
      .update({
        status: newStatus,
        confirmed_by_id: session.session?.user?.id || null,
        confirmed_by_name: profile?.name || null,
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    logActivity({
      actorId: profile?.id,
      actorName: profile?.name,
      actorType: "admin",
      action: `expense_${newStatus}`,
      entityType: "expense_transaction",
      entityId: item.id,
      details: { type: item.type, brand: item.brand, amount: item.amount },
    });
    await load();
    setBusyId(null);
  }

  if (permsLoading) return <p style={{ color: theme.gray }}>Loading...</p>;
  if (!isAdmin) return <p style={{ color: theme.gray }}>Admin access required.</p>;

  return (
    <div>
      <p style={{ fontSize: 12, color: theme.gray, margin: "0 0 4px" }}>Expenses Management</p>
      <h1 style={{ color: theme.navy, margin: "0 0 4px" }}>Confirmation Queue</h1>
      <p style={{ color: theme.gray, margin: "0 0 20px" }}>
        Every Cash Collection, every non-cash Cash Out, and every Brand Transfer waits here for you to confirm.
      </p>

      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {["pending", "confirmed", "rejected"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            style={{
              padding: "6px 16px",
              borderRadius: 999,
              border: `1px solid ${statusFilter === s ? theme.gold : "#ddd"}`,
              background: statusFilter === s ? theme.goldLight : "#fff",
              color: theme.navy,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {s}
          </button>
        ))}
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        {!loading && items.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>Nothing {statusFilter}.</p>}
        <div style={{ display: "grid", gap: 8 }}>
          {items.map((tx) => (
            <div key={tx.id} style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 0", borderBottom: "1px solid #f0f0f0" }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: "#eef2ff", color: "#3949ab", minWidth: 100, textAlign: "center" }}>
                {TYPE_LABEL[tx.type] || tx.type}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: theme.navy, fontSize: 14 }}>
                  {formatMoney(tx.amount)} EGP <span style={{ fontWeight: 500, color: theme.gray }}>via {PAYMENT_LABEL[tx.payment_method]}</span>
                </div>
                <div style={{ fontSize: 12, color: theme.gray }}>
                  {BRAND_LABEL[tx.brand]}
                  {tx.to_brand && ` \u2192 ${BRAND_LABEL[tx.to_brand]}`}
                  {tx.from_employee?.name && ` \u00b7 From ${tx.from_employee.name}`}
                  {tx.to_employee?.name && ` \u00b7 To ${tx.to_employee.name}`}
                  {tx.category && ` \u00b7 ${tx.category}`}
                </div>
                {tx.note && <div style={{ fontSize: 12, color: theme.gray, fontStyle: "italic" }}>{tx.note}</div>}
                <div style={{ fontSize: 11, color: theme.gray }}>
                  {tx.entry_date} · logged by {tx.created_by_name || "unknown"}
                  {tx.confirmed_by_name && ` \u00b7 reviewed by ${tx.confirmed_by_name}`}
                </div>
              </div>
              {tx.status === "pending" && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => review(tx, "confirmed")} disabled={busyId === tx.id} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#2e7d32", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
                    Confirm
                  </button>
                  <button onClick={() => review(tx, "rejected")} disabled={busyId === tx.id} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, cursor: "pointer", fontSize: 12 }}>
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
