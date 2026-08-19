"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

const TREND_DAYS = 30;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function HRAnalytics() {
  const [employees, setEmployees] = useState([]);
  const [shiftsByEmployee, setShiftsByEmployee] = useState({});
  const [events, setEvents] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data: emps } = await supabase.from("employees").select("id, name, hr_id, is_active").eq("is_active", true);
    const { data: ev } = await supabase.from("timeclock_events").select("employee_id, event_type, event_time");
    const { data: lr } = await supabase.from("leave_requests").select("*").eq("status", "approved");
    const { data: sh } = await supabase.from("employee_shifts").select("*");

    const shiftMap = {};
    for (const s of sh || []) {
      shiftMap[s.employee_id] = shiftMap[s.employee_id] || {};
      shiftMap[s.employee_id][s.day_of_week] = s;
    }

    setEmployees(emps || []);
    setEvents(ev || []);
    setLeaveRequests(lr || []);
    setShiftsByEmployee(shiftMap);
    setLoading(false);
  }

  if (loading) return <p style={{ color: theme.gray }}>Loading...</p>;

  const today = new Date();
  const todayKey = dateKey(today);

  function dateKey(d) {
    return d.toISOString().slice(0, 10);
  }
  function onApprovedLeave(empId, day) {
    return leaveRequests.some((r) => r.employee_id === empId && day >= r.start_date && day <= r.end_date);
  }
  function eventsFor(empId, day) {
    return events.filter((e) => e.employee_id === empId && e.event_time.slice(0, 10) === day);
  }
  function shiftFor(empId, dayOfWeek) {
    return shiftsByEmployee[empId]?.[dayOfWeek]; // undefined = no shift defined yet for that day
  }

  // ---------- Today's flags, per-employee shift aware ----------
  const todayDow = today.getDay();
  const todayFlags = employees.map((emp) => {
    const shift = shiftFor(emp.id, todayDow);
    if (onApprovedLeave(emp.id, todayKey)) return { emp, status: "vacation" };
    if (!shift) return { emp, status: "no_shift" };
    if (shift.is_day_off) return { emp, status: "off" };

    const dayEvents = eventsFor(emp.id, todayKey).sort((a, b) => new Date(a.event_time) - new Date(b.event_time));
    const login = dayEvents.find((e) => e.event_type === "login");
    const logout = dayEvents.find((e) => e.event_type === "logout");
    if (!login) return { emp, status: "no_signin" };

    const [shiftHour, shiftMin] = (shift.start_time || "09:00").split(":").map(Number);
    const loginDate = new Date(login.event_time);
    const loginHour = loginDate.getHours() + loginDate.getMinutes() / 60;
    const shiftStartHour = shiftHour + shiftMin / 60;
    const late = loginHour > shiftStartHour;

    if (!logout) return { emp, status: late ? "late_no_signout" : "no_signout", loginTime: login.event_time };
    return { emp, status: late ? "late" : "on_time", loginTime: login.event_time, logoutTime: logout.event_time };
  });

  // ---------- 30-day trend, shift-aware ----------
  const trend = employees.map((emp) => {
    let lateDays = 0, absentDays = 0, missingSignoutDays = 0, vacationDays = 0, noShiftDays = 0;
    for (let i = 0; i < TREND_DAYS; i++) {
      const d = new Date(today.getTime() - i * 86400000);
      const dow = d.getDay();
      const shift = shiftFor(emp.id, dow);
      const key = dateKey(d);

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
      const login = dayEvents.find((e) => e.event_type === "login");
      const logout = dayEvents.find((e) => e.event_type === "logout");
      if (!login) {
        absentDays++;
        continue;
      }
      const [shiftHour, shiftMin] = (shift.start_time || "09:00").split(":").map(Number);
      const loginDate = new Date(login.event_time);
      const loginHour = loginDate.getHours() + loginDate.getMinutes() / 60;
      if (loginHour > shiftHour + shiftMin / 60) lateDays++;
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
    no_signout: { label: "No sign-out yet", bg: "#fff3e0", color: "#a97c00" },
    late_no_signout: { label: "Late, no sign-out yet", bg: "#fdecea", color: "#ba1a1a" },
    vacation: { label: "On vacation", bg: "#e3f2fd", color: "#1565c0" },
    off: { label: "Day off (shift)", bg: "#f5f5f5", color: "#888" },
    no_shift: { label: "No shift defined", bg: "#f5f5f5", color: "#888" },
  };

  return (
    <div>
      <h1 style={{ color: theme.navy, marginBottom: 4 }}>Attendance Tracking</h1>
      <p style={{ color: theme.gray, marginBottom: 20 }}>Daily flags and 30-day trends, measured against each employee's own weekly shift schedule.</p>

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
                {loginTime && <div style={{ fontSize: 10, color: theme.gray, marginTop: 2 }}>In: {new Date(loginTime).toLocaleTimeString()}</div>}
                {logoutTime && <div style={{ fontSize: 10, color: theme.gray }}>Out: {new Date(logoutTime).toLocaleTimeString()}</div>}
              </a>
            );
          })}
        </div>
        {employees.length === 0 && <p style={{ color: theme.gray, fontSize: 14 }}>No active employees yet.</p>}
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginBottom: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>30-Day Trend by Employee</h3>
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
        <h3 style={{ color: theme.navy, marginTop: 0 }}>30-Day Trend, Detail</h3>
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
