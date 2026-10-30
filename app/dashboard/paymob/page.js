"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { theme } from "../../../lib/theme";
import { usePermissions } from "../../../lib/usePermissions";
import { formatMoney } from "../../../lib/format";
import { useT, tx, Ltr } from "../../../lib/i18n";

// Card reconciliation.
//
// The card machine reports to Paymob, not to this platform, so a payment
// marked "Visa" here is only a claim until the matching charge is found in
// Paymob. This page shows what has been proven, what has not, and - the part
// that actually costs the clinic money - card charges that no visit has
// claimed, which usually means the money was taken on the machine and written
// down as cash.
export default function PaymobPage() {
  const { t, tCode, isAr } = useT();
  const { isAdmin, loading: permsLoading } = usePermissions();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => { if (isAdmin) load(); /* eslint-disable-next-line */ }, [isAdmin]);

  async function authHeaders() {
    const { data: s } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${s?.session?.access_token || ""}` };
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/paymob/reconciliation", { headers: await authHeaders() });
      setData(await res.json());
    } catch (e) {
      setMessage(e.message);
    }
    setLoading(false);
  }

  // The same job the schedule runs. Useful right after a payment is taken at
  // the counter, because Paymob publishes the charge a little late and the
  // next scheduled tick may be minutes away.
  async function syncNow() {
    setSyncing(true); setMessage(null);
    try {
      const res = await fetch("/api/paymob/sync", { method: "POST", headers: await authHeaders() });
      const r = await res.json();
      setMessage(r.ok
        ? tx("Checked {fetched} charges. Verified {verified}. Still waiting: {waiting}.", { fetched: r.fetched, verified: r.verified, waiting: r.stillUnverified ?? 0 })
        : tx("Sync failed: {error}", { error: tx(r.error) }));
      await load();
    } catch (e) {
      setMessage(e.message);
    }
    setSyncing(false);
  }

  async function dismiss(id) {
    const note = window.prompt(tx("Why does this charge need no action? (recorded with your name)"));
    if (note === null) return;
    const res = await fetch("/api/paymob/reconciliation", {
      method: "POST",
      headers: { ...(await authHeaders()), "Content-Type": "application/json" },
      body: JSON.stringify({ transactionId: id, note }),
    });
    if (!res.ok) { const r = await res.json(); setMessage(r.error); return; }
    await load();
  }

  if (permsLoading) return <p style={{ color: theme.gray }}>{t("Loading...")}</p>;
  if (!isAdmin) return <p style={{ color: theme.gray }}>{t("You do not have access to this page.")}</p>;
  if (loading) return <p style={{ color: theme.gray }}>{t("Loading card reconciliation...")}</p>;

  // Renamed from `t` so it no longer shadows the translate function.
  const tot = data?.totals || {};
  const card = { background: theme.white, border: "1px solid #e3e6e9", borderRadius: 10, padding: 14 };
  const th = { textAlign: "start", fontSize: 11, color: theme.gray, fontWeight: 700, padding: "6px 8px", borderBottom: "1px solid #e3e6e9" };
  const td = { fontSize: 13, padding: "8px 8px", borderBottom: "1px solid #f0f1f2" };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ color: theme.navy, margin: 0, fontSize: 22 }}>{t("Card reconciliation")}</h1>
          <p style={{ color: theme.gray, fontSize: 13, margin: "4px 0 0" }}>
            {t("Terminal")} <Ltr>{data?.terminal}</Ltr> · {t("last charge seen")} <Ltr>{data?.lastCharge ? data.lastCharge.replace("T", " ") : "—"}</Ltr>
          </p>
        </div>
        <button
          onClick={syncNow}
          disabled={syncing}
          style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: theme.gold, color: theme.navy, fontWeight: 700, fontSize: 13, cursor: "pointer" }}
        >
          {syncing ? t("Checking Paymob...") : t("Check Paymob now")}
        </button>
      </div>

      {message && (
        <p style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "#f6faf7", border: "1px solid #dbe7de", fontSize: 13, color: theme.gray }}>
          {t(message)}
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginTop: 16 }}>
        <Stat label={t("Card payments proven")} value={formatMoney(tot.verified_visa_amount || 0)} sub={t("{n} payments", { n: tot.verified_visa_count || 0 })} tone="green" />
        <Stat label={t("Paymob fees on those")} value={formatMoney(tot.verified_fees || 0)} sub={t("Clinic banks the rest")} />
        <Stat label={t("Card payments not proven")} value={formatMoney(tot.unverified_card_amount || 0)} sub={t("{n} to review", { n: tot.unverified_card_count || 0 })} tone={Number(tot.unverified_card_count) > 0 ? "yellow" : "green"} />
        <Stat label={t("Charges nobody claimed")} value={formatMoney(tot.unclaimed_charge_amount || 0)} sub={t("{n} on the terminal", { n: tot.unclaimed_charge_count || 0 })} tone={Number(tot.unclaimed_charge_count) > 0 ? "red" : "green"} />
      </div>

      <p style={{ fontSize: 12, color: theme.gray, marginTop: 10 }}>
        {t("Payments taken before the platform went live were classified in one pass against the full Paymob history: {n} of them ({amount}) had no matching card charge and are recorded as cash collected.", { n: tot.assumed_cash_count || 0, amount: formatMoney(tot.assumed_cash_amount || 0) })}
      </p>

      <div style={{ ...card, marginTop: 18 }}>
        <h2 style={{ color: theme.navy, fontSize: 16, margin: "0 0 4px" }}>{t("Charges no visit has claimed")}</h2>
        <p style={{ fontSize: 12, color: theme.gray, margin: "0 0 10px" }}>
          {t("Money that went through the card machine with no card payment recorded against it. Check the visit for that time: if it was logged as cash, correct the method on the visit so the cash total stops carrying money nobody is holding.")}
        </p>
        {(data?.unclaimedCharges || []).length === 0 ? (
          <p style={{ fontSize: 13, color: "#1e7a3c", margin: 0 }}>{t("Every card charge is accounted for.")}</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>{t("When")}</th><th style={th}>{t("Amount")}</th><th style={th}>{t("Fee")}</th>
                  <th style={th}>{t("Card")}</th><th style={th}>{t("Settled")}</th><th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {data.unclaimedCharges.map((c) => (
                  <tr key={c.id} style={{ opacity: c.review_status === "dismissed" ? 0.5 : 1 }}>
                    <td style={td}>{String(c.created_at_paymob).replace("T", " ").slice(0, 16)}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{formatMoney(c.amount)}</td>
                    <td style={td}>{formatMoney(c.fees || 0)}</td>
                    <td style={td}><Ltr>{c.card_brand || "—"} {c.card_last4 ? `····${c.card_last4}` : ""}</Ltr></td>
                    <td style={td}>{c.is_settled ? t("Yes") : t("Not yet")}</td>
                    <td style={td}>
                      {c.review_status === "dismissed" ? (
                        <span style={{ fontSize: 12, color: theme.gray }}>{t("Reviewed")}</span>
                      ) : (
                        <button onClick={() => dismiss(c.id)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: theme.gold, fontSize: 12, fontWeight: 700, textDecoration: "underline" }}>
                          {t("No action needed")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ ...card, marginTop: 14 }}>
        <h2 style={{ color: theme.navy, fontSize: 16, margin: "0 0 4px" }}>{t("Card payments waiting on proof")}</h2>
        <p style={{ fontSize: 12, color: theme.gray, margin: "0 0 10px" }}>
          {t("Recorded as card, no matching charge found yet. A payment taken in the last few minutes belongs here until Paymob publishes it. One that stays here usually means a single card charge covered several visits, or the amount was typed differently at the machine.")}
        </p>
        {(data?.unverifiedPayments || []).length === 0 ? (
          <p style={{ fontSize: 13, color: "#1e7a3c", margin: 0 }}>{t("Every card payment is proven.")}</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>{t("When")}</th><th style={th}>{t("Amount")}</th><th style={th}>{t("Method")}</th>
                  <th style={th}>{t("Logged by")}</th><th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {data.unverifiedPayments.map((p) => (
                  <tr key={p.id}>
                    <td style={td}>{String(p.paid_at).replace("T", " ").slice(0, 16)}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{formatMoney(p.amount)}</td>
                    <td style={td}>{isAr ? tCode(p.payment_method) : p.payment_method}</td>
                    <td style={td}>{p.created_by_name || "—"}</td>
                    <td style={td}>
                      <a href={`/dashboard/patients?visit=${p.visit_id}`} style={{ color: theme.gold, fontSize: 12, fontWeight: 700 }}>
                        {t("Open visit")}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }) {
  const tones = {
    green: { bg: "#f6faf7", border: "#dbe7de", text: "#1e7a3c" },
    yellow: { bg: "#fffaf0", border: "#eddcb4", text: "#8a6d00" },
    red: { bg: "#fff5f5", border: "#f0c9c9", text: "#ba1a1a" },
  };
  const s = tones[tone] || { bg: theme.white, border: "#e3e6e9", text: theme.navy };
  return (
    <div style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 11, color: theme.gray, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: s.text, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: theme.gray, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
