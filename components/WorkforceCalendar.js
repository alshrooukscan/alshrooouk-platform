"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { theme } from "../lib/theme";
import { useAutoRefresh } from "../lib/useAutoRefresh";

const DAYS = [
  { key: 0, label: "Sun" },
  { key: 1, label: "Mon" },
  { key: 2, label: "Tue" },
  { key: 3, label: "Wed" },
  { key: 4, label: "Thu" },
  { key: 5, label: "Fri" },
  { key: 6, label: "Sat" },
];

// Weekly recurring shifts for one branch's staff, read from employee_shifts
// (one row per employee per day_of_week). employees itself is never queried
// live here beyond id/name - the only fields the authenticated role can read -
// so this stays clear of the salary/national_id lockdown entirely.
export default function WorkforceCalendar({ branchId }) {
  const [employees, setEmployees] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Editor state: a simple dropdown-driven form rather than a drag calendar,
  // per the client's own request for "the simplest UI as a drop down menu".
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState([]);
  const [selectedDays, setSelectedDays] = useState([]);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [dayOff, setDayOff] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  async function load() {
    if (!branchId) {
      setEmployees([]);
      setShifts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data: emps }, { data: sh }] = await Promise.all([
      // name/id are the only columns this role can read on employees - see
      // the grant lockdown - which is exactly all a calendar needs.
      supabase.from("employees").select("id, name").eq("branch_id", branchId).eq("is_active", true).order("name"),
      supabase.from("employee_shifts").select("id, employee_id, day_of_week, start_time, end_time, is_day_off"),
    ]);
    const empIds = new Set((emps || []).map((e) => e.id));
    setEmployees(emps || []);
    setShifts((sh || []).filter((s) => empIds.has(s.employee_id)));
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  useAutoRefresh(["employee_shifts", "employees_change_ping"], () => load());

  function shiftFor(employeeId, dayKey) {
    return shifts.find((s) => s.employee_id === employeeId && s.day_of_week === dayKey);
  }

  function toggleIn(list, setList, value) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  async function applyShift() {
    if (!selectedEmployeeIds.length || !selectedDays.length) {
      setSaveMsg("Pick at least one employee and one day.");
      return;
    }
    if (!dayOff && startTime >= endTime) {
      setSaveMsg("End time must be after start time.");
      return;
    }
    setSaving(true);
    setSaveMsg("");

    // One upsert per (employee, day) pair. employee_shifts has no natural
    // single-row-per-pair unique constraint to upsert against, so each cell is
    // resolved by hand: update the existing row for that pair if one exists,
    // otherwise insert a new one. A handful of employees times a handful of
    // days is at most a few dozen rows - simplicity over a batched query here.
    const rows = [];
    for (const employeeId of selectedEmployeeIds) {
      for (const day of selectedDays) {
        rows.push({ employeeId, day });
      }
    }

    let failed = 0;
    for (const { employeeId, day } of rows) {
      const existing = shiftFor(employeeId, day);
      const payload = {
        employee_id: employeeId,
        day_of_week: day,
        is_day_off: dayOff,
        start_time: dayOff ? null : startTime,
        end_time: dayOff ? null : endTime,
      };
      const { error } = existing
        ? await supabase.from("employee_shifts").update(payload).eq("id", existing.id)
        : await supabase.from("employee_shifts").insert(payload);
      if (error) failed += 1;
    }

    setSaving(false);
    setSaveMsg(failed ? `${failed} of ${rows.length} could not be saved.` : "Saved.");
    load();
  }

  if (!branchId) {
    return <p style={{ color: theme.gray, fontSize: 13 }}>Select a branch above to manage its schedule.</p>;
  }

  return (
    <div>
      {/* --- weekly grid: read-only view of what's currently set --- */}
      <div style={{ overflowX: "auto", marginBottom: 20 }}>
        {loading ? (
          <p style={{ color: theme.gray, fontSize: 13 }}>Loading schedule...</p>
        ) : employees.length === 0 ? (
          <p style={{ color: theme.gray, fontSize: 13 }}>No active employees assigned to this branch.</p>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
            <thead>
              <tr>
                <th style={gridHeadCell}>Employee</th>
                {DAYS.map((d) => (
                  <th key={d.key} style={gridHeadCell}>{d.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id}>
                  <td style={{ ...gridCell, fontWeight: 700, color: theme.navy, textAlign: "left" }}>{emp.name}</td>
                  {DAYS.map((d) => {
                    const s = shiftFor(emp.id, d.key);
                    return (
                      <td key={d.key} style={gridCell}>
                        {!s ? (
                          <span style={{ color: "#ccc" }}>—</span>
                        ) : s.is_day_off ? (
                          <span style={{ color: "#b45309", fontWeight: 600 }}>Off</span>
                        ) : (
                          <span style={{ color: theme.gray }}>
                            {s.start_time?.slice(0, 5)}–{s.end_time?.slice(0, 5)}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* --- editor: dropdown-driven, applies to one or many employees / days at once --- */}
      <div style={{ background: "#fbfbfc", border: "1px solid #ececf0", borderRadius: 10, padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: theme.navy, marginBottom: 10 }}>Set or adjust shifts</div>

        <div style={{ marginBottom: 10 }}>
          <div style={miniLabel}>Employee(s)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {employees.map((emp) => (
              <label key={emp.id} style={chipLabel(selectedEmployeeIds.includes(emp.id))}>
                <input
                  type="checkbox"
                  checked={selectedEmployeeIds.includes(emp.id)}
                  onChange={() => toggleIn(selectedEmployeeIds, setSelectedEmployeeIds, emp.id)}
                  style={{ display: "none" }}
                />
                {emp.name}
              </label>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={miniLabel}>Day(s)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {DAYS.map((d) => (
              <label key={d.key} style={chipLabel(selectedDays.includes(d.key))}>
                <input
                  type="checkbox"
                  checked={selectedDays.includes(d.key)}
                  onChange={() => toggleIn(selectedDays, setSelectedDays, d.key)}
                  style={{ display: "none" }}
                />
                {d.label}
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: theme.gray }}>
            <input type="checkbox" checked={dayOff} onChange={(e) => setDayOff(e.target.checked)} />
            Mark as day off
          </label>
          {!dayOff && (
            <>
              <div>
                <div style={miniLabel}>Start</div>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={timeInp} />
              </div>
              <div>
                <div style={miniLabel}>End</div>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={timeInp} />
              </div>
            </>
          )}
          <button onClick={applyShift} disabled={saving} style={applyBtn}>
            {saving ? "Saving..." : "Apply"}
          </button>
        </div>
        {saveMsg && <p style={{ fontSize: 12, color: saveMsg === "Saved." ? "#2e7d32" : "#ba1a1a", marginTop: 8 }}>{saveMsg}</p>}
      </div>
    </div>
  );
}

const gridHeadCell = { padding: "8px 10px", fontSize: 10, fontWeight: 700, color: "#8A8694", textTransform: "uppercase", letterSpacing: 0.4, borderBottom: "1px solid #ececf0", textAlign: "center" };
const gridCell = { padding: "8px 10px", fontSize: 12, textAlign: "center", borderBottom: "1px solid #f5f5f7", whiteSpace: "nowrap" };
const miniLabel = { fontSize: 10, fontWeight: 700, color: "#8A8694", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 };
const timeInp = { padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 };
const applyBtn = { padding: "9px 20px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" };
const chipLabel = (active) => ({
  padding: "5px 12px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  border: `1px solid ${active ? theme.gold : "#ddd"}`,
  background: active ? theme.goldLight : "#fff",
  color: theme.navy,
});
