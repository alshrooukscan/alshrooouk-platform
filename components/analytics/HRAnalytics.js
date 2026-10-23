"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import PeriodFilterBar, { getDateRange } from "./PeriodFilterBar";
import { fetchAll, cairoDate, cairoToday } from "../../lib/dashboardData";
import { useAutoRefresh } from "../../lib/useAutoRefresh";

const TREND_DAYS_DEFAULT = 30;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Attendance tracking went live on this date; days before it are never "Absent".
const GO_LIVE = "2026-09-01";
// Never "employees" / "staff_profiles": Realtime would broadcast salary columns.
const LIVE_TABLES = ["timeclock_events", "employee_shifts", "leave_requests"];

// Everything below runs on Cairo time, not the browser's or UTC.
const cairoHMFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hour12: false, hourCycle: "h23" });
function cairoHM(ts) {
  return cairoHMFmt.format(new Date(ts)).replace(/^24:/, "00:"); // "HH:MM"
}
function dowOfKey(key) {
  return new Date(key + "T00:00:00Z").getUTCDay();
}
function addDaysKey(key, n) {
  const d = new Date(key + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function shiftStartHM(shift) {
  return (shift.start_time || "09:00").slice(0, 5);
}
// Earliest day the trend can need for this filter (default: last 30 days).
function trendFromKey(dateFilter) {
  const { start } = getDateRange(dateFilter);
  const from = start || addDaysKey(cairoToday(), -(TREND_DAYS_DEFAULT - 1));
  return from > GO_LIVE ? from : GO_LIVE;
}

export default function HRAnalytics() {
  const [employees, setEmployees] = useState([]);
  const [shiftsByEmployee, setShiftsByEmployee] = useState({});
  const [events, setEvents] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState({ year: "", quarter: "", month: "" });

  const fromKey = trendFromKey(dateFilter);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromKey]);

  // Silent background refresh: only the first load shows "Loading...".
  useAutoRefresh(LIVE_TABLES, () => load());

  async function load() {
    try {
      // Start of the earliest needed Cairo day, as an instant (Cairo is UTC+2/+3, so
      // going back 3h from UTC midnight covers it; extra rows are filtered by day key).
      const fromTs = new Date(new Date(fromKey + "T00:00:00Z").getTime() - 3 * 3600000).toISOString();
      const [emps, ev, lr, sh] = await Promise.all([
        fetchAll(() => supabase.from("employees").select("id, name, hr_id, is_active, created_at").eq("is_active", true)),
        fetchAll(() => supabase.from("timeclock_events").select("id, employee_id, event_type, event_time").gte("event_time", fromTs)),
        fetchAll(() => supabase.from("leave_requests").select("*").eq("status", "approved")),
        fetchAll(() => supabase.from("employee_shifts").select("*")),
      ]);

      const shiftMap = {};
      for (const s of sh) {
        shiftMap[s.employee_id] = shiftMap[s.employee_id] || {};
        shiftMap[s.employee_id][s.day_of_week] = s;
      }

      setEmployees(emps);
      setEvents(ev.filter((e) => e.event_time).map((e) => ({ ...e, day: cairoDate(e.event_time) })));
      setLeaveRequests(lr);
      setShiftsByEmployee(shiftMap);
    } catch (err) {
      console.error("HRAnalytics load failed", err); // keep showing the last good data
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <p style={{ color: theme.gray }}>Loading...</p>;

  const todayKey = cairoToday();
  const nowHM = cairoHM(new Date());

  function onApprovedLeave(empId, day) {
    return leaveRequests.some((r) => r.employee_id === empId && day >= r.start_date && day <= r.end_date);
  }
  // Sorted by time, so [first login] and [last logout] are well defined.
  function eventsFor(empId, day) {
    return events
      .filter((e) => e.employee_id === empId && e.day === day)
      .sort((a, b) => new Date(a.event_time) - new Date(b.event_time));
  }
  function firstLogin(dayEvents) {
    return dayEvents.find((e) => e.event_type === "login");
  }
  function lastLogout(dayEvents) {
    for (let i = dayEvents.length - 1; i >= 0; i--) if (dayEvents[i].event_type === "logout") return dayEvents[i];
    return undefined;
  }
  function shiftFor(empId, dayOfWeek) {
    return shiftsByEmployee[empId]?.[dayOfWeek]; // undefined = no shift defined yet for that day
  }
  // Employee start: the earlier of their record creation and first clock event (Cairo day).
  const firstEventDay = {};
  for (const e of events) {
    if (!firstEventDay[e.employee_id] || e.day < firstEventDay[e.employee_id]) firstEventDay[e.employee_id] = e.day;
  }
  function employeeStartKey(emp) {
    const c = emp.created_at ? cairoDate(emp.created_at) : null;
    const f = firstEventDay[emp.id] || null;
    if (c && f) return c < f ? c : f;
    return c || f || GO_LIVE;
  }

  // ---------- Today's flags, per-employee shift aware ----------
  const todayDow = dowOfKey(todayKey);
  const todayFlags = employees.map((emp) => {
    const shift = shiftFor(emp.id, todayDow);
    if (onApprovedLeave(emp.id, todayKey)) return { emp, status: "vacation" };
    if (!shift) return { emp, status: "no_shift" };
    if (shift.is_day_off) return { emp, status: "off" };

    const dayEvents = eventsFor(emp.id, todayKey);
    const login = firstLogin(dayEvents);
    const logout = lastLogout(dayEvents);
    if (!login) return { emp, status: nowHM < shiftStartHM(shift) ? "not_started" : "no_signin" };

    const late = cairoHM(login.event_time) > shiftStartHM(shift);

    if (!logout) return { emp, status: late ? "late_no_signout" : "no_signout", loginTime: login.event_time };
    return { emp, status: late ? "late" : "on_time", loginTime: login.event_time, logoutTime: logout.event_time };
  });

  // ---------- Trend: selected calendar period, or last 30 days by default ----------
  const goLiveYear = Number(GO_LIVE.slice(0, 4));
  const years = [];
  for (let y = Number(todayKey.slice(0, 4)); y >= goLiveYear; y--) years.push(String(y));
  const { start: filterStart, end: filterEnd } = getDateRange(dateFilter);
  const rangeStart = filterStart || addDaysKey(todayKey, -(TREND_DAYS_DEFAULT - 1));
  const rangeEnd = filterEnd && filterEnd < todayKey ? filterEnd : todayKey;

  const trend = employees.map((emp) => {
    let lateDays = 0, absentDays = 0, missingSignoutDays = 0, vacationDays = 0, noShiftDays = 0;
    // Clamp per employee: never count days before go-live or before they existed.
    let startKey = rangeStart;
    if (GO_LIVE > startKey) startKey = GO_LIVE;
    const empStart = employeeStartKey(emp);
    if (empStart > startKey) startKey = empStart;

    for (let key = startKey; key <= rangeEnd; key = addDaysKey(key, 1)) {
      const shift = shiftFor(emp.id, dowOfKey(key));
      // Today only counts once this employee's shift has started (Cairo time).
      if (key === todayKey && (!shift || shift.is_day_off || nowHM < shiftStartHM(shift))) continue;

      if (onApprovedLeave(emp.id, key)) {
        vacationDays++;
        continue;
      }
      if (!shift) {
        noShiftDays++;
        continue;
      }
      if (shift.is_day_off) continue;

      const dayEvents = eventsFor(emp.id, key);
      const login = firstLogin(dayEvents);
      const logout = lastLogout(dayEvents);
      if (!login) {
        absentDays++;
        continue;
      }
      if (cairoHM(login.event_time) > shiftStartHM(shift)) lateDays++;
      if (!logout) missingSignoutDays++;
    }
    return { emp, lateDays, absentDays, missingSignoutDays, vacationDays, noShiftDays };
  }).sort((a, b) => (b.lateDays + b.absentDays + b.missingSignoutDays) - (a.lateDays + a.absentDays + a.missingSignoutDays));

  const upcomingVacations = leaveRequests
    .filter((r) => r.end_date >= todayKey)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  const noShiftCount = employees.filter((e) => !shiftsByEmployee[e.id]).length;

  const statusMeta = {
    on_time: { label: "On time", bg: "#e8f5e9", color: "#2e7d32" },
    late: { label: "Late", bg: "#fff8e1", color: "#a97c00" },
    no_signin: { label: "No sign-in", bg: "#fdecea", color: "#ba1a1a" },
    not_started: { label: "Shift not started yet", bg: "#f5f5f5", color: "#888" },
    no_signout: { label: "No sign-out yet", bg: "#fff3e0", color: "#a97c00" },
    late_no_signout: { label: "Late, no sign-out yet", bg: "#fdecea", color: "#ba1a1a" },
    vacation: { label: "On vacation", bg: "#e3f2fd", color: "#1565c0" },
    off: { label: "Day off (shift)", bg: "#f5f5f5", color: "#888" },
    no_shift: { label: "No shift defined", bg: "#f5f5f5", color: "#888" },
  };

  return (
    <div>
      <h1 style={{ color: theme.navy, marginBottom: 4 }}>Attendance Tracking</h1>
      <p style={{ color: theme.gray, marginBottom: 20 }}>Daily flags and trends, measured against each employee's own weekly shift schedule.</p>

      <PeriodFilterBar years={years} year={dateFilter.year} quarter={dateFilter.quarter} month={dateFilter.month} day={dateFilter.day} onChange={setDateFilter} />

      {noShiftCount > 0 && (
        <div style={{ background: "#fff3e0", border: "1px solid #ffe0b2", borderRadius: 12, padding: 14, marginBottom: 20, fontSize: 13, color: "#a97c00" }}>
          {noShiftCount} employee{noShiftCount !== 1 ? "s don't" : " doesn't"} have a shift schedule set yet, their attendance can't be flagged accurately until one is set on their profile.
        </div>
      )}

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginBottom: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Today's Flags &middot; {DAY_NAMES[todayDow]}</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
          {todayFlags.map(({ emp, status, loginTime, logoutTime }) => {
            const meta = statusMeta[status];
            return (
              <a key={emp.id} href={`/dashboard/hr/${emp.id}`} style={{ textDecoration: "none", border: `1px solid ${meta.bg}`, background: meta.bg, borderRadius: 10, padding: 12, display: "block" }}>
                <div style={{ fontWeight: 600, color: theme.navy, fontSize: 13 }}>{emp.name}</div>
                <div style={{ fontSize: 11, color: meta.color, fontWeight: 700, marginTop: 2 }}>{meta.label}</div>
                {loginTime && <div style={{ fontSize: 10, color: theme.gray, marginTop: 2 }}>In: {new Date(loginTime).toLocaleTimeString([], { timeZone: "Africa/Cairo" })}</div>}
                {logoutTime && <div style={{ fontSize: 10, color: theme.gray }}>Out: {new Date(logoutTime).toLocaleTimeString([], { timeZone: "Africa/Cairo" })}</div>}
              </a>
            );
          })}
        </div>
        {employees.length === 0 && <p style={{ color: theme.gray, fontSize: 14 }}>No active employees yet.</p>}
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginBottom: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Trend by Employee</h3>
        <p style={{ fontSize: 11, color: theme.gray, marginTop: -8, marginBottom: 12 }}>Hover a bar for exact counts. Click a row below for full detail.</p>
        <ResponsiveContainer width="100%" height={Math.max(200, trend.length * 32)}>
          <BarChart data={trend.map((t) => ({ name: t.emp.name, Late: t.lateDays, Absent: t.absentDays, Vacation: t.vacationDays }))} layout="vertical" margin={{ left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Late" fill="#a97c00" radius={[0, 3, 3, 0]} />
            <Bar dataKey="Absent" fill="#ba1a1a" radius={[0, 3, 3, 0]} />
            <Bar dataKey="Vacation" fill="#1565c0" radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginBottom: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Trend, Detail</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left" }}>
              <th style={th}>Employee</th>
              <th style={th}>Late Days</th>
              <th style={th}>Absent Days</th>
              <th style={th}>Missing Sign-out</th>
              <th style={th}>Vacation Days</th>
            </tr>
          </thead>
          <tbody>
            {trend.map(({ emp, lateDays, absentDays, missingSignoutDays, vacationDays, noShiftDays }) => (
              <tr key={emp.id} style={{ borderTop: "1px solid #f0f0f0" }}>
                <td style={td}>
                  <a href={`/dashboard/hr/${emp.id}`} style={{ color: theme.navy, textDecoration: "none", fontWeight: 600 }}>{emp.name}</a>
                  {noShiftDays > 0 && <div style={{ fontSize: 10, color: "#a97c00" }}>{noShiftDays} days with no shift defined</div>}
                </td>
                <td style={{ ...td, color: lateDays > 0 ? "#a97c00" : theme.gray, fontWeight: lateDays > 2 ? 700 : 400 }}>{lateDays}</td>
                <td style={{ ...td, color: absentDays > 0 ? "#ba1a1a" : theme.gray, fontWeight: absentDays > 0 ? 700 : 400 }}>{absentDays}</td>
                <td style={{ ...td, color: missingSignoutDays > 0 ? "#a97c00" : theme.gray }}>{missingSignoutDays}</td>
                <td style={td}>{vacationDays}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Vacations</h3>
        {upcomingVacations.length === 0 && <p style={{ color: theme.gray, fontSize: 14 }}>No current or upcoming approved vacations.</p>}
        {upcomingVacations.map((r) => {
          const emp = employees.find((e) => e.id === r.employee_id);
          const active = r.start_date <= todayKey && r.end_date >= todayKey;
          return (
            <div key={r.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f0f0f0", fontSize: 13 }}>
              <span style={{ color: theme.navy, fontWeight: 600 }}>{emp?.name || "Unknown"}</span>
              <span style={{ color: theme.gray }}>{r.start_date} &rarr; {r.end_date}</span>
              {active && <span style={{ color: "#1565c0", fontWeight: 700, fontSize: 11 }}>Currently away</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const th = { padding: "8px 12px", fontSize: 11, color: "#48464E", fontWeight: 700, textTransform: "uppercase" };
const td = { padding: "8px 12px" };
