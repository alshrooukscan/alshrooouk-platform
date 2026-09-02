"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import { formatMoney } from "../../../../lib/format";

export default function InvoiceViewPage() {
  const { id } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [patientMobile, setPatientMobile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, [id]);

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

  // Two variants: the plain receipt, which is printed and sealed by hand, and
  // a digitally stamped copy for sending without printing.
  function handleDownloadPdf(stamped) {
    window.open(`/api/invoices/${id}/pdf${stamped ? "?stamp=1" : ""}`, "_blank");
  }

  function handleSendWhatsApp() {
    if (!patientMobile) return;
    const pdfUrl = `${window.location.origin}/api/invoices/${id}/pdf?stamp=1`;
    const text =
      `Al Shrooouk Scan & Lab — Receipt ${invoice.invoice_number}\n` +
      `Amount: ${formatMoney(invoice.amount)} EGP\n` +
      `Patient: ${invoice.patient_name}\n` +
      `Exam: ${invoice.exam}\n` +
      `Date: ${invoice.exam_date}\n\n` +
      `View/Download Receipt: ${pdfUrl}`;
    const link = `https://api.whatsapp.com/send?phone=${patientMobile}&text=${encodeURIComponent(text)}`;
    window.open(link, "_blank");
  }

  if (loading) return <p style={{ color: theme.gray }}>Loading...</p>;
  if (!invoice) return <p style={{ color: theme.gray }}>Invoice not found.</p>;

  return (
    <div>
      <style>{`
        @media print {
          aside, .no-print { display: none !important; }
          body { background: #fff !important; }
        }
      `}</style>

      <div
        style={{
          maxWidth: 560,
          margin: "0 auto",
          background: "#fff",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 8px 40px rgba(39,33,77,0.12)",
        }}
      >
        <div style={{ background: theme.navy, color: "#fff", padding: "28px 32px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 22 }}>Al Shrooouk Scan &amp; Lab</h2>
              <p style={{ margin: "4px 0 0", fontSize: 13, opacity: 0.8 }}>
                Medical Center 3 &middot; Nasr City
              </p>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, opacity: 0.7, letterSpacing: 1 }}>RECEIPT NUMBER</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{invoice.invoice_number}</div>
            </div>
          </div>
        </div>

        <div style={{ padding: 32, position: "relative" }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 120,
              color: theme.navy,
              opacity: 0.03,
              fontWeight: 900,
              pointerEvents: "none",
            }}
          >
            SH
          </div>

          <Row label="TOTAL AMOUNT DUE" value={`${formatMoney(invoice.amount)} EGP`} big />
          <div style={{ display: "flex", gap: 24, marginTop: 20 }}>
            <Row label="PATIENT NAME" value={invoice.patient_name} />
          </div>
          <div style={{ display: "flex", gap: 24, marginTop: 20 }}>
            <Row label="EXAM / SCAN TYPE" value={invoice.exam} />
          </div>
          <div style={{ display: "flex", gap: 24, marginTop: 20 }}>
            <Row label="EXAM DATE" value={invoice.exam_date} />
          </div>
        </div>

        <div className="no-print" style={{ display: "flex", gap: 12, padding: "0 32px 32px" }}>
          <button
            onClick={handleSendWhatsApp}
            disabled={!patientMobile}
            style={{
              flex: 1,
              padding: "12px 0",
              borderRadius: 8,
              border: `1px solid ${theme.gold}`,
              background: "#fff",
              color: theme.navy,
              fontWeight: 700,
              cursor: patientMobile ? "pointer" : "not-allowed",
              opacity: patientMobile ? 1 : 0.5,
            }}
          >
            Send via WhatsApp
          </button>
          <button
            onClick={() => handleDownloadPdf(false)}
            style={{
              flex: 1,
              padding: "12px 0",
              borderRadius: 8,
              border: "none",
              background: theme.navy,
              color: "#fff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Download (no stamp)
          </button>
          <button
            onClick={() => handleDownloadPdf(true)}
            className="no-print"
            style={{
              padding: "12px 24px",
              borderRadius: 10,
              border: "none",
              background: theme.gold,
              color: theme.navy,
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Download (stamped)
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, big }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#999", letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: big ? 28 : 16, fontWeight: 700, color: "#27214D" }}>{value}</div>
    </div>
  );
}
