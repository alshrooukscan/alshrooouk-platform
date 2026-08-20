"use client";
import { theme } from "../lib/theme";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function PeriodFilterBar({ years, year, quarter, month, onChange }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: theme.gray, fontWeight: 600 }}>FILTER:</span>
      <select value={year} onChange={(e) => onChange({ year: e.target.value, quarter, month })} style={selStyle}>
        <option value="">All Years</option>
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
      <select value={quarter} onChange={(e) => onChange({ year, quarter: e.target.value, month: "" })} style={selStyle} disabled={!year}>
        <option value="">All Quarters</option>
        <option value="1">Q1 (Jan–Mar)</option>
        <option value="2">Q2 (Apr–Jun)</option>
        <option value="3">Q3 (Jul–Sep)</option>
        <option value="4">Q4 (Oct–Dec)</option>
      </select>
      <select value={month} onChange={(e) => onChange({ year, quarter: "", month: e.target.value })} style={selStyle} disabled={!year}>
        <option value="">All Months</option>
        {MONTHS.map((m, i) => (
          <option key={m} value={i + 1}>{m}</option>
        ))}
      </select>
      {(year || quarter || month) && (
        <button
          onClick={() => onChange({ year: "", quarter: "", month: "" })}
          style={{ background: "none", border: "none", color: theme.gold, fontSize: 12, cursor: "pointer", fontWeight: 600 }}
        >
          Clear
        </button>
      )}
    </div>
  );
}

export function getDateRange({ year, quarter, month }) {
  if (!year) return { start: null, end: null };
  const y = parseInt(year, 10);
  if (month) {
    const m = parseInt(month, 10);
    const start = `${y}-${String(m).padStart(2, "0")}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${y}-${String(m).padStart(2, "0")}-${lastDay}`;
    return { start, end };
  }
  if (quarter) {
    const q = parseInt(quarter, 10);
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const start = `${y}-${String(startMonth).padStart(2, "0")}-01`;
    const lastDay = new Date(y, endMonth, 0).getDate();
    const end = `${y}-${String(endMonth).padStart(2, "0")}-${lastDay}`;
    return { start, end };
  }
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

const selStyle = { padding: "7px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13, background: "#fff", color: theme.navy };
