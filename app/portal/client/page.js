"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { theme } from "../../../lib/theme";
import ImpersonationBanner from "../../../components/ImpersonationBanner";
import Loading from "../../../lib/Loading";
import DoctorAccount from "../../../components/DoctorAccount";
import { uploadFileToDrive } from "../../../lib/uploadToDrive";
import { useT, tx, Ltr } from "../../../lib/i18n";
import LanguageToggle from "../../../lib/i18n/LanguageToggle";

export default function ClientPortalPage() {
  const { t } = useT();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [scanName, setScanName] = useState("");
  const [dateRequired, setDateRequired] = useState("");
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");
  const [scanTypes, setScanTypes] = useState([]);
  const [requestNote, setRequestNote] = useState("");
  // White label from the first frame: the client's logo on the loading screen,
  // never ours. Remembered on this device, and fetched on its own so it arrives
  // before the rest of the portal.
  const [brandLogo, setBrandLogo] = useState(false);
  const router = useRouter();

  useEffect(() => {
    try { const cached = localStorage.getItem("client_portal_logo"); if (cached) setBrandLogo(cached); } catch {}
    fetch("/api/portal/client/brand").then((r) => (r.ok ? r.json() : null)).then((b) => {
      if (b?.logo_url) { setBrandLogo(b.logo_url); try { localStorage.setItem("client_portal_logo", b.logo_url); } catch {} }
    }).catch(() => {});
    load();
  }, []);

  function load() {
    fetch("/api/portal/client/data")
      .then((r) => {
        if (!r.ok) throw new Error("unauthorized");
        return r.json();
      })
      .then((d) => {
        if (d.mustChangePassword) {
          router.replace("/portal/change-password");
          return;
        }
        setData(d);
        setScanTypes(d.scanTypes || []);
        setLoading(false);
      })
      .catch(() => router.replace("/login"));
  }

  async function handleLogout() {
    await fetch("/api/portal/logout", { method: "POST" });
    router.push("/login");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!scanName.trim() || !file) {
      setError(tx("Choose the scan type and attach a file."));
      return;
    }
    setSubmitting(true);
    setUploadProgress(0);
    setError("");
    try {
      const { sessionUrl, reportId } = await (async () => {
        const initRes = await fetch("/api/portal/client/upload-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scanName: scanName.trim(), requestNote: requestNote.trim() || null, dateRequired: dateRequired || undefined,
            fileName: file.name, mimeType: file.type, sizeBytes: file.size,
          }),
        });
        const j = await initRes.json();
        if (!initRes.ok) throw new Error(j.error || tx("Could not start upload"));
        return j;
      })();

      const fileId = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", sessionUrl, true);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText).id);
          else reject(new Error(tx("Upload failed ({status})", { status: xhr.status })));
        };
        xhr.onerror = () => reject(new Error(tx("Network error during upload")));
        xhr.send(file);
      });

      const res = await fetch("/api/portal/client/upload-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, reportId, fileName: file.name }),
      });
      const result = await res.json();
      if (!res.ok) {
        setError(result.error || tx("Something went wrong submitting this request."));
      } else {
        setScanName("");
        setDateRequired("");
        setFile(null);
        setShowForm(false);
        load();
      }
    } catch (err) {
      setError(err.message || tx("Something went wrong submitting this request."));
    }
    setSubmitting(false);
    setUploadProgress(0);
  }

  if (loading) return <Loading logo={brandLogo} />;

  return (
    <div style={{ minHeight: "100vh", background: theme.bg }}>
      <ImpersonationBanner impersonatedBy={data.impersonatedBy} name={data.client?.name} />
      <div style={{ background: theme.navy, padding: "10px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* White label. This portal is where the client's own patients see
              their results, so it carries the client's mark and name. Ours
              only appears when they have not given us one. */}
          <img src={data?.client?.logo_url || "/logo-mark.png"} alt="" style={{ height: 32, width: "auto", maxWidth: 140, objectFit: "contain" }} />
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>
            {data?.client?.name || "Al Shrooouk Scan & Lab"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <LanguageToggle compact style={{ color: "#fff", borderColor: "rgba(255,255,255,0.3)" }} />
        <button onClick={handleLogout} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
          {t("Log Out")}
        </button>
        </div>
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px" }}>
        <h2 style={{ color: theme.navy, marginBottom: 20 }}>{data.client?.name}</h2>

        {/* What they owe, and what it is made of: each finished report at its
            price, and each payment. */}
        {Number(data.owes || 0) > 0 && (
          <div style={{ background: "#fff8e1", border: "1px solid #eedfae", borderRadius: 14, padding: "16px 18px", marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ color: "#8a6d00", fontWeight: 700, fontSize: 14 }}>{t("Amount due")}</div>
              <div style={{ color: "#8a6d00", fontSize: 12, marginTop: 2 }}>{t("For finished reports. Settle it with Al Shrooouk.")}</div>
            </div>
            <div style={{ color: "#8a6d00", fontSize: 26, fontWeight: 700, whiteSpace: "nowrap" }}><Ltr>{t("{amount} EGP", { amount: Number(data.owes).toLocaleString() })}</Ltr></div>
          </div>
        )}
        {Number(data.owes || 0) > 0 && (
          <DoctorAccount open={data.accountOpen || []} history={data.accountHistory || []} balance={data.owes} />
        )}

        <div style={{ background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)", marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: showForm ? 16 : 0 }}>
            <h3 style={{ color: theme.navy, margin: 0 }}>{t("Submit a Request")}</h3>
            <button
              onClick={() => setShowForm((v) => !v)}
              style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: theme.gold, color: theme.navy, fontWeight: 700, cursor: "pointer", fontSize: 12 }}
            >
              {showForm ? t("Cancel") : t("+ New Request")}
            </button>
          </div>
          {showForm && (
            <form onSubmit={handleSubmit}>
              {/* Chosen from the list rather than typed, so every request carries
                  the same name as the price list ("cbctq" and "cbct q" were the
                  same scan written two ways). */}
              <label style={lbl}>{t("What is this for?")}</label>
              <input style={inp} value={requestNote} onChange={(e) => setRequestNote(e.target.value)} placeholder={t("e.g. CBCT report for patient X")} />
              <label style={lbl}>{t("Scan type")}</label>
              <select style={inp} value={scanName} onChange={(e) => setScanName(e.target.value)}>
                <option value="">{t("Choose the scan type...")}</option>
                {scanTypes.map((st) => <option key={st.name} value={st.name}>{st.name}{st.price != null ? ` · ${t("{amount} EGP", { amount: Number(st.price).toLocaleString() })}` : ""}</option>)}
              </select>
              {(() => {
                const sel = scanTypes.find((st) => st.name === scanName);
                if (!sel) return null;
                return (
                  <div style={{ marginTop: -4, marginBottom: 10, padding: "8px 12px", borderRadius: 8, background: sel.price != null ? "#eef6f0" : "#fff8e1", fontSize: 13, color: sel.price != null ? "#1e5c33" : "#8a6d00", fontWeight: 600 }}>
                    {sel.price != null ? t("Report price: {amount} EGP", { amount: Number(sel.price).toLocaleString() }) : t("Price to be confirmed by Al Shrooouk")}
                  </div>
                );
              })()}
              <label style={lbl}>{t("Date Needed (optional)")}</label>
              <input type="date" style={inp} value={dateRequired} onChange={(e) => setDateRequired(e.target.value)} />
              <label style={lbl}>{t("Attach File")}</label>
              <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ marginBottom: 10 }} />
              {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{t(error)}</p>}
              <button type="submit" disabled={submitting} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13, position: "relative", overflow: "hidden" }}>
                {submitting && (
                  <div style={{ position: "absolute", inset: 0, insetInlineStart: 0, width: `${uploadProgress}%`, background: "rgba(255,255,255,0.25)", transition: "width 0.15s linear" }} />
                )}
                <span style={{ position: "relative" }}>{submitting ? t("Submitting... {pct}%", { pct: uploadProgress }) : t("Submit Request")}</span>
              </button>
            </form>
          )}
        </div>

        <div style={{ background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Your Requests")}</h3>
          {data.reports.length === 0 && <p style={{ color: theme.gray, fontSize: 14 }}>{t("No requests yet.")}</p>}
          {data.reports.map((r) => (
            <div key={r.id} style={{ borderBottom: "1px solid #f0f0f0", padding: "12px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 600, color: theme.navy, fontSize: 14 }}>{r.scan_type_name || r.scan_name}</div>
                  {r.request_note && <div style={{ fontSize: 12, color: theme.navy }} dir="auto">{r.request_note}</div>}
                  <div style={{ fontSize: 12, color: theme.gray }}>{t("Needed by {date}", { date: r.date_required })}</div>
                </div>
                <span
                  style={{
                    fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999,
                    background: r.status === "completed" ? "#e7f6ec" : "#fff8e1",
                    color: r.status === "completed" ? "#1e7a3c" : "#8a6d00",
                  }}
                >
                  {r.status === "completed" ? t("Done") : t("Pending")}
                </span>
              </div>
              {(r.report_files?.length ? r.report_files : r.report_file_url ? [{ name: r.report_file_name, url: r.report_file_url }] : []).map((f, i) => (
                <div key={f.file_id || f.url || i}>
                  <a href={f.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: theme.gold, fontWeight: 600 }}>
                    {t("Download:")} {f.name}
                  </a>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const lbl = { display: "block", fontSize: 11, color: "#48464E", fontWeight: 600, marginBottom: 4, marginTop: 10 };
const inp = { width: "100%", padding: "9px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, boxSizing: "border-box", marginBottom: 4 };
