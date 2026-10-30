"use client";

// One badge for "is this money proven?", used wherever a payment is listed
// (Mohamed Said, 30 Oct 2026): patient visits, account payments, counter
// sales and cash conversions all read the same way.
//
//   Card / wallet: Verified once matched to a Paymob charge, otherwise
//                  "Awaiting card proof".
//   InstaPay:      Verified once an admin confirms it in the Action Center,
//                  otherwise "Awaiting verification". Rejected shows red.
//   Cash:          nothing.

const pill = {
  display: "inline-block", marginLeft: 6, padding: "1px 7px", borderRadius: 999,
  fontSize: 10, fontWeight: 700, verticalAlign: "middle", whiteSpace: "nowrap",
};
const GREEN = { background: "#e8f5e9", border: "1px solid #c8e6c9", color: "#1e7a3c" };
const AMBER = { background: "#fffaf0", border: "1px solid #eddcb4", color: "#8a6d00" };
const RED = { background: "#fdecea", border: "1px solid #f5c2c0", color: "#ba1a1a" };

export default function VerifyPill({ method, verification, paymobId, cardLast4, verifiedBy }) {
  const m = String(method || "").toLowerCase();
  const v = verification || "";

  if (m === "instapay") {
    if (v === "verified_instapay")
      return <span style={{ ...pill, ...GREEN }} title={verifiedBy ? `Confirmed by ${verifiedBy}` : "Confirmed by an admin"}>✓ Verified</span>;
    if (v === "rejected_instapay")
      return <span style={{ ...pill, ...RED }} title={verifiedBy ? `Rejected by ${verifiedBy}` : "Rejected"}>✕ Not received</span>;
    return <span style={{ ...pill, ...AMBER }} title="Waiting for an admin to confirm the transfer arrived (Action Center)">Awaiting verification</span>;
  }

  if (m === "visa" || m === "wallet" || m === "card") {
    if (paymobId || v.startsWith("verified"))
      return <span style={{ ...pill, ...GREEN }} title={paymobId ? `Paymob transaction ${paymobId}` : "Matched on Paymob"}>✓ Verified{cardLast4 ? ` · ••${cardLast4}` : ""}</span>;
    if (v === "rejected_card")
      return <span style={{ ...pill, ...RED }} title={verifiedBy ? `Marked by ${verifiedBy}: not paid by card, fix the method` : "Not paid by card"}>✕ Not on Paymob</span>;
    if (v === "approved_by_admin")
      return <span style={{ ...pill, background: "#f4f6fb", border: "1px solid #ccd6ea", color: "#31518f" }} title="No Paymob charge; an admin confirmed the money arrived">✓ Approved by {verifiedBy || "admin"}</span>;
    return <span style={{ ...pill, ...AMBER }} title="No matching Paymob charge found yet">Awaiting card proof</span>;
  }
  return null;
}
