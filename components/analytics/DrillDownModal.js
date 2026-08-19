"use client";
import { theme } from "../../lib/theme";

export default function DrillDownModal({ title, subtitle, columns, rows, loading, onClose }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(18,11,56,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 16,
          width: "100%",
          maxWidth: 760,
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 60px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h3 style={{ margin: 0, color: theme.navy }}>{title}</h3>
            {subtitle && <p style={{ margin: "4px 0 0", fontSize: 13, color: theme.gray }}>{subtitle}</p>}
          </div>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", color: theme.gray }}>×</button>
        </div>

        <div style={{ overflowY: "auto", padding: "0 0 12px" }}>
          {loading && <p style={{ padding: 24, color: theme.gray, textAlign: "center" }}>Loading...</p>}
          {!loading && (!rows || rows.length === 0) && (
            <p style={{ padding: 24, color: theme.gray, textAlign: "center" }}>No records found.</p>
          )}
          {!loading && rows && rows.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ position: "sticky", top: 0, background: "#faf9fb" }}>
                  {columns.map((c) => (
                    <th key={c.key} style={{ textAlign: "left", padding: "10px 16px", fontSize: 11, color: "#48464E", fontWeight: 700, textTransform: "uppercase" }}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} style={{ borderTop: "1px solid #f5f5f5" }}>
                    {columns.map((c) => (
                      <td key={c.key} style={{ padding: "10px 16px", color: theme.navy }}>
                        {c.render ? c.render(row) : row[c.key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
