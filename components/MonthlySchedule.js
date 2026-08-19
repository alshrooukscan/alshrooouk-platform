"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { theme } from "../lib/theme";

function ymKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}
function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}
function dateStr(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function MonthlySchedule({ employeeId }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-indexed
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    load();
  }, [year, month, employeeId]);

  async function load() {
    setLoading(true);
    setSaved(false);
    const total = daysInMonth(year, month);
    const start = dateStr(year, month, 1);
    const end = dateStr(year, month, total);
    const { data } = await supabase
      .from("employee_schedule_days")
      .select("*")
      .eq("employee_id", employeeId)
      .gte("work_date", start)
      .lte("work_date", end);

    const byDate = Object.fromEntries((data || []).map((d) => [d.work_date, d]));
    const grid = [];
    for (let day = 1; day <= total; day++) {
      const ds = dateStr(year, month, day);
      const dow = new Date(year, month, day).getDay();
      const existing = byDate[ds];
      grid.push({
        date: ds,
        day,
        dow,
        start_time: existing?.start_time?.slice(0, 5) || "09:00",
        end_time: existing?.end_time?.slice(0, 5) || "17:00",
        is_day_off: existing?.is_day_off ?? dow === 5, // default Friday off, adjustable
        hasData: !!existing,
      });
    }
    setDays(grid);
    setLoading(false);
  }

  function updateDay(date, field, value) {
    setDays((prev) => prev.map((d) => (d.date === date ? { ...d, [field]: value } : d)));
  }

  function handleRepeatWeekly() {
    // Take the first 7 configured days (week 1) and repeat that pattern across the rest of the month.
    const week1 = days.slice(0, 7);
    setDays((prev) =>
      prev.map((d, i) => {
        const pattern = week1[i % 7];
        if (i < 7) return d;
        return { ...d, start_time: pattern.start_time, end_time: pattern.end_time, is_day_off: pattern.is_day_off };
      })
    );
  }

  async function handleSaveMonth() {
    setSaving(true);
    const rows = days.map((d) => ({
      employee_id: employeeId,
      work_date: d.date,
      start_time: d.is_day_off ? null : d.start_time,
      end_time: d.is_day_off ? null : d.end_time,
      is_day_off: d.is_day_off,
    }));
    await supabase.from("employee_schedule_days").upsert(rows, { onConflict: "employee_id,work_date" });
    setSaving(false);
    setSaved(true);
    load();
  }

  async function handleRepeatToNextMonth() {
    setSaving(true);
    // Ensure current month is saved first
    const rows = days.map((d) => ({
      employee_id: employeeId,
      work_date: d.date,
      start_time: d.is_day_off ? null : d.start_time,
      end_time: d.is_day_off ? null : d.end_time,
      is_day_off: d.is_day_off,
    }));
    await supabase.from("employee_schedule_days").upsert(rows, { onConflict: "employee_id,work_date" });

    // Build next month's dates using the same day-of-week pattern from this month
    const nextMonthDate = new Date(year, month + 1, 1);
    const nextYear = nextMonthDate.getFullYear();
    const nextMonth = nextMonthDate.getMonth();
    const nextTotal = daysInMonth(nextYear, nextMonth);

    const byDow = {};
    for (const d of days) {
      if (!byDow[d.dow]) byDow[d.dow] = d; // first occurrence of each weekday as the pattern
    }

    const nextRows = [];
    for (let day = 1; day <= nextTotal; day++) {
      const dow = new Date(nextYear, nextMonth, day).getDay();
      const pattern = byDow[dow];
      if (!pattern) continue;
      nextRows.push({
        employee_id: employeeId,
        work_date: dateStr(nextYear, nextMonth, day),
        start_time: pattern.is_day_off ? null : pattern.start_time,
        end_time: pattern.is_day_off ? null : pattern.end_time,
        is_day_off: pattern.is_day_off,
      });
    }
    await supabase.from("employee_schedule_days").upsert(nextRows, { onConflict: "employee_id,work_date" });
    setSaving(false);
    setYear(nextYear);
    setMonth(nextMonth);
  }

  function goPrevMonth() {
    const d = new Date(year, month - 1, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }
  function goNextMonth() {
    const d = new Date(year, month + 1, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  const monthLabel = new Date(year, month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <h3 style={{ color: theme.navy, margin: 0 }}>Monthly Schedule</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={goPrevMonth} style={navBtn}>&lsaquo;</button>
          <span style={{ fontWeight: 700, color: theme.navy, fontSize: 14, minWidth: 130, textAlign: "center" }}>{monthLabel}</span>
          <button onClick={goNextMonth} style={navBtn}>&rsaquo;</button>
        </div>
      </div>
      <p style={{ fontSize: 12, color: theme.gray, marginTop: 0, marginBottom: 16 }}>
        Set real dates for this month, or use the buttons below to repeat a pattern instead of entering every day by hand.
      </p>

      {loading && <p style={{ color: theme.gray, fontSize: 13 }}>Loading...</p>}

      {!loading && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginBottom: 16 }}>
            {days.map((d) => (
              <div
                key={d.date}
                style={{
                  border: `1px solid ${d.is_day_off ? "#eee" : "#ddd"}`,
                  borderRadius: 8,
                  padding: 8,
                  background: d.is_day_off ? "#faf9fb" : "#fff",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: theme.navy }}>{d.day}</span>
                  <span style={{ fontSize: 10, color: theme.gray }}>{DAY_ABBR[d.dow]}</span>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: theme.gray, marginBottom: 4 }}>
                  <input type="checkbox" checked={d.is_day_off} onChange={(e) => updateDay(d.date, "is_day_off", e.target.checked)} />
                  Off
                </label>
                {!d.is_day_off && (
                  <>
                    <input
                      type="time"
                      value={d.start_time}
                      onChange={(e) => updateDay(d.date, "start_time", e.target.value)}
                      style={{ width: "100%", fontSize: 10, padding: "3px 4px", borderRadius: 4, border: "1px solid #ddd", marginBottom: 3, boxSizing: "border-box" }}
                    />
                    <input
                      type="time"
                      value={d.end_time}
                      onChange={(e) => updateDay(d.date, "end_time", e.target.value)}
                      style={{ width: "100%", fontSize: 10, padding: "3px 4px", borderRadius: 4, border: "1px solid #ddd", boxSizing: "border-box" }}
                    />
                  </>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={handleSaveMonth} disabled={saving} style={primaryBtn}>
              {saving ? "Saving..." : "Save This Month"}
            </button>
            <button onClick={handleRepeatWeekly} style={outlineBtn} title="Copies the first 7 days' pattern across the rest of this month">
              Repeat Weekly (fill rest of month)
            </button>
            <button onClick={handleRepeatToNextMonth} disabled={saving} style={outlineBtn} title="Saves this month, then applies the same weekday pattern to next month">
              Repeat Monthly (apply to next month)
            </button>
          </div>
          {saved && <p style={{ fontSize: 12, color: "#2e7d32", marginTop: 10 }}>Saved.</p>}
        </>
      )}
    </div>
  );
}

const navBtn = { width: 28, height: 28, borderRadius: 6, border: "1px solid #ddd", background: "#fff", cursor: "pointer", fontSize: 16, color: "#27214D" };
const primaryBtn = { padding: "10px 20px", borderRadius: 8, border: "none", background: "#27214D", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 };
const outlineBtn = { padding: "10px 20px", borderRadius: 8, border: "1px solid #27214D", background: "#fff", color: "#27214D", fontWeight: 600, cursor: "pointer", fontSize: 13 };
