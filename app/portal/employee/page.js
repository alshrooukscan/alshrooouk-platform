"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { theme } from "../../../lib/theme";
import ImpersonationBanner from "../../../components/ImpersonationBanner";
import { formatMoney } from "../../../lib/format";
import Loading from "../../../lib/Loading";
import { loadFaceModels, extractDescriptor } from "../../../lib/faceMatch";

export default function EmployeePortalPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [punching, setPunching] = useState(false);
  const [geoError, setGeoError] = useState("");
  const [tab, setTab] = useState("overview");
  const router = useRouter();

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const r = await fetch("/api/portal/employee/data");
    if (!r.ok) {
      router.replace("/login");
      return;
    }
    const d = await r.json();
    if (d.mustChangePassword) {
      router.replace("/portal/change-password");
      return;
    }
    setData(d);
    setLoading(false);
  }

  async function handleLogout() {
    await fetch("/api/portal/logout", { method: "POST" });
    router.push("/login");
  }

  async function handleOpenDashboard() {
    const res = await fetch("/api/portal/employee/dashboard-link", { method: "POST" });
    const result = await res.json();
    if (result.link) {
      window.open(result.link, "_blank");
    } else {
      alert(result.error || "Could not open dashboard");
    }
  }

  const [captureEventType, setCaptureEventType] = useState(null);

  function handlePunch(eventType) {
    setGeoError("");
    setCaptureEventType(eventType);
  }

  // FaceLocationCapture now owns the whole submit/retry/warn/confirm cycle
  // itself (it needs the camera and location refs throughout that loop
  // anyway) and calls this once a final outcome exists - either a
  // successfully recorded event, or an error worth surfacing.
  function handleClockDone(result) {
    if (result?.error) {
      setGeoError(result.error);
    }
    setPunching(false);
    setCaptureEventType(null);
    load();
  }

  if (loading) return <Loading />;

  const lastEvent = data.events[0];
  const nextAction = lastEvent?.event_type === "login" ? "logout" : "login";
  const annualBase = formatMoney(Number(data.employee?.fixed_salary || 0) * 12);

  return (
    <div style={{ minHeight: "100vh", background: theme.bg }}>
      <ImpersonationBanner impersonatedBy={data.impersonatedBy} name={data.employee?.name} />
      <div style={{ background: theme.navy, padding: "10px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <img src="/logo-mark.png" alt="" style={{ height: 32, width: "auto" }} />
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>Al Shrooouk Scan &amp; Lab</span>
        </div>
        <button onClick={handleLogout} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
          Log Out
        </button>
      </div>

      <div style={{ maxWidth: 480, margin: "0 auto", padding: "24px 16px" }}>
        <h2 style={{ color: theme.navy, marginBottom: 2 }}>{data.employee?.name}</h2>
        <p style={{ color: theme.gray, marginBottom: 20 }}>{data.employee?.role} &middot; {data.employee?.hr_id}</p>

        <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
          {[
            { key: "overview", label: "Overview" },
            { key: "schedule", label: "Schedule" },
            { key: "swaps", label: "Swaps" },
            { key: "payslips", label: "Payslips" },
            { key: "vacations", label: "Vacations" },
            { key: "excuses", label: "Excuses" },
            { key: "transfers", label: "Cash Transfers" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                flex: 1,
                padding: "8px 0",
                borderRadius: 8,
                border: `1px solid ${tab === t.key ? theme.gold : "#ddd"}`,
                background: tab === t.key ? theme.goldLight : "#fff",
                color: theme.navy,
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <>
            <div style={{ background: "#fff", borderRadius: 16, padding: 20, marginBottom: 20, textAlign: "center", boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
              <p style={{ fontSize: 13, color: theme.gray, marginBottom: 12 }}>
                {lastEvent ? `Last: ${lastEvent.event_type} at ${new Date(lastEvent.event_time).toLocaleTimeString()}` : "No activity yet today"}
              </p>
              <button
                onClick={() => handlePunch(nextAction)}
                disabled={punching}
                style={{
                  padding: "14px 32px",
                  borderRadius: 999,
                  border: "none",
                  background: nextAction === "login" ? theme.navy : "#ba1a1a",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 15,
                  cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >
                {punching ? "Getting location..." : nextAction === "login" ? "Sign In" : "Sign Out"}
              </button>
              {geoError && <p style={{ color: "#ba1a1a", fontSize: 12, marginTop: 10 }}>{geoError}</p>}
              <p style={{ fontSize: 10, color: "#bbb", marginTop: 10 }}>Sign in/out only works from the clinic. Your location and IP address are recorded with each entry for attendance tracking.</p>
            </div>

            {data.employee?.staff_account_email && Object.values(data.employee?.permissions || {}).some(Boolean) && (
              <div style={{ background: theme.navy, borderRadius: 16, padding: 20, marginBottom: 20, textAlign: "center" }}>
                <p style={{ color: "#fff", fontSize: 13, marginBottom: 10 }}>You've been given access to additional workspace tools.</p>
                <button
                  onClick={handleOpenDashboard}
                  style={{
                    padding: "10px 24px",
                    borderRadius: 999,
                    border: "none",
                    background: `linear-gradient(135deg, ${theme.gold}, ${theme.goldLight})`,
                    color: theme.navy,
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  Open Staff Dashboard
                </button>
              </div>
            )}

            <div style={cardStyle}>
              <h3 style={{ color: theme.navy, marginTop: 0, fontSize: 15 }}>Salary Overview</h3>
              <Row label="Fixed Salary (monthly)" value={`${formatMoney(data.employee?.fixed_salary, { decimals: 2 })} EGP`} />
              <Row label="Variable Salary (monthly)" value={`${formatMoney(data.employee?.variable_salary, { decimals: 2 })} EGP`} />
              <Row label="Annual Base (fixed x 12)" value={`${annualBase} EGP`} bold />
            </div>

            <h3 style={{ color: theme.navy, marginTop: 20, marginBottom: 10, fontSize: 15 }}>Recent Activity</h3>
            {data.events.length === 0 && <div style={cardStyle}>No sign in/out activity yet.</div>}
            {data.events.map((e) => (
              <div key={e.id} style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 600, color: theme.navy, textTransform: "capitalize" }}>{e.event_type}</span>
                  <span style={{ fontSize: 12, color: theme.gray }}>{new Date(e.event_time).toLocaleString()}</span>
                </div>
                <div style={{ fontSize: 11, color: theme.gray, marginTop: 4 }}>
                  {e.lat && (
                    <div>
                      {e.address && <span>{e.address}</span>}
                      {e.lat && (
                        <a href={`https://maps.google.com/?q=${e.lat},${e.lng}`} target="_blank" rel="noreferrer" style={{ color: theme.gold, marginLeft: e.address ? 6 : 0 }}>
                          View on map
                        </a>
                      )}
                    </div>
                  )}
                  {e.ip_address && <span>IP {e.ip_address}</span>}
                </div>
              </div>
            ))}
          </>
        )}

        {tab === "payslips" && (
          <>
            {data.payslips.length === 0 && <div style={cardStyle}>No payslips generated yet.</div>}
            {data.payslips.map((p) => (
              <div key={p.id} style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 600, color: theme.navy }}>{p.period}</span>
                  <span style={{ fontWeight: 700, color: theme.navy }}>{formatMoney(p.net_total, { decimals: 2 })} EGP</span>
                </div>
                {(p.deductions || []).length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    {p.deductions.map((d, i) => (
                      <div key={i} style={{ fontSize: 11, color: "#ba1a1a" }}>- {d.name}: {formatMoney(d.amount, { decimals: 2 })} EGP</div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {tab === "schedule" && <ScheduleTab schedule={data.schedule} />}
        {tab === "swaps" && <SwapsTab onChanged={load} />}

        {tab === "vacations" && <VacationsTab leaveRequests={data.leaveRequests} onSubmitted={load} />}
        {tab === "excuses" && <ExcusesTab excuseRules={data.excuseRules} excuseSubmissions={data.excuseSubmissions} onSubmitted={load} />}
        {tab === "transfers" && <TransfersTab incomingTransfers={data.incomingTransfers} onReviewed={load} />}
      </div>

      {captureEventType && (
        <FaceLocationCapture
          eventType={captureEventType}
          onCancel={() => setCaptureEventType(null)}
          onReady={handleClockDone}
        />
      )}
    </div>
  );
}

function FaceLocationCapture({ eventType, onCancel, onReady }) {
  const [status, setStatus] = useState("Getting your location...");
  const [warning, setWarning] = useState(null); // { reasons, locationMessage, faceMessage }
  const [confirming, setConfirming] = useState(false);
  const videoElRef = useRef(null);
  const canvasElRef = useRef(null);
  const streamRef = useRef(null);
  const locationRef = useRef(null);
  const pendingRef = useRef(null); // last attempt's { lat, lng, faceDescriptor, faceCaptureBase64 }
  const NO_FACE_MAX_ATTEMPTS = 2;
  const MISMATCH_MAX_ATTEMPTS = 2;

  useEffect(() => {
    let cancelled = false;

    function stopStream() {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    }

    async function submitAttempt(payload, overrideConfirmed) {
      const res = await fetch("/api/portal/employee/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType, ...payload, overrideConfirmed }),
      });
      return { ok: res.ok, data: await res.json() };
    }

    function finishDone(result) {
      stopStream();
      onReady(result);
    }

    async function captureAndVerify(noFaceAttempt, mismatchAttempt) {
      if (cancelled || !videoElRef.current || !locationRef.current) return;
      setStatus("Verifying...");
      const canvas = canvasElRef.current;
      canvas.width = videoElRef.current.videoWidth || 320;
      canvas.height = videoElRef.current.videoHeight || 240;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(videoElRef.current, 0, 0, canvas.width, canvas.height);

      let descriptor = null;
      try {
        descriptor = await extractDescriptor(canvas);
      } catch {
        descriptor = null;
      }
      if (cancelled) return;

      if (!descriptor) {
        const nextAttempt = noFaceAttempt + 1;
        if (nextAttempt < NO_FACE_MAX_ATTEMPTS) {
          setStatus(`No face detected, trying again... (${nextAttempt}/${NO_FACE_MAX_ATTEMPTS})`);
          setTimeout(() => !cancelled && captureAndVerify(nextAttempt, mismatchAttempt), 1200);
          return;
        }
        // Truly no face found after retrying - proceed with location only,
        // same as before: never let a camera issue block a real clock-in.
        descriptor = null;
      }

      const captureBase64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
      const payload = { lat: locationRef.current.lat, lng: locationRef.current.lng, faceDescriptor: descriptor, faceCaptureBase64: captureBase64 };
      pendingRef.current = payload;

      const { data } = await submitAttempt(payload, false);
      if (cancelled) return;

      if (!data.needsConfirmation) {
        finishDone(data);
        return;
      }

      // Only silently retry when it's specifically an unmatched-face issue on
      // an attempt that hasn't been retried yet - a fresh frame sometimes
      // fixes a bad angle or lighting. Location doesn't get this retry: GPS
      // reading again isn't going to change where someone actually is.
      const faceOnly = data.reasons.includes("face") && !data.reasons.includes("location");
      const nextMismatchAttempt = mismatchAttempt + 1;
      if (faceOnly && nextMismatchAttempt < MISMATCH_MAX_ATTEMPTS) {
        setStatus("Having trouble confirming your face, trying once more...");
        setTimeout(() => !cancelled && captureAndVerify(0, nextMismatchAttempt), 1200);
        return;
      }

      setWarning(data);
      setStatus("");
    }

    async function init() {
      if (!navigator.geolocation) {
        setStatus("Geolocation isn't available on this device.");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          if (cancelled) return;
          locationRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setStatus("Loading face verification...");
          try {
            await loadFaceModels();
          } catch {
            // Models failing to load shouldn't block attendance - proceed to camera anyway,
            // a failed descriptor extraction downstream will just mark this as unverified.
          }
          if (cancelled) return;
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
            if (cancelled) {
              stream.getTracks().forEach((t) => t.stop());
              return;
            }
            streamRef.current = stream;
            if (videoElRef.current) {
              videoElRef.current.srcObject = stream;
              await videoElRef.current.play();
            }
            setStatus("Look at the camera...");
            setTimeout(() => !cancelled && captureAndVerify(0, 0), 1200);
          } catch {
            // No camera access - still check location/write via the same
            // endpoint, with no face data attached (server marks not_enrolled
            // or leaves it as-is; a location issue can still trigger a warning).
            setStatus("Camera permission denied - continuing with location only.");
            const payload = { lat: locationRef.current.lat, lng: locationRef.current.lng, faceDescriptor: null, faceCaptureBase64: null };
            pendingRef.current = payload;
            const { data } = await submitAttempt(payload, false);
            if (cancelled) return;
            if (!data.needsConfirmation) {
              finishDone(data);
            } else {
              setWarning(data);
              setStatus("");
            }
          }
        },
        () => {
          if (!cancelled) setStatus("Location permission is required to sign in or out.");
        }
      );
    }

    init();
    return () => {
      cancelled = true;
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConfirmAnyway() {
    if (!pendingRef.current) return;
    setConfirming(true);
    const res = await fetch("/api/portal/employee/clock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType, ...pendingRef.current, overrideConfirmed: true }),
    });
    const data = await res.json();
    setConfirming(false);
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    onReady(data);
  }

  function handleCancel() {
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    onCancel();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,11,56,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 24, width: 340, maxWidth: "90vw", textAlign: "center" }}>
        <h3 style={{ color: theme.navy, marginTop: 0, textTransform: "capitalize" }}>{eventType === "login" ? "Sign In" : "Sign Out"}</h3>

        {!warning && (
          <>
            <div style={{ width: 240, height: 180, margin: "0 auto 12px", borderRadius: 12, overflow: "hidden", background: "#111", position: "relative" }}>
              <video ref={videoElRef} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
            </div>
            <canvas ref={canvasElRef} style={{ display: "none" }} />
            <p style={{ fontSize: 13, color: theme.gray }}>{status}</p>
            <button onClick={handleCancel} style={{ marginTop: 8, padding: "8px 20px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontWeight: 600, cursor: "pointer" }}>
              Cancel
            </button>
          </>
        )}

        {warning && (
          <div>
            <div style={{ fontSize: 32, marginBottom: 8 }}>&#9888;&#65039;</div>
            {warning.locationMessage && (
              <p style={{ fontSize: 13, color: "#202124", textAlign: "left", background: "#fff8e1", border: "1px solid #f0d98c", borderRadius: 10, padding: "10px 12px", marginBottom: warning.faceMessage ? 8 : 16 }}>
                {warning.locationMessage}
              </p>
            )}
            {warning.faceMessage && (
              <p style={{ fontSize: 13, color: "#202124", textAlign: "left", background: "#fff8e1", border: "1px solid #f0d98c", borderRadius: 10, padding: "10px 12px", marginBottom: 16 }}>
                {warning.faceMessage}
              </p>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleCancel}
                disabled={confirming}
                style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontWeight: 600, cursor: "pointer", fontSize: 13 }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAnyway}
                disabled={confirming}
                style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: "#ba1a1a", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 }}
              >
                {confirming ? "Confirming..." : "Yes, Confirm"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ScheduleTab({ schedule }) {
  const [hideOffs, setHideOffs] = useState(false);

  if (!schedule || schedule.length === 0) {
    return <div style={cardStyle}>No schedule has been set for you yet, check with HR.</div>;
  }
  const visible = hideOffs ? schedule.filter((d) => !d.is_day_off) : schedule;
  const grouped = {};
  for (const d of visible) {
    const monthKey = d.work_date.slice(0, 7);
    grouped[monthKey] = grouped[monthKey] || [];
    grouped[monthKey].push(d);
  }
  return (
    <div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: theme.navy, marginBottom: 14, cursor: "pointer" }}>
        <input type="checkbox" checked={hideOffs} onChange={(e) => setHideOffs(e.target.checked)} />
        Show scheduled shifts only, hide days off
      </label>
      {visible.length === 0 && <div style={cardStyle}>No scheduled shifts in this view - every upcoming day is a day off.</div>}
      {Object.entries(grouped).map(([month, days]) => (
        <div key={month} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: theme.gray, marginBottom: 8, textTransform: "uppercase" }}>
            {new Date(month + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </div>
          {days.map((d) => {
            const dow = new Date(d.work_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" });
            return (
              <div key={d.id} style={{ ...cardStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: theme.navy, fontWeight: 600 }}>{dow}, {d.work_date}</span>
                {d.is_day_off ? (
                  <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 999, background: "#f0f0f0", color: "#888", fontWeight: 700 }}>Day Off</span>
                ) : (
                  <span style={{ fontSize: 13, color: theme.gray }}>{d.start_time?.slice(0, 5)} – {d.end_time?.slice(0, 5)}</span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function VacationsTab({ leaveRequests, onSubmitted }) {
  const [showForm, setShowForm] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!startDate || !endDate) {
      setError("Start and end dates are required.");
      return;
    }
    setSaving(true);
    setError("");
    const res = await fetch("/api/portal/employee/leave-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate, reason }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Could not submit request.");
      return;
    }
    setShowForm(false);
    setStartDate("");
    setEndDate("");
    setReason("");
    onSubmitted();
  }

  const statusColor = { pending: "#a97c00", approved: "#2e7d32", rejected: "#ba1a1a" };
  const statusBg = { pending: "#fff8e1", approved: "#e8f5e9", rejected: "#fdecea" };

  return (
    <div>
      {!showForm && (
        <button onClick={() => setShowForm(true)} style={{ width: "100%", padding: "12px 0", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer", marginBottom: 16 }}>
          + Request Vacation
        </button>
      )}
      {showForm && (
        <div style={cardStyle}>
          <label style={labelStyle}>Start Date</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inp} />
          <label style={labelStyle}>End Date</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={inp} />
          <label style={labelStyle}>Reason (optional)</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} style={inp} placeholder="e.g., Family trip" />
          {error && <p style={{ color: "#ba1a1a", fontSize: 12 }}>{error}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, cursor: "pointer" }}>Cancel</button>
            <button onClick={handleSubmit} disabled={saving} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
              {saving ? "Submitting..." : "Submit"}
            </button>
          </div>
        </div>
      )}

      {leaveRequests.length === 0 && !showForm && <div style={cardStyle}>No vacation requests yet.</div>}
      {leaveRequests.map((r) => (
        <div key={r.id} style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: theme.navy, fontWeight: 600 }}>{r.start_date} &rarr; {r.end_date}</span>
            <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 999, background: statusBg[r.status], color: statusColor[r.status], fontWeight: 700, textTransform: "capitalize" }}>{r.status}</span>
          </div>
          {r.reason && <div style={{ fontSize: 12, color: theme.gray, marginTop: 4 }}>{r.reason}</div>}
        </div>
      ))}
    </div>
  );
}

function ExcusesTab({ excuseRules, excuseSubmissions, onSubmitted }) {
  const [showForm, setShowForm] = useState(false);
  const [excuseRuleId, setExcuseRuleId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!excuseRuleId) {
      setError("Pick an excuse type.");
      return;
    }
    setSaving(true);
    setError("");
    const res = await fetch("/api/portal/employee/excuse-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ excuseRuleId, note }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Could not submit excuse.");
      return;
    }
    setShowForm(false);
    setExcuseRuleId("");
    setNote("");
    onSubmitted();
  }

  const statusColor = { pending: "#a97c00", approved: "#2e7d32", rejected: "#ba1a1a" };
  const statusBg = { pending: "#fff8e1", approved: "#e8f5e9", rejected: "#fdecea" };

  return (
    <div>
      {!showForm && (
        <button onClick={() => setShowForm(true)} style={{ width: "100%", padding: "12px 0", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer", marginBottom: 16 }}>
          + Submit Excuse
        </button>
      )}
      {showForm && (
        <div style={cardStyle}>
          <label style={labelStyle}>Excuse Type</label>
          <select value={excuseRuleId} onChange={(e) => setExcuseRuleId(e.target.value)} style={inp}>
            <option value="">Select excuse type...</option>
            {excuseRules.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <label style={labelStyle}>Note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} style={inp} placeholder="Add any detail for admin to review" />
          {error && <p style={{ color: "#ba1a1a", fontSize: 12 }}>{error}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, cursor: "pointer" }}>Cancel</button>
            <button onClick={handleSubmit} disabled={saving} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
              {saving ? "Submitting..." : "Submit"}
            </button>
          </div>
        </div>
      )}

      {excuseSubmissions.length === 0 && !showForm && <div style={cardStyle}>No excuses submitted yet.</div>}
      {excuseSubmissions.map((s) => (
        <div key={s.id} style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: theme.navy, fontWeight: 600 }}>{s.excuse_rules?.name || "Excuse"}</span>
            <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 999, background: statusBg[s.status], color: statusColor[s.status], fontWeight: 700, textTransform: "capitalize" }}>{s.status}</span>
          </div>
          {s.note && <div style={{ fontSize: 12, color: theme.gray, marginTop: 4 }}>{s.note}</div>}
          <div style={{ fontSize: 11, color: theme.gray, marginTop: 4 }}>{new Date(s.created_at).toLocaleDateString()}</div>
        </div>
      ))}
    </div>
  );
}

function TransfersTab({ incomingTransfers, onReviewed }) {
  const [busyId, setBusyId] = useState(null);
  const statusColor = { pending: "#a97c00", confirmed: "#2e7d32", rejected: "#ba1a1a" };
  const statusBg = { pending: "#fff8e1", confirmed: "#e8f5e9", rejected: "#fdecea" };

  async function review(transferId, action) {
    setBusyId(transferId);
    await fetch("/api/portal/employee/confirm-transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transferId, action }),
    });
    setBusyId(null);
    onReviewed();
  }

  const pending = incomingTransfers.filter((t) => t.status === "pending");
  const reviewed = incomingTransfers.filter((t) => t.status !== "pending");

  return (
    <div>
      {pending.length === 0 && reviewed.length === 0 && <div style={cardStyle}>No cash transfers to you yet.</div>}
      {pending.map((t) => (
        <div key={t.id} style={{ ...cardStyle, border: `1px solid ${theme.gold}` }}>
          <div style={{ fontSize: 13, color: theme.navy, marginBottom: 8 }}>
            <strong>{t.from_employee?.name}</strong> wants to hand you <strong>{Number(t.amount).toLocaleString()} EGP</strong> in cash
            {t.note && <div style={{ fontSize: 12, color: theme.gray, marginTop: 2 }}>{t.note}</div>}
          </div>
          <p style={{ fontSize: 11, color: theme.gray, marginTop: -4, marginBottom: 10 }}>
            Only confirm once you've actually received this cash in hand.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => review(t.id, "reject")}
              disabled={busyId === t.id}
              style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, cursor: "pointer", fontSize: 13 }}
            >
              I did not receive this
            </button>
            <button
              onClick={() => review(t.id, "confirm")}
              disabled={busyId === t.id}
              style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 }}
            >
              {busyId === t.id ? "Confirming..." : "Yes, I received it"}
            </button>
          </div>
        </div>
      ))}
      {reviewed.map((t) => (
        <div key={t.id} style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: theme.navy, fontWeight: 600 }}>{t.from_employee?.name} → {Number(t.amount).toLocaleString()} EGP</span>
            <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 999, background: statusBg[t.status], color: statusColor[t.status], fontWeight: 700, textTransform: "capitalize" }}>{t.status}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Row({ label, value, bold }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
      <span style={{ color: theme.gray }}>{label}</span>
      <span style={{ color: theme.navy, fontWeight: bold ? 700 : 600 }}>{value}</span>
    </div>
  );
}

const cardStyle = { background: "#fff", borderRadius: 12, padding: 14, marginBottom: 8, boxShadow: "0 2px 10px rgba(39,33,77,0.05)" };
const labelStyle = { fontSize: 12, fontWeight: 600, color: "#27214D", display: "block", marginBottom: 6 };
const inp = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box", marginBottom: 14 };

// ---------------------------------------------------------------------------
// Shift swaps
//
// A swap is proposed against two specific, existing scheduled days: one of
// mine, one of a named colleague's. It only takes effect when that colleague
// accepts - at which point the two days trade owners.
// ---------------------------------------------------------------------------
function describeDay(d) {
  if (!d) return "-";
  const dow = new Date(d.work_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" });
  if (d.is_day_off) return `${dow} ${d.work_date} · Day Off`;
  return `${dow} ${d.work_date} · ${d.start_time?.slice(0, 5)}-${d.end_time?.slice(0, 5)}`;
}

const swapBadge = {
  pending: { bg: "#fff8e1", fg: "#a97c00", label: "Pending" },
  awaiting_admin: { bg: "#e8eefc", fg: "#27214d", label: "Awaiting HR" },
  accepted: { bg: "#e6f4ea", fg: "#1e7a3c", label: "Accepted" },
  rejected: { bg: "#fdecea", fg: "#ba1a1a", label: "Rejected" },
  cancelled: { bg: "#f0f0f0", fg: "#888", label: "Cancelled" },
};

function StatusPill({ status }) {
  const b = swapBadge[status] || swapBadge.cancelled;
  return (
    <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 999, background: b.bg, color: b.fg, fontWeight: 700, whiteSpace: "nowrap" }}>
      {b.label}
    </span>
  );
}

function SwapsTab({ onChanged }) {
  const [swapData, setSwapData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [myDayId, setMyDayId] = useState("");
  const [colleagueId, setColleagueId] = useState("");
  const [theirDayId, setTheirDayId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadSwaps();
  }, []);

  async function loadSwaps() {
    setLoading(true);
    const res = await fetch("/api/portal/employee/swap");
    if (res.ok) setSwapData(await res.json());
    setLoading(false);
  }

  async function submit() {
    setError("");
    if (!myDayId || !colleagueId || !theirDayId) {
      setError("Pick your day, a colleague, and the day you want from them.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/portal/employee/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requesterDayId: myDayId, targetId: colleagueId, targetDayId: theirDayId, note }),
    });
    const result = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(result.error || "Could not send that request.");
      return;
    }
    setShowForm(false);
    setMyDayId("");
    setColleagueId("");
    setTheirDayId("");
    setNote("");
    loadSwaps();
  }

  async function respond(requestId, action) {
    setError("");
    setBusy(true);
    const res = await fetch("/api/portal/employee/swap/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, action }),
    });
    const result = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(result.error || "Could not update that request.");
      loadSwaps();
      return;
    }
    await loadSwaps();
    // Agreeing no longer rewrites the roster (HR approves that), so the
    // Schedule tab is still accurate - no reload needed.
  }

  if (loading) return <div style={cardStyle}>Loading swaps...</div>;
  if (!swapData) return <div style={cardStyle}>Could not load swaps.</div>;

  const theirDays = swapData.colleagueDays.filter((d) => d.employee_id === colleagueId);
  const OPEN = ["pending", "awaiting_admin"];
  const pendingIncoming = swapData.incoming.filter((r) => r.status === "pending");
  const awaitingHr = [...swapData.incoming, ...swapData.outgoing].filter((r) => r.status === "awaiting_admin");
  const history = [...swapData.incoming.filter((r) => !OPEN.includes(r.status)), ...swapData.outgoing.filter((r) => !OPEN.includes(r.status))]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const pendingOutgoing = swapData.outgoing.filter((r) => r.status === "pending");

  const selectStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13, boxSizing: "border-box", marginBottom: 10, background: "#fff" };

  return (
    <div>
      <button
        onClick={() => setShowForm((v) => !v)}
        style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 14 }}
      >
        {showForm ? "Cancel" : "+ Request a Swap"}
      </button>

      {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}

      {showForm && (
        <div style={{ background: "#faf9fb", borderRadius: 12, padding: 16, marginBottom: 18 }}>
          <label style={{ display: "block", fontSize: 11, color: "#48464E", fontWeight: 600, marginBottom: 4 }}>My day to give up</label>
          <select value={myDayId} onChange={(e) => setMyDayId(e.target.value)} style={selectStyle}>
            <option value="">Select one of your days...</option>
            {swapData.myDays.map((d) => (
              <option key={d.id} value={d.id}>{describeDay(d)}</option>
            ))}
          </select>

          <label style={{ display: "block", fontSize: 11, color: "#48464E", fontWeight: 600, marginBottom: 4 }}>Swap with</label>
          <select
            value={colleagueId}
            onChange={(e) => { setColleagueId(e.target.value); setTheirDayId(""); }}
            style={selectStyle}
          >
            <option value="">Select a colleague...</option>
            {swapData.colleagues.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <label style={{ display: "block", fontSize: 11, color: "#48464E", fontWeight: 600, marginBottom: 4 }}>Their day I would take</label>
          <select value={theirDayId} onChange={(e) => setTheirDayId(e.target.value)} disabled={!colleagueId} style={{ ...selectStyle, opacity: colleagueId ? 1 : 0.6 }}>
            <option value="">{colleagueId ? "Select one of their days..." : "Pick a colleague first"}</option>
            {theirDays.map((d) => (
              <option key={d.id} value={d.id}>{describeDay(d)}</option>
            ))}
          </select>
          {colleagueId && theirDays.length === 0 && (
            <p style={{ fontSize: 12, color: "#a97c00", margin: "0 0 10px" }}>This colleague has no upcoming days scheduled.</p>
          )}

          <label style={{ display: "block", fontSize: 11, color: "#48464E", fontWeight: 600, marginBottom: 4 }}>Note (optional)</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why you're asking"
            style={{ ...selectStyle, marginBottom: 12 }}
          />

          <button
            onClick={submit}
            disabled={busy}
            style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, fontSize: 13, cursor: busy ? "wait" : "pointer" }}
          >
            {busy ? "Sending..." : "Send Request"}
          </button>
          <p style={{ fontSize: 11, color: theme.gray, margin: "10px 0 0" }}>
            Your colleague has to agree, then HR approves. The schedule only changes after both.
          </p>
        </div>
      )}

      <div style={{ fontSize: 12, fontWeight: 700, color: theme.gray, marginBottom: 8, textTransform: "uppercase" }}>
        Waiting on you
      </div>
      {pendingIncoming.length === 0 && <div style={cardStyle}>Nothing waiting for your answer.</div>}
      {pendingIncoming.map((r) => (
        <div key={r.id} style={cardStyle}>
          <div style={{ fontSize: 13, color: theme.navy, fontWeight: 700, marginBottom: 4 }}>
            {r.requester?.name} wants to swap
          </div>
          <div style={{ fontSize: 12, color: theme.gray, marginBottom: 2 }}>
            They give you: {describeDay(r.requester_day)}
          </div>
          <div style={{ fontSize: 12, color: theme.gray, marginBottom: 8 }}>
            You give them: {describeDay(r.target_day)}
          </div>
          {r.note && <div style={{ fontSize: 12, color: theme.navy, fontStyle: "italic", marginBottom: 8 }}>&ldquo;{r.note}&rdquo;</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => respond(r.id, "accept")}
              disabled={busy}
              style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: "#1e7a3c", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
            >
              Accept
            </button>
            <button
              onClick={() => respond(r.id, "reject")}
              disabled={busy}
              style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontWeight: 700, fontSize: 12, cursor: "pointer" }}
            >
              Decline
            </button>
          </div>
        </div>
      ))}

      {awaitingHr.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: theme.gray, margin: "18px 0 8px", textTransform: "uppercase" }}>
            Agreed, waiting on HR
          </div>
          {awaitingHr.map((r) => (
            <div key={r.id} style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 13, color: theme.navy, fontWeight: 700 }}>
                  {r.requester?.name || "You"} &harr; {r.target?.name || "You"}
                </span>
                <StatusPill status={r.status} />
              </div>
              <div style={{ fontSize: 12, color: theme.gray }}>
                {describeDay(r.requester_day)} &harr; {describeDay(r.target_day)}
              </div>
              <div style={{ fontSize: 11, color: "#a97c00", marginTop: 6 }}>
                Both of you agreed. Your roster stays as-is until HR approves.
              </div>
            </div>
          ))}
        </>
      )}

      <div style={{ fontSize: 12, fontWeight: 700, color: theme.gray, margin: "18px 0 8px", textTransform: "uppercase" }}>
        Your requests
      </div>
      {pendingOutgoing.length === 0 && <div style={cardStyle}>No requests waiting on anyone.</div>}
      {pendingOutgoing.map((r) => (
        <div key={r.id} style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 13, color: theme.navy, fontWeight: 700 }}>Waiting on {r.target?.name}</span>
            <StatusPill status={r.status} />
          </div>
          <div style={{ fontSize: 12, color: theme.gray, marginBottom: 2 }}>You give up: {describeDay(r.requester_day)}</div>
          <div style={{ fontSize: 12, color: theme.gray, marginBottom: 8 }}>You would take: {describeDay(r.target_day)}</div>
          <button
            onClick={() => respond(r.id, "cancel")}
            disabled={busy}
            style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontWeight: 700, fontSize: 12, cursor: "pointer" }}
          >
            Cancel Request
          </button>
        </div>
      ))}

      {history.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: theme.gray, margin: "18px 0 8px", textTransform: "uppercase" }}>
            History
          </div>
          {history.map((r) => (
            <div key={r.id} style={{ ...cardStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 13, color: theme.navy, fontWeight: 600 }}>
                  {r.requester?.name || "You"} &rarr; {r.target?.name || "You"}
                </div>
                <div style={{ fontSize: 11, color: theme.gray }}>
                  {describeDay(r.requester_day)} &harr; {describeDay(r.target_day)}
                </div>
              </div>
              <StatusPill status={r.status} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}
