"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import MonthlySchedule from "../../../../components/MonthlySchedule";
import { formatMoney } from "../../../../lib/format";
import { loadFaceModels, extractDescriptor } from "../../../../lib/faceMatch";
import { formatPhone } from "../../../../lib/formatPhone";
import { usePermissions } from "../../../../lib/usePermissions";
import { MODULES } from "../../../../lib/modules";
import PortalAccessCard from "../../../../components/PortalAccessCard";
import { employeePortalWhatsAppLink } from "../../../../lib/whatsapp";
import { resolveUniqueUsername } from "../../../../lib/uniqueUsername";
import { logActivity } from "../../../../lib/activityLog";
import DeleteEntityButton from "../../../../components/DeleteEntityButton";
import DocumentsUploader from "../../../../components/DocumentsUploader";
import { APP_URL } from "../../../../lib/appUrl";
import BonusRatesPanel from "../../../../components/hr/BonusRatesPanel";
import { useT, tx, Ltr } from "../../../../lib/i18n";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// Display only (same Sunday-first order as DAYS); the date math keeps using DAYS indexes.
const DAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const PAY_METHOD_LABEL = { cash: "Cash", instapay: "InstaPay", wallet: "Wallet", bank_transfer: "Bank transfer", visa: "Visa" };

export default function EmployeeProfilePage() {
  const { t, tCode, isAr } = useT();
  const { id } = useParams();
  const router = useRouter();
  const { isAdmin, profile } = usePermissions();
  const [employee, setEmployee] = useState(null);
  const [editingInfo, setEditingInfo] = useState(false);
  const [infoDraft, setInfoDraft] = useState(null);
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoError, setInfoError] = useState("");
  const [payslip, setPayslip] = useState(null);
  const [accrued, setAccrued] = useState(null);
  const [accruedPeriod, setAccruedPeriod] = useState("");
  const [events, setEvents] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [permissions, setPermissions] = useState({});
  const [savingElevation, setSavingElevation] = useState(false);
  const [elevationResult, setElevationResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [skills, setSkills] = useState([]);
  const [skillCash, setSkillCash] = useState([]);
  const [skillBusy, setSkillBusy] = useState(null);
  const [savingShifts, setSavingShifts] = useState(false);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoBase64, setPhotoBase64] = useState(null);
  const [photoFilename, setPhotoFilename] = useState(null);
  const [descriptor, setDescriptor] = useState(null);
  const [faceStatus, setFaceStatus] = useState("");
  const [savingFace, setSavingFace] = useState(false);

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    setLoading(true);
    // Salary, national id and the face descriptor are no longer granted to a
    // browser session, so the full record comes through an admin-checked route.
    const { data: sess } = await supabase.auth.getSession();
    const empRes = await fetch(`/api/hr/employee?id=${id}`, {
      headers: { Authorization: `Bearer ${sess.session?.access_token}` },
    });
    const emp = empRes.ok ? (await empRes.json()).employee : null;
    const { data: latestPayslip } = await supabase
      .from("payroll_runs")
      .select("*")
      .eq("employee_id", id)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: tc } = await supabase
      .from("timeclock_events")
      .select("*")
      .eq("employee_id", id)
      .order("event_time", { ascending: false })
      .limit(10);
    const { data: lr } = await supabase
      .from("leave_requests")
      .select("*")
      .eq("employee_id", id)
      .order("created_at", { ascending: false });
    const { data: sh } = await supabase.from("employee_shifts").select("*").eq("employee_id", id);

    const shiftMap = DAYS.map((_, dayIdx) => {
      const existing = (sh || []).find((s) => s.day_of_week === dayIdx);
      return existing || { day_of_week: dayIdx, start_time: "09:00", end_time: "17:00", is_day_off: dayIdx === 5 || dayIdx === 6 };
    });

    setEmployee(emp);
    setPermissions(emp?.permissions || {});
    setPayslip(latestPayslip);

    // What this person has earned so far this month, worked out from their
    // shifts, their sign-ins and sign-outs and the deduction rules. The page
    // only ever showed a finalised payslip from payroll_runs, and since no
    // payroll has been run that table is empty - so a page that had every
    // ingredient sitting behind it reported nothing at all.
    const period = new Date().toISOString().slice(0, 7);
    try {
      const tRes = await fetch(`/api/hr/payroll?payslip=${id}&trial=${period}`, {
        headers: { Authorization: `Bearer ${sess.session?.access_token}` },
      });
      if (tRes.ok) {
        const tj = await tRes.json();
        setAccrued((tj.rows || []).find((r) => r.employee_id === id) || null);
        setAccruedPeriod(tj.period || period);
      }
    } catch { /* the rest of the page is still worth showing */ }
    setEvents(tc || []);
    setLeaveRequests(lr || []);
    setShifts(shiftMap);
    setLoading(false);
  }

  function togglePermission(key) {
    setPermissions((p) => ({ ...p, [key]: !p[key] }));
    setElevationResult(null);
  }

  async function handleSaveElevation() {
    setSavingElevation(true);
    const { data: session } = await supabase.auth.getSession();
    const res = await fetch("/api/admin/elevate-employee", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token}` },
      body: JSON.stringify({ employeeId: id, permissions }),
    });
    const data = await res.json();
    setSavingElevation(false);
    if (!res.ok) {
      alert(tx(data.error || "Could not save access"));
      return;
    }
    setElevationResult(data);
    load();
  }

  async function handleSaveShifts() {
    setSavingShifts(true);
    for (const s of shifts) {
      await supabase.from("employee_shifts").upsert(
        {
          employee_id: id,
          day_of_week: s.day_of_week,
          start_time: s.is_day_off ? null : s.start_time,
          end_time: s.is_day_off ? null : s.end_time,
          is_day_off: s.is_day_off,
        },
        { onConflict: "employee_id,day_of_week" }
      );
    }
    setSavingShifts(false);
    alert(tx("Shift schedule saved."));
  }

  function updateShift(dayIdx, field, value) {
    setShifts((prev) => prev.map((s) => (s.day_of_week === dayIdx ? { ...s, [field]: value } : s)));
  }

  async function handleReviewLeave(requestId, status) {
    await supabase.from("leave_requests").update({ status }).eq("id", requestId);
    load();
  }

  function startEditInfo() {
    setInfoDraft({
      name: employee.name || "",
      phone: employee.phone || "",
      national_id: employee.national_id || "",
      role: employee.role || "",
      fixed_salary: employee.fixed_salary ?? "",
      variable_salary: employee.variable_salary ?? "",
      hourly_rate: employee.hourly_rate ?? "",
      max_cash_threshold: employee.max_cash_threshold ?? "",
      enable_hybrid_variable_pay: !!employee.enable_hybrid_variable_pay,
      shift_baseline_value: employee.shift_baseline_value ?? "",
      scan_commission_percentage: employee.scan_commission_percentage ?? "",
      minimum_shift_earning: employee.minimum_shift_earning ?? "",
      report_bonus_rate: employee.report_bonus_rate ?? "",
      report_daily_threshold: employee.report_daily_threshold ?? 5,
      short_notice_leave_ratio: employee.short_notice_leave_ratio ?? 2,
      staff_discount_percent: employee.staff_discount_percent ?? "",
    });
    setInfoError("");
    setEditingInfo(true);
  }

  async function handleSaveInfo() {
    if (!infoDraft.name) {
      setInfoError("Name is required.");
      return;
    }
    setSavingInfo(true);
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch("/api/hr/employee", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sess.session?.access_token}`,
      },
      body: JSON.stringify({
        id,
        name: infoDraft.name,
        phone: formatPhone(infoDraft.phone),
        national_id: infoDraft.national_id || null,
        role: infoDraft.role || null,
        fixed_salary: infoDraft.fixed_salary === "" ? null : Number(infoDraft.fixed_salary),
        variable_salary: infoDraft.variable_salary === "" ? null : Number(infoDraft.variable_salary),
        hourly_rate: infoDraft.hourly_rate === "" ? null : Number(infoDraft.hourly_rate),
        max_cash_threshold:
          infoDraft.max_cash_threshold === "" ? null : Number(infoDraft.max_cash_threshold),
        enable_hybrid_variable_pay: !!infoDraft.enable_hybrid_variable_pay,
        shift_baseline_value:
          infoDraft.shift_baseline_value === "" ? null : Number(infoDraft.shift_baseline_value),
        scan_commission_percentage:
          infoDraft.scan_commission_percentage === "" ? null : Number(infoDraft.scan_commission_percentage),
        minimum_shift_earning:
          infoDraft.minimum_shift_earning === "" ? null : Number(infoDraft.minimum_shift_earning),
        report_bonus_rate:
          infoDraft.report_bonus_rate === "" ? null : Number(infoDraft.report_bonus_rate),
        report_daily_threshold: Number(infoDraft.report_daily_threshold || 5),
        short_notice_leave_ratio: Number(infoDraft.short_notice_leave_ratio || 2),
        staff_discount_percent:
          infoDraft.staff_discount_percent === "" ? null : Number(infoDraft.staff_discount_percent),
      }),
    });
    setSavingInfo(false);
    if (!res.ok) {
      setInfoError((await res.json()).error || "Could not save.");
      return;
    }
    setEditingInfo(false);
    load();
  }

  async function handlePhotoPicked(e) {
    const file = e.target.files[0];
    if (!file) return;
    setDescriptor(null);
    setFaceStatus(tx("Loading face detection..."));
    setPhotoFilename(file.name);

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      setPhotoPreview(dataUrl);
      setPhotoBase64(dataUrl.split(",")[1]);

      const img = new window.Image();
      img.onload = async () => {
        try {
          await loadFaceModels();
          setFaceStatus(tx("Detecting face..."));
          const result = await extractDescriptor(img);
          if (!result) {
            setFaceStatus(tx("No face detected in this photo - try a clearer, front-facing photo."));
            return;
          }
          setDescriptor(result);
          setFaceStatus(tx("Face detected. Click Save to enroll this photo for clock in/out verification."));
        } catch (err) {
          setFaceStatus(tx("Could not process this photo: {msg}", { msg: err.message }));
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  async function handleSaveFace() {
    if (!descriptor) return;
    setSavingFace(true);
    const { data: session } = await supabase.auth.getSession();
    await fetch("/api/hr/enroll-face", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token}` },
      body: JSON.stringify({ employeeId: id, descriptor, filename: photoFilename, mimeType: "image/jpeg", base64: photoBase64 }),
    });
    setSavingFace(false);
    setDescriptor(null);
    setFaceStatus(tx("Saved."));
    load();
  }

  async function handleGeneratePayslip() {
    setGenerating(true);
    // Period is YYYY-MM everywhere. This used to send "September 2026",
    // which matched nothing in payroll_adjustments, so every manual bonus
    // and deduction was silently dropped from the committed payslip.
    const period = new Date().toISOString().slice(0, 7);
    // Committing goes through the server, not straight to the database.
    // The RPC writes to payroll, advances, the F&B tab and the cash ledger,
    // so it must sit behind the HR permission check.
    let res;
    try {
      const { data: session } = await supabase.auth.getSession();
      res = await fetch("/api/hr/payroll", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.session?.access_token}`,
        },
        body: JSON.stringify({ action: "generate", employeeId: id, period }),
      });
    } catch (e) {
      setGenerating(false);
      alert(tx("Could not reach the server. Nothing was committed."));
      return;
    }
    const j = await res.json().catch(() => ({}));
    setGenerating(false);
    if (!res.ok) {
      alert(tx(j.error || "Could not generate that payslip."));
      return;
    }
    setPayslip(j.payslip);
  }


  // Confirming the salary was paid, and how (30 Oct 2026).
  const [payMethod, setPayMethod] = useState("cash");
  const [payNote, setPayNote] = useState("");
  const [paying, setPaying] = useState(false);
  async function confirmPayment() {
    if (!payslip?.id) return;
    if (!confirm(employee?.name
      ? tx("Confirm {amount} EGP was paid to {name} for {period}?", { amount: formatMoney(payslip.net_total, { decimals: 2 }), name: employee.name, period: payslip.period })
      : tx("Confirm {amount} EGP was paid to this employee for {period}?", { amount: formatMoney(payslip.net_total, { decimals: 2 }), period: payslip.period }))) return;
    setPaying(true);
    const { data: session } = await supabase.auth.getSession();
    const res = await fetch("/api/hr/payroll", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token}` },
      body: JSON.stringify({ action: "confirm_payment", runId: payslip.id, method: payMethod, note: payNote || null }),
    });
    const j = await res.json().catch(() => ({}));
    setPaying(false);
    if (!res.ok) { alert(tx(j.error || "Could not confirm the payment.")); return; }
    setPayslip(j.payslip);
    setPayNote("");
  }

  async function loadSkills() {
    const { data: session } = await supabase.auth.getSession();
    const res = await fetch(`/api/hr/skills?employeeId=${id}`, {
      headers: { Authorization: `Bearer ${session.session?.access_token}` },
    });
    if (!res.ok) return;
    const j = await res.json();
    setSkills(j.skills || []);
    setSkillCash(j.cash_balances || []);
  }

  useEffect(() => { if (id) loadSkills(); }, [id]);

  // A Cash Keeper skill is the only thing standing between this person and
  // payroll sweeping their cash, so taking one away is confirmed out loud.
  async function toggleSkill(skill) {
    if (skill.held && skill.is_cash_keeper) {
      const holding = skillCash.map((b) => `${b.brand}: ${formatMoney(b.balance)} ${tx("EGP")}`).join(tx(", "));
      const ok = window.confirm(
        tx("Remove \"{skill}\"?", { skill: tx(skill.label) }) + "\n\n" + tx("Payroll will start sweeping this person's cash for that business at the end of the month.") +
        (holding ? "\n\n" + tx("They are currently holding {holding}.", { holding }) : "")
      );
      if (!ok) return;
    }
    setSkillBusy(skill.id);
    const { data: session } = await supabase.auth.getSession();
    const res = await fetch("/api/hr/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token}` },
      body: JSON.stringify({ employeeId: id, skillId: skill.id, action: skill.held ? "revoke" : "grant" }),
    });
    const j = await res.json().catch(() => ({}));
    setSkillBusy(null);
    if (!res.ok) { alert(tx(j.error || "Could not change that skill.")); return; }
    loadSkills();
  }

  if (loading) return <p style={{ color: theme.gray }}>{t("Loading...")}</p>;
  if (!employee) return <p style={{ color: theme.gray }}>{t("Employee not found.")}</p>;

  return (
    <div>
      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginBottom: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        {!editingInfo ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h1 style={{ color: theme.navy, margin: 0 }}>{employee.name}</h1>
              <p style={{ color: theme.gray, margin: "4px 0" }}>{employee.role ? t(employee.role) : ""} &middot; <Ltr>{employee.hr_id}</Ltr></p>
              <p style={{ color: theme.gray, margin: 0, fontSize: 13 }}>
                <Ltr>{formatPhone(employee.phone)}</Ltr> {employee.national_id ? <>· {t("National ID")} <Ltr>{employee.national_id}</Ltr></> : ""}
              </p>
              <p style={{ color: theme.gray, margin: "4px 0 0", fontSize: 13 }}>
                {/* Five of the eight staff are paid by the hour, and for them
                    fixed and variable salary are genuinely zero - so this line
                    read "Fixed: 0 EGP - Variable: 0 EGP" and looked like
                    payroll had failed. It now states how the person is
                    actually paid. */}
                {employee.hourly_rate
                  ? t("Paid hourly at {amount} EGP/hr", { amount: formatMoney(employee.hourly_rate, { decimals: 2 }) })
                  : t("Fixed: {fixed} EGP · Variable: {variable} EGP", { fixed: formatMoney(employee.fixed_salary), variable: formatMoney(employee.variable_salary) })}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {isAdmin && (
                <button onClick={startEditInfo} style={{ padding: "10px 18px", borderRadius: 8, border: `1px solid ${theme.navy}`, background: "#fff", color: theme.navy, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                  {t("Edit")}
                </button>
              )}
              <button onClick={handleGeneratePayslip} disabled={generating} style={primaryBtn}>
                {generating ? t("Generating...") : t("Generate Payslip")}
              </button>
              {isAdmin && (
                <DeleteEntityButton
                  entityLabel="employee"
                  entityName={employee.name}
                  onDelete={async () => {
                    const { data: sess } = await supabase.auth.getSession();
                    const res = await fetch(`/api/hr/employee?id=${id}`, {
                      method: "DELETE",
                      headers: { Authorization: `Bearer ${sess.session?.access_token}` },
                    });
                    if (!res.ok) throw new Error(tx((await res.json()).error || "Could not delete employee."));
                    logActivity({
                      actorId: profile?.id,
                      actorName: profile?.name,
                      actorType: "admin",
                      action: "deleted_employee",
                      entityType: "employee",
                      entityId: id,
                      details: { name: employee.name, hrId: employee.hr_id },
                    });
                  }}
                  onDeleted={() => router.push("/dashboard/hr")}
                />
              )}
            </div>
          </div>
        ) : (
          <div>
            <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Edit Employee Info")}</h3>
            <p style={{ fontSize: 11, color: theme.gray, marginTop: -8, marginBottom: 16 }}>{t("Admin only.")}</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={editLabel}>{t("Name")}</label>
                <input style={editInp} value={infoDraft.name} onChange={(e) => setInfoDraft({ ...infoDraft, name: e.target.value })} />
              </div>
              <div>
                <label style={editLabel}>{t("Role")}</label>
                <input style={editInp} value={infoDraft.role} onChange={(e) => setInfoDraft({ ...infoDraft, role: e.target.value })} />
              </div>
              <div>
                <label style={editLabel}>{t("Phone")}</label>
                <input style={editInp} value={infoDraft.phone} onChange={(e) => setInfoDraft({ ...infoDraft, phone: e.target.value })} placeholder="+20 1X XXX XXXX" />
              </div>
              <div>
                <label style={editLabel}>{t("National ID")}</label>
                <input style={editInp} value={infoDraft.national_id} onChange={(e) => setInfoDraft({ ...infoDraft, national_id: e.target.value })} />
              </div>
              <div>
                <label style={editLabel}>{t("Fixed Salary (EGP)")}</label>
                <input style={editInp} type="number" value={infoDraft.fixed_salary} onChange={(e) => setInfoDraft({ ...infoDraft, fixed_salary: e.target.value })} />
              </div>
              <div>
                <label style={editLabel}>{t("Variable Salary (EGP)")}</label>
                <input style={editInp} type="number" value={infoDraft.variable_salary} onChange={(e) => setInfoDraft({ ...infoDraft, variable_salary: e.target.value })} />
              </div>
              <div>
                <label style={editLabel}>{t("Hourly Rate (EGP)")}</label>
                <input style={editInp} type="number" value={infoDraft.hourly_rate} onChange={(e) => setInfoDraft({ ...infoDraft, hourly_rate: e.target.value })} />
              </div>
              <div>
                {/* The custody monitor already read this column; nothing could
                    write it, so a new employee had no limit and was silently
                    left out of the over-limit warnings entirely. */}
                <label style={editLabel}>{t("Cash Limit (EGP)")}</label>
                <input style={editInp} type="number" value={infoDraft.max_cash_threshold} onChange={(e) => setInfoDraft({ ...infoDraft, max_cash_threshold: e.target.value })} placeholder={t("e.g., 5000")} />
              </div>
              <div>
                <label style={editLabel}>{t("Short-Notice Leave Ratio")}</label>
                <input style={editInp} type="number" step="0.5" min="1" max="10" value={infoDraft.short_notice_leave_ratio} onChange={(e) => setInfoDraft({ ...infoDraft, short_notice_leave_ratio: e.target.value })} placeholder="2" />
                <p style={editHint}>{t("2 means a day taken at short notice costs two days. Set it by how much their absence hurts, and raise it if it repeats.")}</p>
              </div>
              <div>
                <label style={editLabel}>{t("Staff F&B Discount (%)")}</label>
                <input style={editInp} type="number" step="1" min="0" max="100" value={infoDraft.staff_discount_percent} onChange={(e) => setInfoDraft({ ...infoDraft, staff_discount_percent: e.target.value })} />
              </div>
              <div>
                <label style={editLabel}>{t("Report Bonus Rate (EGP per report)")}</label>
                <input style={editInp} type="number" step="0.01" value={infoDraft.report_bonus_rate} onChange={(e) => setInfoDraft({ ...infoDraft, report_bonus_rate: e.target.value })} placeholder={t("leave empty for none")} />
                <p style={editHint}>{t("Paid on reports past the daily count below, and on any report finished off shift.")}</p>
              </div>
              <div>
                <label style={editLabel}>{t("Reports Expected Per Day")}</label>
                <input style={editInp} type="number" step="1" min="0" value={infoDraft.report_daily_threshold} onChange={(e) => setInfoDraft({ ...infoDraft, report_daily_threshold: e.target.value })} placeholder="5" />
              </div>
            </div>

            <div style={{ marginTop: 18, padding: 14, borderRadius: 12, background: "#FBF7EF", border: `1px solid ${theme.gold}` }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 700, color: theme.navy, fontSize: 14 }}>
                <input type="checkbox" checked={!!infoDraft.enable_hybrid_variable_pay} onChange={(e) => setInfoDraft({ ...infoDraft, enable_hybrid_variable_pay: e.target.checked })} />
                {t("Hybrid pay: shift baseline plus scan commission")}
              </label>
              <p style={{ ...editHint, marginTop: 6 }}>
                {t("Off by default. While it is off this person is paid exactly as they are today. Switching it on replaces their shift pay with the baseline below plus a share of the scans they personally performed.")}
              </p>
              {infoDraft.enable_hybrid_variable_pay && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 12 }}>
                  <div>
                    <label style={editLabel}>{t("Shift Baseline (EGP)")}</label>
                    <input style={editInp} type="number" step="0.01" value={infoDraft.shift_baseline_value} onChange={(e) => setInfoDraft({ ...infoDraft, shift_baseline_value: e.target.value })} />
                  </div>
                  <div>
                    <label style={editLabel}>{t("Scan Commission (%)")}</label>
                    <input style={editInp} type="number" step="0.01" min="0" max="100" value={infoDraft.scan_commission_percentage} onChange={(e) => setInfoDraft({ ...infoDraft, scan_commission_percentage: e.target.value })} />
                  </div>
                  <div>
                    <label style={editLabel}>{t("Minimum Per Shift (EGP)")}</label>
                    <input style={editInp} type="number" step="0.01" value={infoDraft.minimum_shift_earning} onChange={(e) => setInfoDraft({ ...infoDraft, minimum_shift_earning: e.target.value })} placeholder={t("optional")} />
                    <p style={editHint}>{t("Optional floor. A quiet shift can otherwise pay a fraction of a normal one.")}</p>
                  </div>
                </div>
              )}
            </div>
            {infoError && <p style={{ color: "#ba1a1a", fontSize: 13, marginTop: 8 }}>{t(infoError)}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={() => setEditingInfo(false)} style={{ padding: "10px 18px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontWeight: 600, cursor: "pointer" }}>
                {t("Cancel")}
              </button>
              <button onClick={handleSaveInfo} disabled={savingInfo} style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                {savingInfo ? t("Saving...") : t("Save Changes")}
              </button>
            </div>
          </div>
        )}
      </div>

      <PortalAccessCard
        loginAs={{ type: "employee", id, name: employee.name }}
        hasAccount={!!employee.username}
        username={employee.username}
        defaultUsername={(employee.phone || "").replace(/\D/g, "")}
        onGenerate={async (username) => {
          const unique = await resolveUniqueUsername(supabase, "employees", username, { excludeId: id });
          const { data } = await supabase.rpc("create_employee_credentials", { p_employee_id: id, p_username: unique });
          setEmployee((e) => ({ ...e, username: unique }));
          return data;
        }}
        buildWhatsAppLink={(username, password) =>
          employeePortalWhatsAppLink({
            mobile: employee.phone,
            employeeName: employee.name,
            portalUrl: `${APP_URL}/portal`,
            username,
            password,
          })
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20 }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          {/* Earned so far, before anything is finalised. This is the figure
              somebody actually wants when they open an employee mid-month:
              what the person has accrued since the period began, net of
              deductions. The payslip below is the settled version. */}
          <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Earned so far")}</h3>
          {!accrued && (
            <p style={{ color: theme.gray, fontSize: 13 }}>
              {t("Nothing recorded for this period yet.")}
            </p>
          )}
          {accrued && (
            <div style={{ marginBottom: 22 }}>
              <p style={{ fontSize: 12, color: theme.gray, margin: "0 0 10px" }}>
                {t("{period} to date", { period: accruedPeriod })} · {accrued.pay_basis === "hourly" ? t("paid hourly") : t("monthly salary")}
              </p>
              <Row label={t("Days paid")} value={`${accrued.paid_days}${Number(accrued.absent_days) ? ` · ${t("{n} absent", { n: accrued.absent_days })}` : ""}`} />
              <Row label={t("Hours worked")} value={t("{n} hrs", { n: formatMoney(accrued.paid_hours, { decimals: 2 }) })} />
              {Number(accrued.overtime_hours) > 0 && (
                <Row label={t("Overtime (not yet decided)")} value={t("{n} hrs", { n: formatMoney(accrued.overtime_hours, { decimals: 2 }) })} />
              )}
              <Row label={t("Gross")} value={`${formatMoney(accrued.gross, { decimals: 2 })} ${t("EGP")}`} />
              {Number(accrued.scan_commission) > 0 && <Row label={t("Scan commission")} value={`${formatMoney(accrued.scan_commission, { decimals: 2 })} ${t("EGP")}`} />}
              {Number(accrued.report_bonus) > 0 && <Row label={t("Report bonus")} value={`${formatMoney(accrued.report_bonus, { decimals: 2 })} ${t("EGP")}`} />}
              {Number(accrued.bonuses) > 0 && <Row label={t("Bonuses")} value={`${formatMoney(accrued.bonuses, { decimals: 2 })} ${t("EGP")}`} />}
              {Number(accrued.rule_deductions) > 0 && <Row label={t("Deductions")} value={`- ${formatMoney(accrued.rule_deductions, { decimals: 2 })} ${t("EGP")}`} negative />}
              {Number(accrued.penalty_deductions) > 0 && <Row label={t("Penalties")} value={`- ${formatMoney(accrued.penalty_deductions, { decimals: 2 })} ${t("EGP")}`} negative />}
              {Number(accrued.advance_taken) > 0 && <Row label={t("Advance to repay")} value={`- ${formatMoney(accrued.advance_taken, { decimals: 2 })} ${t("EGP")}`} negative />}
              {Number(accrued.tab_taken) > 0 && <Row label={t("Tab to settle")} value={`- ${formatMoney(accrued.tab_taken, { decimals: 2 })} ${t("EGP")}`} negative />}
              <div style={{ borderTop: `2px solid ${theme.navy}`, marginTop: 12, paddingTop: 12, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontWeight: 700, color: theme.navy }}>{t("Earned to date")}</span>
                <span style={{ fontWeight: 700, color: theme.navy, fontSize: 20 }}>
                  {formatMoney(accrued.indicative_net, { decimals: 2 })} {t("EGP")}
                </span>
              </div>
              {accrued.flags && (
                // Said out loud rather than folded silently into the number:
                // an undecided overtime hour or an unreviewed day will move
                // this figure, and whoever reads it should know that.
                <p style={{ fontSize: 11, color: "#8a6d00", marginTop: 8 }}>{t(accrued.flags)}</p>
              )}
              <p style={{ fontSize: 11, color: theme.gray, marginTop: 6 }}>
                {t("Indicative. Nothing is settled until a payslip is generated.")}
              </p>
            </div>
          )}

          <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Current Payslip")}</h3>
          {!payslip && <p style={{ color: theme.gray, fontSize: 14 }}>{t("No payslip generated yet.")}</p>}
          {payslip && (
            <div>
              <p style={{ fontSize: 12, color: theme.gray }}>{t("Period: {period}", { period: payslip.period })}</p>
              {/* What was actually paid. "Fixed Salary 0.00" was all an hourly
                  payslip showed, with the hours, the report bonus and the
                  approved bonuses nowhere on it. */}
              <Row label={t("Expected pay")} value={`${formatMoney(Number(payslip.gross_pay || 0) - Number(payslip.report_bonus || 0) - Number(payslip.raw_data_bonus || 0), { decimals: 2 })} ${t("EGP")}`} />
              {Number(payslip.report_bonus) > 0 && <Row label={t("Report bonus")} value={`${formatMoney(payslip.report_bonus, { decimals: 2 })} ${t("EGP")}`} />}
              {Number(payslip.raw_data_bonus) > 0 && <Row label={t("Raw data bonus")} value={`${formatMoney(payslip.raw_data_bonus, { decimals: 2 })} ${t("EGP")}`} />}
              {(payslip.bonuses || []).map((b, i) => (
                <Row key={"b" + i} label={t(b.name)} value={`+ ${formatMoney(b.amount, { decimals: 2 })} ${t("EGP")}`} />
              ))}
              {(payslip.deductions || []).filter((d) => d.source !== "cap").map((d, i) => (
                <Row key={i} label={t(d.name)} value={`- ${formatMoney(d.amount, { decimals: 2 })} ${t("EGP")}`} negative />
              ))}
              {(payslip.deductions || []).filter((d) => d.source === "cap").map((d, i) => (
                <Row key={"c" + i} label={t(d.name)} value={`${formatMoney(d.deferred, { decimals: 2 })} ${t("EGP")}`} />
              ))}
              <div style={{ borderTop: `2px solid ${theme.navy}`, marginTop: 12, paddingTop: 12, display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700, color: theme.navy }}>{t("Net Pay")}</span>
                <span style={{ fontWeight: 700, color: theme.navy, fontSize: 20 }}>{formatMoney(payslip.net_total, { decimals: 2 })} {t("EGP")}</span>
              </div>
              {payslip.paid_at ? (
                <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 10, background: "#e7f6ec", color: "#1e5c33", fontSize: 13, fontWeight: 600 }}>
                  ✓ {t("Paid on {date} via {method}", { date: new Date(payslip.paid_at).toLocaleDateString(isAr ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "short", year: "numeric" }), method: PAY_METHOD_LABEL[payslip.paid_method] ? t(PAY_METHOD_LABEL[payslip.paid_method]) : tCode(payslip.paid_method) })}
                  {payslip.paid_by_name ? ` · ${t("confirmed by {name}", { name: payslip.paid_by_name })}` : ""}
                  {payslip.paid_note ? <div style={{ fontWeight: 400, fontSize: 12, marginTop: 2 }}>{payslip.paid_note}</div> : null}
                </div>
              ) : isAdmin ? (
                <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: "#fff8e1" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#6b5200", marginBottom: 8 }}>{isAr ? "لم يتم الصرف بعد" : "Not marked as paid yet · لسه ماتصرفش"}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}
                      style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13 }}>
                      {Object.entries(PAY_METHOD_LABEL).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
                    </select>
                    <input value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder={t("Note (optional)")}
                      style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13, flex: 1, minWidth: 140 }} />
                    <button onClick={confirmPayment} disabled={paying}
                      style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                      {paying ? t("Saving...") : (isAr ? "تأكيد الصرف" : "Confirm payment · تأكيد الصرف")}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 12, fontSize: 12, color: "#8a6d00" }}>{t("Not marked as paid yet.")}</div>
              )}
            </div>
          )}
        </div>

        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Recent Activity")}</h3>
          {events.length === 0 && <p style={{ color: theme.gray, fontSize: 14 }}>{t("No login/logout events yet.")}</p>}
          {events.map((e) => (
            <div key={e.id} style={{ borderBottom: "1px solid #f0f0f0", padding: "8px 0", fontSize: 13 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 600, color: theme.navy, textTransform: "capitalize" }}>{tCode(e.event_type)}</span>
                {e.face_match_status === "verified" && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#e8f5e9", color: "#2e7d32" }}>{t("Face verified")}</span>}
                {e.face_match_status === "failed" && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#fdecea", color: "#ba1a1a" }}>{t("Face not matched")}</span>}
                {e.face_match_status === "not_enrolled" && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#f0f0f0", color: "#888" }}>{t("Not enrolled")}</span>}
                {/* An admin-entered punch has no device reading behind it at all.
                    It carried no badge, so on a payroll record it looked the same
                    as a normal punch whose face check simply was not shown. */}
                {e.face_match_status === "manual_entry" && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#fff4e0", color: "#a06000" }}>{t("Added by admin")}</span>}
                {e.face_match_status === "verified_by_admin" && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#fff4e0", color: "#a06000" }}>{t("Confirmed by admin")}</span>}
              </div>
              <div style={{ color: theme.gray, fontSize: 12 }}><Ltr>{new Date(e.event_time).toLocaleString()}</Ltr></div>
              {e.lat && (
                <div style={{ color: theme.gray, fontSize: 11 }}>
                  {e.address ? e.address : `${e.lat.toFixed(4)}, ${e.lng.toFixed(4)}`}
                  {" "}
                  <a href={`https://maps.google.com/?q=${e.lat},${e.lng}`} target="_blank" rel="noreferrer" style={{ color: theme.gold }}>{t("View on map")}</a>
                  {e.ip_address && ` · IP ${e.ip_address}`}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>
          {t("Skills")}
          <span style={{ fontSize: 12, fontWeight: 400, color: theme.gray, marginInlineStart: 8 }}>
            {t("What this person is cleared to do. A Cash Keeper skill also decides whether payroll sweeps their cash.")}
          </span>
        </h3>
        {skills.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>{t("No skills defined yet.")}</p>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {skills.map((sk) => (
            <button
              key={sk.id}
              onClick={() => toggleSkill(sk)}
              disabled={skillBusy === sk.id}
              title={sk.held && sk.granted_by_name ? t("Granted by {name}", { name: sk.granted_by_name }) : sk.description || ""}
              style={{
                padding: "8px 14px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer",
                border: sk.held ? `1px solid ${sk.is_cash_keeper ? theme.gold : theme.navy}` : "1px solid #ddd",
                background: sk.held ? (sk.is_cash_keeper ? "#FBF7EF" : theme.navy) : "#fff",
                color: sk.held ? (sk.is_cash_keeper ? theme.navy : "#fff") : theme.gray,
                opacity: skillBusy === sk.id ? 0.5 : 1,
              }}
            >
              {sk.held ? "\u2713 " : "+ "}{t(sk.label)}
            </button>
          ))}
        </div>
        {skillCash.length > 0 && (
          <p style={{ marginTop: 12, marginBottom: 0, fontSize: 12, color: "#a97c00", fontWeight: 600 }}>
            {t("Currently holding {holding}.", { holding: skillCash.map((b) => t("{amount} EGP for {brand}", { amount: formatMoney(b.balance), brand: b.brand })).join(t(", ")) })}
            {" "}{t("Any business without a Cash Keeper skill above is swept at payroll.")}
          </p>
        )}
      </div>

      <BonusRatesPanel employeeId={id} />

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Weekly Shift Schedule")}</h3>
        <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
          {t("Defines this employee's expected start/end time per day. Attendance flags (late, absent) are measured against this.")}
        </p>
        {shifts.map((s) => (
          <div key={s.day_of_week} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid #f5f5f5" }}>
            <div style={{ width: 90, fontSize: 13, fontWeight: 600, color: theme.navy }}>{(isAr ? DAYS_AR : DAYS)[s.day_of_week]}</div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: theme.gray, width: 90 }}>
              <input type="checkbox" checked={s.is_day_off} onChange={(e) => updateShift(s.day_of_week, "is_day_off", e.target.checked)} />
              {t("Day off")}
            </label>
            {!s.is_day_off && (
              <>
                <input
                  type="time"
                  value={s.start_time || "09:00"}
                  onChange={(e) => updateShift(s.day_of_week, "start_time", e.target.value)}
                  style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }}
                />
                <span style={{ color: theme.gray, fontSize: 12 }}>{t("to")}</span>
                <input
                  type="time"
                  value={s.end_time || "17:00"}
                  onChange={(e) => updateShift(s.day_of_week, "end_time", e.target.value)}
                  style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }}
                />
              </>
            )}
          </div>
        ))}
        <button
          onClick={handleSaveShifts}
          disabled={savingShifts}
          style={{ marginTop: 16, padding: "10px 24px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 }}
        >
          {savingShifts ? t("Saving...") : t("Save Shift Schedule")}
        </button>
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Face Enrollment (for clock in/out verification)")}</h3>
        <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
          {t("Processed entirely in your browser, nothing is sent to any outside face-recognition service.")}
        </p>
        {employee.face_enrolled_at && !photoPreview && (
          <p style={{ fontSize: 13, color: "#2e7d32", fontWeight: 600, marginBottom: 12 }}>
            ✓ {t("Enrolled on {date}. Upload a new photo below to replace it.", { date: new Date(employee.face_enrolled_at).toLocaleDateString() })}
          </p>
        )}
        <input type="file" accept="image/*" onChange={handlePhotoPicked} style={{ marginBottom: 10 }} />
        {photoPreview && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8, marginBottom: 12 }}>
            <img src={photoPreview} alt={t("Preview")} style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8, border: "1px solid #ddd" }} />
            <p style={{ fontSize: 12, color: descriptor ? "#2e7d32" : theme.gray, fontWeight: descriptor ? 700 : 400, maxWidth: 320 }}>{faceStatus}</p>
          </div>
        )}
        {descriptor && (
          <button
            onClick={handleSaveFace}
            disabled={savingFace}
            style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 }}
          >
            {savingFace ? t("Saving...") : t("Save Enrollment")}
          </button>
        )}
      </div>

      <MonthlySchedule employeeId={id} />

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Staff Dashboard Access")}</h3>
        <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
          {t("Grant this employee access to the same staff dashboard modules your team uses. They'll reach these from within their own portal login, no separate account to remember.")}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
          {MODULES.map((m) => (
            <button
              key={m.key}
              onClick={() => togglePermission(m.key)}
              style={{
                padding: "6px 14px",
                borderRadius: 999,
                fontSize: 12,
                border: `1px solid ${permissions[m.key] ? theme.gold : "#ddd"}`,
                background: permissions[m.key] ? theme.goldLight : "#fff",
                color: theme.navy,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              {t(m.label)}
            </button>
          ))}
        </div>
        <button onClick={handleSaveElevation} disabled={savingElevation} style={{ ...primaryBtn, fontSize: 13, padding: "10px 20px" }}>
          {savingElevation ? t("Saving...") : t("Save Access")}
        </button>
        {elevationResult && (
          <div style={{ marginTop: 16, background: "#faf9fb", borderRadius: 8, padding: 14, fontSize: 13 }}>
            <p style={{ margin: 0, color: theme.navy }}>
              {elevationResult.alreadyExisted ? t("Access updated.") : t("Dashboard access created.")} {t("They'll see an \"Open Staff Dashboard\" button in their own portal after logging in, no second password to remember.")}
            </p>
          </div>
        )}
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Vacation Requests")}</h3>
        {leaveRequests.length === 0 && <p style={{ color: theme.gray, fontSize: 14 }}>{t("No vacation requests yet.")}</p>}
        {leaveRequests.map((r) => (
          <div key={r.id} style={{ borderBottom: "1px solid #f0f0f0", padding: "10px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 600, color: theme.navy, fontSize: 13 }}><Ltr>{r.start_date}</Ltr> {isAr ? "\u2190" : "\u2192"} <Ltr>{r.end_date}</Ltr></div>
              {r.reason && <div style={{ fontSize: 12, color: theme.gray }}>{r.reason}</div>}
            </div>
            {r.status === "pending" ? (
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => handleReviewLeave(r.id, "approved")} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#2e7d32", color: "#fff", fontSize: 12, cursor: "pointer" }}>{t("Approve")}</button>
                <button onClick={() => handleReviewLeave(r.id, "rejected")} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#ba1a1a", color: "#fff", fontSize: 12, cursor: "pointer" }}>{t("Reject")}</button>
              </div>
            ) : (
              <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 999, background: r.status === "approved" ? "#e8f5e9" : "#fdecea", color: r.status === "approved" ? "#2e7d32" : "#ba1a1a", fontWeight: 700, textTransform: "capitalize" }}>
                {tCode(r.status)}
              </span>
            )}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 20 }}>
        <DocumentsUploader entityType="employee" entityId={id} profile={profile} />
      </div>
    </div>
  );
}

function Row({ label, value, negative }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 14 }}>
      <span style={{ color: theme.gray }}>{label}</span>
      <span style={{ color: negative ? "#ba1a1a" : theme.navy, fontWeight: 600 }}>{value}</span>
    </div>
  );
}
const primaryBtn = { padding: "12px 24px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer" };
const editLabel = { display: "block", fontSize: 11, color: "#48464E", fontWeight: 600, marginBottom: 4 };
const editInp = { width: "100%", padding: "9px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, boxSizing: "border-box" };
const editHint = { fontSize: 11, color: "#6b6875", margin: "4px 0 0", lineHeight: 1.45 };
