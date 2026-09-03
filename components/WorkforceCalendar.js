"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { theme } from "../lib/theme";
import { useAutoRefresh } from "../lib/useAutoRefresh";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function daysInMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
function todayISO() {
  return toISODate(new Date());
}

// Backed by employee_schedule_days - real dated rows, the same table payroll
// and shift-swap requests already read - not employee_shifts, which is a
// separate weekly-pattern editor that lives on each employee's HR page and
// isn't touched here. A month calendar is inherently about specific dates,
// so shifts entered here actually count toward hours worked, not just look
// like they do.
export default function WorkforceCalendar({ branchId }) {
  const [monthCursor, setMonthCursor] = useState(() =>
    startOfMonth(new Date()),
  );
  const [employees, setEmployees] = useState([]);
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openDate, setOpenDate] = useState(null);

  const [addEmployeeIds, setAddEmployeeIds] = useState([]);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [dayOff, setDayOff] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const monthStartISO = toISODate(monthCursor);
  const monthEndISO = toISODate(
    new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0),
  );

  async function load() {
    if (!branchId) {
      setEmployees([]);
      setDays([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: emps } = await supabase
      .from("employees")
      .select("id, name")
      .eq("branch_id", branchId)
      .eq("is_active", true)
      .order("name");
    setEmployees(emps || []);

    const empIds = (emps || []).map((e) => e.id);
    if (!empIds.length) {
      setDays([]);
      setLoading(false);
      return;
    }
    const { data: sd } = await supabase
      .from("employee_schedule_days")
      .select("id, employee_id, work_date, start_time, end_time, is_day_off")
      .in("employee_id", empIds)
      .gte("work_date", monthStartISO)
      .lte("work_date", monthEndISO);
    setDays(sd || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    setOpenDate(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, monthStartISO]);

  useAutoRefresh(["employee_schedule_days", "employees_change_ping"], () =>
    load(),
  );

  const cells = useMemo(() => {
    const firstWeekday = monthCursor.getDay();
    const total = daysInMonth(monthCursor);
    const out = [];
    for (let i = 0; i < firstWeekday; i++) out.push(null);
    for (let d = 1; d <= total; d++)
      out.push(new Date(monthCursor.getFullYear(), monthCursor.getMonth(), d));
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [monthCursor]);

  function entriesFor(dateISO) {
    return days.filter((d) => d.work_date === dateISO);
  }

  // The client only wants to see who is actually working on the calendar -
  // day-off rows are still written (payroll filters on is_day_off to know who
  // was off), just not surfaced here. entriesFor stays unfiltered so the Apply
  // form below can still find and update an existing day-off row for someone
  // whose shift is being set for that date.
  function shiftsFor(dateISO) {
    return entriesFor(dateISO).filter((d) => !d.is_day_off);
  }

  function employeeName(id) {
    return employees.find((e) => e.id === id)?.name || "Unknown";
  }

  function toggleAddEmployee(id) {
    setAddEmployeeIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id],
    );
  }

  function openCard(dateISO) {
    setOpenDate(openDate === dateISO ? null : dateISO);
    setAddEmployeeIds([]);
    setDayOff(false);
    setStartTime("09:00");
    setEndTime("17:00");
    setErr("");
  }

  // Applies to every employee ticked in the card at once - each is resolved
  // as an update if that employee already has a row for this date (editing
  // an existing shift), or an insert otherwise. work_date + employee_id is a
  // unique pair in the table, so there is never more than one row to resolve
  // per employee per date.
  async function applyToDate(dateISO) {
    if (!addEmployeeIds.length) {
      setErr("Pick at least one employee.");
      return;
    }
    if (!dayOff && startTime >= endTime) {
      setErr("End time must be after start time.");
      return;
    }
    setSaving(true);
    setErr("");
    let failed = 0;
    for (const employeeId of addEmployeeIds) {
      const existing = days.find(
        (d) => d.employee_id === employeeId && d.work_date === dateISO,
      );
      const payload = {
        employee_id: employeeId,
        work_date: dateISO,
        is_day_off: dayOff,
        start_time: dayOff ? null : startTime,
        end_time: dayOff ? null : endTime,
      };
      const { error } = existing
        ? await supabase
            .from("employee_schedule_days")
            .update(payload)
            .eq("id", existing.id)
        : await supabase.from("employee_schedule_days").insert(payload);
      if (error) failed += 1;
    }
    setSaving(false);
    setAddEmployeeIds([]);
    if (failed)
      setErr(`${failed} of ${addEmployeeIds.length} could not be saved.`);
    load();
  }

  async function removeEntry(rowId) {
    await supabase.from("employee_schedule_days").delete().eq("id", rowId);
    load();
  }

  if (!branchId) {
    return (
      <p style={{ color: theme.gray, fontSize: 13 }}>
        Select a branch above to manage its schedule.
      </p>
    );
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <button
          onClick={() =>
            setMonthCursor(
              new Date(
                monthCursor.getFullYear(),
                monthCursor.getMonth() - 1,
                1,
              ),
            )
          }
          style={navBtn}
        >
          {"\u2039"}
        </button>
        <div style={{ fontWeight: 700, color: theme.navy, fontSize: 15 }}>
          {MONTH_LABELS[monthCursor.getMonth()]} {monthCursor.getFullYear()}
        </div>
        <button
          onClick={() =>
            setMonthCursor(
              new Date(
                monthCursor.getFullYear(),
                monthCursor.getMonth() + 1,
                1,
              ),
            )
          }
          style={navBtn}
        >
          {"\u203A"}
        </button>
      </div>

      {loading ? (
        <p style={{ color: theme.gray, fontSize: 13 }}>Loading schedule...</p>
      ) : employees.length === 0 ? (
        <p style={{ color: theme.gray, fontSize: 13 }}>
          No active employees assigned to this branch.
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 6,
          }}
        >
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} style={weekdayHead}>
              {w}
            </div>
          ))}
          {cells.map((date, i) => {
            if (!date) return <div key={`blank-${i}`} />;
            const dateISO = toISODate(date);
            const entries = entriesFor(dateISO);
            const shifts = shiftsFor(dateISO);
            const isOpen = openDate === dateISO;
            const isToday = dateISO === todayISO();
            return (
              <div
                key={dateISO}
                onClick={() => openCard(dateISO)}
                style={{
                  border: `1px solid ${isOpen ? theme.gold : isToday ? theme.navy : "#ececf0"}`,
                  borderRadius: 8,
                  padding: 8,
                  minHeight: 74,
                  cursor: "pointer",
                  background: isOpen ? "#fffaf0" : "#fff",
                  gridColumn: isOpen ? "span 7" : undefined,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: isToday ? theme.navy : "#8A8694",
                    }}
                  >
                    {date.getDate()}
                  </span>
                  {entries.length > 0 && (
                    <span style={{ fontSize: 9, color: theme.gray }}>
                      {entries.length}
                    </span>
                  )}
                </div>

                {!isOpen && (
                  <div
                    style={{
                      marginTop: 4,
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                    }}
                  >
                    {entries.slice(0, 3).map((e) => (
                      <div
                        key={e.id}
                        style={{
                          fontSize: 10,
                          color: e.is_day_off ? "#b45309" : theme.gray,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {employeeName(e.employee_id)}
                        {e.is_day_off
                          ? " — Off"
                          : ` ${e.start_time?.slice(0, 5)}-${e.end_time?.slice(0, 5)}`}
                      </div>
                    ))}
                    {entries.length > 3 && (
                      <div style={{ fontSize: 10, color: "#bbb" }}>
                        +{entries.length - 3} more
                      </div>
                    )}
                  </div>
                )}

                {isOpen && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{ marginTop: 8 }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: theme.navy,
                        marginBottom: 6,
                      }}
                    >
                      {date.toLocaleDateString("en-GB", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                      })}
                    </div>

                    {entries.length > 0 && (
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 6,
                          marginBottom: 10,
                        }}
                      >
                        {entries.map((e) => (
                          <div key={e.id} style={entryChip}>
                            <span style={{ fontWeight: 600 }}>
                              {employeeName(e.employee_id)}
                            </span>
                            <span>
                              {e.is_day_off
                                ? "Off"
                                : `${e.start_time?.slice(0, 5)}\u2013${e.end_time?.slice(0, 5)}`}
                            </span>
                            <button
                              onClick={() => removeEntry(e.id)}
                              style={removeChipBtn}
                              title="Remove"
                            >
                              {"\u00d7"}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div
                      style={{
                        background: "#fbfbfc",
                        border: "1px solid #ececf0",
                        borderRadius: 8,
                        padding: 12,
                      }}
                    >
                      <div style={miniLabel}>
                        Add / update employee(s) for this day
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 6,
                          marginBottom: 10,
                        }}
                      >
                        {employees.map((emp) => (
                          <label
                            key={emp.id}
                            style={chipLabel(addEmployeeIds.includes(emp.id))}
                          >
                            <input
                              type="checkbox"
                              checked={addEmployeeIds.includes(emp.id)}
                              onChange={() => toggleAddEmployee(emp.id)}
                              style={{ display: "none" }}
                            />
                            {emp.name}
                          </label>
                        ))}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: 12,
                          alignItems: "flex-end",
                          flexWrap: "wrap",
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            fontSize: 12,
                            color: theme.gray,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={dayOff}
                            onChange={(e) => setDayOff(e.target.checked)}
                          />
                          Day off
                        </label>
                        {!dayOff && (
                          <>
                            <div>
                              <div style={miniLabel}>Start</div>
                              <input
                                type="time"
                                value={startTime}
                                onChange={(e) => setStartTime(e.target.value)}
                                style={timeInp}
                              />
                            </div>
                            <div>
                              <div style={miniLabel}>End</div>
                              <input
                                type="time"
                                value={endTime}
                                onChange={(e) => setEndTime(e.target.value)}
                                style={timeInp}
                              />
                            </div>
                          </>
                        )}
                        <button
                          onClick={() => applyToDate(dateISO)}
                          disabled={saving}
                          style={applyBtn}
                        >
                          {saving ? "Saving..." : "Apply"}
                        </button>
                        <button
                          onClick={() => setOpenDate(null)}
                          style={closeBtn}
                        >
                          Close
                        </button>
                      </div>
                      {err && (
                        <p
                          style={{
                            fontSize: 11,
                            color: "#ba1a1a",
                            marginTop: 8,
                          }}
                        >
                          {err}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const navBtn = {
  width: 30,
  height: 30,
  borderRadius: 8,
  border: "1px solid #ddd",
  background: "#fff",
  color: theme.navy,
  fontSize: 16,
  cursor: "pointer",
};
const weekdayHead = {
  fontSize: 10,
  fontWeight: 700,
  color: "#8A8694",
  textTransform: "uppercase",
  letterSpacing: 0.4,
  textAlign: "center",
  padding: "4px 0",
};
const miniLabel = {
  fontSize: 10,
  fontWeight: 700,
  color: "#8A8694",
  textTransform: "uppercase",
  letterSpacing: 0.4,
  marginBottom: 6,
};
const timeInp = {
  padding: "7px 10px",
  borderRadius: 6,
  border: "1px solid #ddd",
  fontSize: 13,
};
const applyBtn = {
  padding: "9px 20px",
  borderRadius: 8,
  border: "none",
  background: theme.navy,
  color: "#fff",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
};
const closeBtn = {
  padding: "9px 16px",
  borderRadius: 8,
  border: "1px solid #ddd",
  background: "#fff",
  color: theme.gray,
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
};
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
const entryChip = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "5px 10px",
  borderRadius: 999,
  background: "#f0f0f4",
  fontSize: 11,
  color: theme.navy,
};
const removeChipBtn = {
  border: "none",
  background: "none",
  color: "#ba1a1a",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 700,
  lineHeight: 1,
  padding: 0,
};
