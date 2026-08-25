"use client";
import { useState } from "react";
import { theme } from "../lib/theme";

// Admin-only hard delete for patient, doctor, and employee records, shown on
// their own profile page. The database itself is the real safety net here -
// visits, payroll runs, and timeclock events all reference these records with
// NO ACTION delete rules, so Postgres flatly refuses to delete anyone with
// real activity rather than silently cascading data loss. This component's
// job is just to make that refusal legible instead of a raw error code, and
// to require real, deliberate confirmation before even attempting it.
export default function DeleteEntityButton({ entityLabel, entityName, onDelete, onDeleted }) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canConfirm = confirmText.trim() === entityName.trim();

  async function handleDelete() {
    setBusy(true);
    setError("");
    try {
      await onDelete();
      onDeleted();
    } catch (e) {
      if (e?.code === "23503") {
        setError(
          `This ${entityLabel} has real activity on record (visits, payroll, or clock history) and can't be deleted. If they should no longer be active, consider deactivating instead.`
        );
      } else {
        setError(e?.message || "Could not delete this record.");
      }
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{ padding: "10px 18px", borderRadius: 8, border: "1px solid #ba1a1a", background: "#fff", color: "#ba1a1a", fontWeight: 700, cursor: "pointer", fontSize: 13 }}
      >
        Delete {entityLabel}
      </button>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,11,56,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: 420, maxWidth: "90vw" }}>
        <h3 style={{ color: "#ba1a1a", marginTop: 0, marginBottom: 4 }}>Delete this {entityLabel}?</h3>
        <p style={{ fontSize: 13, color: theme.gray, marginTop: 0 }}>
          This permanently removes <strong>{entityName}</strong> and cannot be undone. To confirm, type their name exactly as shown below.
        </p>
        <p style={{ fontSize: 13, fontWeight: 700, color: theme.navy, background: "#faf9fb", padding: "8px 12px", borderRadius: 6 }}>{entityName}</p>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="Type the name to confirm"
          style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box", marginBottom: 8 }}
        />
        {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            onClick={() => { setOpen(false); setConfirmText(""); setError(""); }}
            style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontWeight: 600, cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={!canConfirm || busy}
            style={{
              flex: 1,
              padding: "10px 0",
              borderRadius: 8,
              border: "none",
              background: canConfirm ? "#ba1a1a" : "#e5b3b3",
              color: "#fff",
              fontWeight: 700,
              cursor: canConfirm ? "pointer" : "not-allowed",
            }}
          >
            {busy ? "Deleting..." : "Delete Permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}
