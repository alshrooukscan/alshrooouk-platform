"use client";
import { theme } from "../lib/theme";

// Perfect attendance, shown to the employee as something to play for rather
// than a rule buried in payroll (Mohamed Said, 30 Oct 2026).
//
// The rule (decision 7): zero minutes late (no grace), zero minutes of early
// leave, no absence. The reward (decision 8): a share of the expected pay,
// proposed at month end and paid once an admin approves it.
//
// Four states, each worded to pull the person forward:
//   on track   - streak ring, the reward in sight, days left
//   earned     - the month is over and it held
//   so close   - missed by a handful of minutes, next month framed as a rematch
//   fresh start- missed, with what broke it and what the next month is worth

const fmt = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

function Ring({ done, total, color, track }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const pct = total > 0 ? Math.min(done / total, 1) : 0;
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" style={{ flexShrink: 0 }}>
      <circle cx="44" cy="44" r={r} fill="none" stroke={track} strokeWidth="8" />
      <circle cx="44" cy="44" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 44 44)" />
      <text x="44" y="42" textAnchor="middle" fontSize="20" fontWeight="800" fill={color}>{done}</text>
      <text x="44" y="58" textAnchor="middle" fontSize="11" fill={color} opacity="0.8">of {total}</text>
    </svg>
  );
}

function Rule({ ok, label, dark }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700,
      padding: "4px 9px", borderRadius: 999,
      background: dark ? (ok ? "rgba(255,255,255,0.14)" : "rgba(255,120,120,0.22)") : ok ? "rgba(30,122,60,0.12)" : "rgba(186,26,26,0.10)",
      color: dark ? (ok ? "#c8f2d2" : "#ffd2d2") : ok ? "#1e7a3c" : "#ba1a1a",
    }}>
      {ok ? "✓" : "✕"} {label}
    </span>
  );
}

export default function PerfectAttendanceCard({ pa, approved }) {
  if (!pa || pa.attendance_exempt || !Number(pa.scheduled_days)) return null;

  const late = Number(pa.late_minutes || 0);
  const early = Number(pa.early_leave_minutes || 0);
  const absent = Number(pa.absent_days || 0);
  const present = Number(pa.present_days || 0);
  const scheduled = Number(pa.scheduled_days || 0);
  const left = Number(pa.future_days || 0);
  const pct = Number(pa.perfect_attendance_pct || 10);
  const reward = pa.perfect_attendance ? Number(pa.perfect_attendance_bonus || 0) : Math.round(Number(pa.base || 0) * pct) / 100;
  const nextReward = Math.round(Number(pa.scheduled_pay || pa.base || 0) * pct) / 100;
  const missedBy = late + early;

  const state = pa.perfect_attendance
    ? (pa.month_complete ? "earned" : "track")
    : (absent === 0 && missedBy > 0 && missedBy <= 15 ? "close" : "fresh");

  const looks = {
    track: { bg: `linear-gradient(135deg, ${theme.navy} 0%, #3b3270 100%)`, fg: "#fff", accent: theme.goldLight, track: "rgba(255,255,255,0.15)" },
    earned: { bg: `linear-gradient(135deg, ${theme.gold} 0%, #c9ad6b 100%)`, fg: theme.navyDark, accent: theme.navyDark, track: "rgba(18,11,56,0.15)" },
    close: { bg: "linear-gradient(135deg, #fff8e6 0%, #fdf0cf 100%)", fg: theme.navy, accent: "#a97c00", track: "rgba(169,124,0,0.15)" },
    fresh: { bg: "linear-gradient(135deg, #f4f3f8 0%, #ebe9f3 100%)", fg: theme.navy, accent: theme.navy, track: "rgba(39,33,77,0.12)" },
  }[state];

  const copy = {
    track: {
      kicker: "PERFECT ATTENDANCE · حضور كامل",
      title: "You're doing great so far! 🔥",
      ar: "ماشي صح، كمّل كده",
      body: left > 0
        ? `${present} days on time, not a minute late or early. ${left} day${left === 1 ? "" : "s"} to go.`
        : `${present} days on time, not a minute late or early. Finish today strong.`,
    },
    earned: {
      kicker: "PERFECT ATTENDANCE · حضور كامل",
      title: "You did it! 🏆",
      ar: "مبروك، شهر كامل من غير ولا دقيقة",
      body: `Every day on time, no early leave, no absence. Your ${pct}% bonus is ${approved ? "approved" : "with management for approval"}.`,
    },
    close: {
      kicker: "PERFECT ATTENDANCE · حضور كامل",
      title: "So close! ⚡",
      ar: "كنت قريب جدا",
      body: `Just ${missedBy} minute${missedBy === 1 ? "" : "s"} ${late ? "late" : "early"} this month stood between you and the bonus. Next month is your rematch.`,
    },
    fresh: {
      kicker: "PERFECT ATTENDANCE · حضور كامل",
      title: "New month, new chance 💪",
      ar: "شهر جديد، فرصة جديدة",
      body: "Every month starts from zero. On time every day, no early leave and no absence, and the bonus is yours.",
    },
  }[state];

  return (
    <div style={{ background: looks.bg, color: looks.fg, borderRadius: 16, padding: 18, marginBottom: 14, boxShadow: "0 6px 22px rgba(39,33,77,0.10)", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", right: -18, top: -18, fontSize: 92, opacity: 0.08, lineHeight: 1, pointerEvents: "none" }}>🏆</div>

      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", color: looks.accent, marginBottom: 8 }}>{copy.kicker}</div>

      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        {(state === "track" || state === "earned") && (
          <Ring done={present} total={state === "earned" ? present : scheduled} color={looks.accent} track={looks.track} />
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 19, fontWeight: 800, lineHeight: 1.2 }}>{copy.title}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: looks.accent, marginTop: 2 }}><span dir="rtl">{copy.ar}</span></div>
          <div style={{ fontSize: 12.5, marginTop: 6, opacity: 0.9, lineHeight: 1.45 }}>{copy.body}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
        <Rule dark={state === "track"} ok={late === 0} label={late === 0 ? "On time every day" : `${late} min late`} />
        <Rule dark={state === "track"} ok={early === 0} label={early === 0 ? "No early leave" : `${early} min early leave`} />
        <Rule dark={state === "track"} ok={absent === 0} label={absent === 0 ? "No absence" : `${absent} absence${absent === 1 ? "" : "s"}`} />
      </div>

      <div style={{
        marginTop: 12, padding: "10px 12px", borderRadius: 12,
        background: state === "track" ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.55)",
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>
          {state === "track" && "Keep it to the last day and earn"}
          {state === "earned" && (approved ? "Bonus approved" : "Bonus waiting for approval")}
          {(state === "close" || state === "fresh") && "Next month, a perfect month is worth"}
        </span>
        <span style={{ fontSize: 18, fontWeight: 900, color: looks.accent }}>
          +{fmt(state === "track" || state === "earned" ? reward : nextReward)} EGP
          <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.8 }}> · {pct}%</span>
        </span>
      </div>
    </div>
  );
}
