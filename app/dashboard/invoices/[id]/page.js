"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import { formatMoney, formatVisitDate } from "../../../../lib/format";
import { APP_URL } from "../../../../lib/appUrl";

// One button definition for all four actions. They previously each carried
// their own inline styles and had drifted into four different widths, weights
// and colours; the only thing that should differ is whether an action is the
// primary one.
const BUTTON_BASE = {
  width: "100%",
  padding: "11px 14px",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 700,
  fontFamily: "inherit",
  lineHeight: 1.25,
  cursor: "pointer",
  transition: "opacity .15s",
  whiteSpace: "nowrap",
};

function ActionButton({ children, onClick, disabled, primary, title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        ...BUTTON_BASE,
        border: primary ? "1px solid transparent" : `1px solid ${theme.gold}`,
        background: primary ? theme.gold : "#fff",
        color: theme.navy,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  );
}

function Field({ label, value, big }) {
  return (
    <div style={{ marginBottom: big ? 26 : 20 }}>
      <div style={{ fontSize: 10.5, letterSpacing: 0.8, color: theme.gray, fontWeight: 700, marginBottom: 5 }}>
        {label}
      </div>
      <div style={{ fontSize: big ? 30 : 15, fontWeight: big ? 800 : 600, color: theme.navy, lineHeight: 1.3 }}>
        {value || "—"}
      </div>
    </div>
  );
}

export default function InvoiceViewPage() {
  const { id } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [patientMobile, setPatientMobile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [id]);

  async function load() {
    const { data: inv } = await supabase.from("invoices").select("*").eq("id", id).single();
    setInvoice(inv);
    if (inv?.visit_id) {
      const { data: visit } = await supabase.from("visits").select("patient_id").eq("id", inv.visit_id).single();
      if (visit?.patient_id) {
        const { data: patient } = await supabase.from("patients").select("mobile").eq("id", visit.patient_id).single();
        setPatientMobile(patient?.mobile);
      }
    }
    setLoading(false);
  }

  // Two variants of the same receipt: the plain one, which is printed and
  // sealed by hand, and a digitally stamped copy for sending without printing.
  function openPdf(stamped) {
    window.open(`/api/invoices/${id}/pdf${stamped ? "?stamp=1" : ""}`, "_blank");
  }

  function sendWhatsApp(stamped) {
    if (!patientMobile) return;
    const pdfUrl = `${APP_URL}/api/invoices/${id}/pdf${stamped ? "?stamp=1" : ""}`;
    const text =
      `Al Shrooouk Scan & Lab — Receipt ${invoice.invoice_number}\n` +
      `Amount: ${formatMoney(invoice.amount)} EGP\n` +
      `Patient: ${invoice.patient_name}\n` +
      `Exam: ${invoice.exam}\n` +
      `Date: ${formatVisitDate(invoice.exam_date)}\n\n` +
      `View/Download Receipt: ${pdfUrl}`;
    window.open(
      `https://api.whatsapp.com/send?phone=${patientMobile}&text=${encodeURIComponent(text)}`,
      "_blank"
    );
  }

  const centred = { minHeight: "70vh", display: "flex", alignItems: "center", justifyContent: "center" };
  if (loading) return <div style={{ ...centred, color: theme.gray }}>Loading...</div>;
  if (!invoice) return <div style={{ ...centred, color: theme.gray }}>Receipt not found.</div>;

  const noMobile = !patientMobile;

  return (
    // Centred in the page both ways, rather than pinned to the top-left.
    <div style={{ minHeight: "78vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}>
      <style>{`
        @media print {
          aside, .no-print { display: none !important; }
          body { background: #fff !important; }
        }
      `}</style>

      <div
        style={{
          width: "100%",
          maxWidth: 520,
          background: "#fff",
          borderRadius: 18,
          overflow: "hidden",
          boxShadow: "0 10px 44px rgba(39,33,77,0.13)",
        }}
      >
        <div style={{ background: theme.navy, color: "#fff", padding: "24px 30px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>Al Shrooouk Scan &amp; Lab</h2>
              <p style={{ margin: "4px 0 0", fontSize: 12, opacity: 0.75 }}>Medical Center 3 &middot; Nasr City</p>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 9.5, opacity: 0.65, letterSpacing: 1, fontWeight: 700 }}>RECEIPT NUMBER</div>
              <div style={{ fontSize: 17, fontWeight: 800, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
                {invoice.invoice_number}
              </div>
            </div>
          </div>
        </div>

        <div style={{ padding: "28px 30px 4px" }}>
          <Field label="TOTAL AMOUNT DUE" value={`${formatMoney(invoice.amount)} EGP`} big />
          <Field label="PATIENT NAME" value={invoice.patient_name} />
          <Field label="EXAM / SCAN TYPE" value={invoice.exam} />
          <Field label="EXAM DATE" value={formatVisitDate(invoice.exam_date)} />
        </div>

        <div className="no-print" style={{ padding: "8px 30px 30px" }}>
          <div style={{ height: 1, background: "#EDECF0", marginBottom: 20 }} />

          <div style={{ fontSize: 10.5, letterSpacing: 0.8, color: theme.gray, fontWeight: 700, marginBottom: 10 }}>
            SEND TO PATIENT
          </div>
          {/* Equal columns, so the four actions are the same width whatever
              their label length. */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
            <ActionButton onClick={() => sendWhatsApp(false)} disabled={noMobile}
              title={noMobile ? "This patient has no mobile number on record." : "Send the plain receipt"}>
              WhatsApp — plain
            </ActionButton>
            <ActionButton onClick={() => sendWhatsApp(true)} disabled={noMobile} primary
              title={noMobile ? "This patient has no mobile number on record." : "Send the stamped receipt"}>
              WhatsApp — stamped
            </ActionButton>
          </div>

          <div style={{ fontSize: 10.5, letterSpacing: 0.8, color: theme.gray, fontWeight: 700, marginBottom: 10 }}>
            DOWNLOAD
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <ActionButton onClick={() => openPdf(false)} title="Print this copy and stamp it by hand">
              PDF — plain
            </ActionButton>
            <ActionButton onClick={() => openPdf(true)} primary title="Carries the clinic seal">
              PDF — stamped
            </ActionButton>
          </div>

          {noMobile && (
            <p style={{ fontSize: 11.5, color: "#A9762B", margin: "14px 0 0", lineHeight: 1.5 }}>
              This patient has no mobile number on record, so the receipt can&apos;t be sent on WhatsApp. Add one to
              their record to enable it.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
