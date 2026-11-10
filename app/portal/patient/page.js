"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { theme } from "../../../lib/theme";
import { formatVisitDate } from "../../../lib/format";
import ImpersonationBanner from "../../../components/ImpersonationBanner";
import Loading from "../../../lib/Loading";
import { useT } from "../../../lib/i18n";
import LanguageToggle from "../../../lib/i18n/LanguageToggle";
import ViewOnlineLink from "../../../components/ViewOnlineLink";

export default function PatientPortalPage() {
  const { t, tCode, isAr } = useT();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // Sets of 12+ files of one kind on one visit arrive as one entry carrying
  // its members. Drawn as a plain file, a patient saw the first of their 23
  // photos and could not reach the rest.
  const [openSeries, setOpenSeries] = useState({});
  const SetEntry = ({ f, box }) => (
    <div style={{ ...box, gridColumn: openSeries[f.id] ? "1 / -1" : undefined }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: theme.navy }}>{f.typeLabel ? `${t(f.typeLabel)} · ` : ""}{t("{n} files in one set", { n: f.seriesCount })}</div>
      <button
        type="button"
        onClick={() => setOpenSeries((o) => ({ ...o, [f.id]: !o[f.id] }))}
        style={{ marginTop: 6, padding: "4px 10px", borderRadius: 6, border: `1px solid ${theme.navy}`, background: "#fff", color: theme.navy, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
      >
        {openSeries[f.id] ? t("Hide files") : t("Show all {n}", { n: f.seriesCount })}
      </button>
      {openSeries[f.id] && (
        <div style={{ marginTop: 8, maxHeight: 320, overflowY: "auto", borderTop: "1px solid #eee" }}>
          {f.series.map((m) => (
            <a key={m.id} href={m.webViewLink} target="_blank" rel="noreferrer"
              style={{ display: "block", padding: "6px 2px", borderBottom: "1px solid #f0f0f3", fontSize: 12, color: theme.navy, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {m.name}
            </a>
          ))}
        </div>
      )}
    </div>
  );
  const router = useRouter();

  useEffect(() => {
    fetch("/api/portal/patient/data")
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
        setLoading(false);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  async function handleLogout() {
    await fetch("/api/portal/logout", { method: "POST" });
    router.push("/login");
  }

  if (loading) return <Loading />;

  return (
    <div style={{ minHeight: "100vh", background: theme.bg }}>
      <ImpersonationBanner impersonatedBy={data.impersonatedBy} name={data.patient?.name} />
      <TopBar onLogout={handleLogout} />
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "24px 16px" }}>
        <h2 style={{ color: theme.navy, marginBottom: 4 }}>{t("Hi {name},", { name: data.patient?.name?.split(" ")[0] })}</h2>
        <p style={{ color: theme.gray, marginBottom: 20 }}>{t("Here's the status of your scans and results.")}</p>

        {data.visits.length === 0 && <EmptyCard>{t("No visits on record yet.")}</EmptyCard>}
        {data.visits.map((v) => (
          <div key={v.id} style={cardStyle}>
            <div style={{ fontWeight: 700, color: theme.navy }}>{(v.scan_types || []).join(", ")}</div>
            <div style={{ fontSize: 12, color: theme.navy, marginTop: 2, fontWeight: 600 }}>{formatVisitDate(v.exam_date)}<span style={{ color: theme.gray, fontWeight: 400 }}> &middot; {v.branches?.name}</span></div>
            <div style={{ fontSize: 12, color: theme.gray, marginTop: 2 }}>{t("Referred by:")} {v.doctors?.name || t("Walk-in, no referring doctor")}</div>
            <span
              style={{
                display: "inline-block",
                marginTop: 8,
                padding: "3px 10px",
                borderRadius: 999,
                fontSize: 11,
                background: v.payment_status === "paid" ? "#e8f5e9" : "#fff8e1",
                color: v.payment_status === "paid" ? "#2e7d32" : "#a97c00",
              }}
            >
              {isAr ? (v.payment_status === "pending" ? t("Unpaid") : tCode(v.payment_status)) : v.payment_status}
            </span>

            {v.files && v.files.length > 0 && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #f0f0f0", display: "grid", gap: 6 }}>
                {v.files.map((f) => f.seriesCount > 1 ? (
                  <SetEntry key={f.id} f={f} box={{ padding: "8px 10px", borderRadius: 8, background: "#faf9fb" }} />
                ) : (
                  <div key={f.id} style={{ padding: "8px 10px", borderRadius: 8, background: "#faf9fb" }}>
                    <a
                      href={f.webViewLink}
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", textDecoration: "none" }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 600, color: theme.navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                      {!f.exact && (
                        <span style={{ fontSize: 9, color: theme.gray, fontStyle: "italic", whiteSpace: "nowrap", marginInlineStart: 8 }}>{t("possibly related")}</span>
                      )}
                    </a>
                    <ViewOnlineLink fileId={f.id} name={f.name} />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {data.files.length > 0 && (
          <>
            <h3 style={{ color: theme.navy, marginTop: 28, marginBottom: 12 }}>{t("Other Files")}</h3>
            <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 12 }}>{t("Couldn't be matched to a specific scan above.")}</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {data.files.map((f) => f.seriesCount > 1 ? (
                <SetEntry key={f.id} f={f} box={cardStyle} />
              ) : (
                <a key={f.id} href={f.webViewLink} target="_blank" rel="noreferrer" style={{ ...cardStyle, textDecoration: "none", display: "block" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: theme.navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                  <div style={{ fontSize: 11, color: theme.gray, marginTop: 4 }}>{new Date(f.createdTime).toLocaleDateString()}</div>
                </a>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TopBar({ onLogout }) {
  const { t } = useT();
  return (
    <div style={{ background: theme.navy, padding: "10px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <img src="/logo-mark.png" alt="" style={{ height: 32, width: "auto" }} />
        <span style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>Al Shrooouk Scan &amp; Lab</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <LanguageToggle compact style={{ color: "#fff", borderColor: "rgba(255,255,255,0.3)" }} />
      <button onClick={onLogout} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
        {t("Log Out")}
      </button>
      </div>
    </div>
  );
}
function Centered({ children }) {
  return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: theme.gray }}>{children}</div>;
}
function EmptyCard({ children }) {
  return <div style={{ ...cardStyle, color: theme.gray, fontSize: 13 }}>{children}</div>;
}
const cardStyle = { background: "#fff", borderRadius: 12, padding: 16, marginBottom: 10, boxShadow: "0 2px 10px rgba(39,33,77,0.05)" };
