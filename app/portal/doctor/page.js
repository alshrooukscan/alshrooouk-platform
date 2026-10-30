"use client";
import { useEffect, useState } from "react";
import DoctorAccount from "../../../components/DoctorAccount";
import { useRouter } from "next/navigation";
import { theme } from "../../../lib/theme";
import { formatVisitDate, doctorLabel } from "../../../lib/format";
import ImpersonationBanner from "../../../components/ImpersonationBanner";
import Loading from "../../../lib/Loading";
import { useT, Ltr } from "../../../lib/i18n";
import LanguageToggle from "../../../lib/i18n/LanguageToggle";

// Mirrors the staff dental orders screen so both sides describe an order the
// same way.
const ORDER_STATUS = {
  placed: { bg: "#eef0f7", fg: "#3b3a5a", label: "Received" },
  reviewed: { bg: "#fff8e1", fg: "#8a6d00", label: "Reviewed" },
  in_transit: { bg: "#e7f0fd", fg: "#1a4fa0", label: "On its way" },
  delivered: { bg: "#e6f4ea", fg: "#1e7a3c", label: "Delivered" },
  confirmed: { bg: "#e6f4ea", fg: "#1e7a3c", label: "Delivered" },
  cancelled: { bg: "#fdecea", fg: "#8c1d18", label: "Cancelled" },
};

export default function DoctorPortalPage() {
  const { t, tCode, isAr } = useT();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openPatientId, setOpenPatientId] = useState(null);
  const [filesByPatient, setFilesByPatient] = useState({});
  const [filesLoading, setFilesLoading] = useState(false);
  // Sets of 12+ files of one kind on one visit (a photo shoot, an unzipped
  // DICOM export) arrive from the server as one entry carrying its members.
  // Which sets the doctor has opened.
  const [openSeries, setOpenSeries] = useState({});
  // Which of the two views is showing. Scans first: patient lookup is the
  // commoner reason a doctor opens this page.
  const [view, setView] = useState("scans");
  const [query, setQuery] = useState("");
  const [orders, setOrders] = useState([]);
  const [itemRequests, setItemRequests] = useState([]);
  const [pickups, setPickups] = useState([]);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/portal/doctor/data")
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
        // Loaded separately so a failure here leaves the patient list working.
        fetch("/api/portal/doctor/orders")
          .then((r) => (r.ok ? r.json() : { orders: [], itemRequests: [] }))
          .then((o) => {
            setOrders(o.orders || []);
            setItemRequests(o.itemRequests || []);
            setPickups(o.pickups || []);
          })
          .catch(() => {});
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  async function handleLogout() {
    await fetch("/api/portal/logout", { method: "POST" });
    router.push("/login");
  }

  async function toggleFiles(patientId) {
    if (openPatientId === patientId) {
      setOpenPatientId(null);
      return;
    }
    setOpenPatientId(patientId);
    if (!filesByPatient[patientId]) {
      setFilesLoading(true);
      const res = await fetch(`/api/portal/doctor/patient-files?patientId=${patientId}`);
      const result = await res.json();
      setFilesByPatient((prev) => ({ ...prev, [patientId]: result.files || [] }));
      setFilesLoading(false);
    }
  }

  if (loading) return <Loading />;

  // Group visits by patient so each referred patient appears once with their full history and files
  const patientGroups = {};
  for (const v of data.visits) {
    const pid = v.patient_id;
    if (!patientGroups[pid]) patientGroups[pid] = { name: v.patients?.name, mobile: v.patients?.mobile, visits: [] };
    patientGroups[pid].visits.push(v);
  }

  // Substring search on name or mobile, same behavior as the staff Patients page
  const q = query.trim().toLowerCase();
  const qDigits = query.replace(/\D/g, "");
  const filteredGroups = Object.entries(patientGroups).filter(([, group]) => {
    if (!q) return true;
    const nameMatch = group.name?.toLowerCase().includes(q);
    const mobileMatch = qDigits && group.mobile?.replace(/\D/g, "").includes(qDigits);
    return nameMatch || mobileMatch;
  });

  function StatusChip({ label, active }) {
    return (
      <span
        style={{
          fontSize: 10,
          padding: "3px 8px",
          borderRadius: 999,
          fontWeight: 700,
          whiteSpace: "nowrap",
          background: active ? "#e7f6ec" : "#f2f2f2",
          color: active ? "#1e7a3c" : "#999",
        }}
      >
        {active ? "\u2713" : "\u25cb"} {label}
      </span>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: theme.bg }}>
      <ImpersonationBanner impersonatedBy={data.impersonatedBy} name={data.doctor?.name} />
      <div style={{ background: theme.navy, padding: "10px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <img src="/logo-mark.png" alt="" style={{ height: 32, width: "auto" }} />
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>Al Shrooouk Scan &amp; Lab</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <LanguageToggle compact style={{ color: "#fff", borderColor: "rgba(255,255,255,0.3)" }} />
          <button
            onClick={() => router.push("/portal/doctor/dental-stock")}
            style={{ background: theme.gold, border: "none", color: theme.navy, borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
          >
            {t("Request Dental Stock Items")}
          </button>
          <button onClick={handleLogout} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
            {t("Log Out")}
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px" }}>
        <h2 style={{ color: theme.navy, marginBottom: 2 }}>{data.doctor?.name}</h2>
        <p style={{ color: theme.gold, fontWeight: 600, marginBottom: 20 }}>{data.doctor?.clinic_code} &middot; {data.doctor?.clinic_name}</p>

        {/* Shown on both views, above the tabs: what the clinic owes is the
            first thing a doctor should see, and it is a clinic figure - every
            doctor at 506 sees the same 1,075, because that is who the money is
            owed by. Only rendered when something is actually outstanding; a
            clinic that owes nothing does not need telling. */}
        {Number(data.clinicOwes || 0) > 0 && (
          <div
            style={{
              background: "#fff8e1",
              border: "1px solid #eedfae",
              borderRadius: 14,
              padding: "16px 18px",
              marginBottom: 20,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ color: "#8a6d00", fontWeight: 700, fontSize: 14 }}>
                {t("Your clinic owes us")}
              </div>
              <div style={{ color: "#8a6d00", fontSize: 12, marginTop: 2 }}>
                {data.clinicName || data.doctor?.clinic_name || t("Clinic {code}", { code: data.doctor?.clinic_code })} &middot;
                {" "}{t("for dental supplies. Settle it with reception on your next visit.")}
              </div>
            </div>
            <div style={{ color: "#8a6d00", fontSize: 26, fontWeight: 700, whiteSpace: "nowrap" }}>
              <Ltr>{t("{amount} EGP", { amount: Number(data.clinicOwes).toLocaleString() })}</Ltr>
            </div>
          </div>
        )}
        {Number(data.clinicOwes || 0) > 0 && (
          <DoctorAccount open={data.accountOpen || []} history={data.accountHistory || []} balance={data.clinicOwes} />
        )}

        {/* Patients and supply orders are two different jobs a doctor comes
            here to do. Stacking both made the page long and pushed the patient
            search below the orders, so they are separate views now. Scans is
            first because looking up a patient is the commoner errand. */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {[
            { key: "scans", label: "Scans" },
            { key: "orders", label: "Supply Orders" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setView(tab.key)}
              style={{
                flex: 1,
                padding: "12px 0",
                borderRadius: 10,
                border: `1px solid ${view === tab.key ? theme.navy : "#ddd"}`,
                background: view === tab.key ? theme.navy : "#fff",
                color: view === tab.key ? "#fff" : theme.navy,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t(tab.label)}
            </button>
          ))}
        </div>

        {view === "orders" && (orders.length > 0 || itemRequests.length > 0) && (
          <div style={{ background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)", marginBottom: 20 }}>
            <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("My Supply Orders")}</h3>
            {orders.map((o) => {
              const st = ORDER_STATUS[o.status] || ORDER_STATUS.placed;
              return (
                <div key={o.id} style={{ borderBottom: "1px solid #f0f0f0", padding: "12px 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 700, color: theme.navy, fontSize: 14 }}>
                      <Ltr>{t("{amount} EGP", { amount: Number(o.total_amount).toLocaleString() })}</Ltr>
                      {o.fulfillment === "backorder" && (
                        <span style={{ marginInlineStart: 8, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#fff8e1", color: "#8a6d00" }}>
                          {t("Awaiting stock")}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: st.bg, color: st.fg }}>{t(st.label)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: theme.gray, margin: "4px 0 6px" }}>
                    {new Date(o.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    {" \u00b7 "}{o.items.length === 1 ? t("1 item") : t("{n} items", { n: o.items.length })}
                    {" \u00b7 "}{o.payment_status === "paid" ? t("Paid") : t("Unpaid")}
                  </div>
                  <div style={{ fontSize: 12, color: theme.navy }}>
                    {o.items.map((l, i) => (
                      <div key={i}>{l.quantity} &times; {l.item_name}</div>
                    ))}
                  </div>
                  {/* The same four digits the team sees. Read them out to
                      whoever brings the order - it is what closes the delivery. */}
                  {o.delivery_otp && o.status !== "delivered" && (
                    <div style={{ marginTop: 10, background: theme.goldLight, borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ fontSize: 11, color: theme.navy, fontWeight: 600 }}>{t("Give this code to the person delivering your order")}</div>
                      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: 6, color: theme.navy }}>{o.delivery_otp}</div>
                    </div>
                  )}
                </div>
              );
            })}
            {itemRequests.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: theme.navy, marginBottom: 6 }}>{t("Items you asked us to source")}</div>
                {itemRequests.map((r) => (
                  <div key={r.id} style={{ fontSize: 12, color: theme.gray, padding: "4px 0" }}>
                    {r.item_name}{r.quantity ? ` \u00b7 ${r.quantity}` : ""}{" \u00b7 "}
                    <span style={{ color: r.status === "pending" ? "#8a6d00" : theme.navy }}>{isAr ? tCode(r.status) : r.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Items picked up at reception, with what each cost. These are most of
            what clinics take, and they were missing from this tab entirely. */}
        {view === "orders" && pickups.length > 0 && (
          <div style={{ background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)", marginBottom: 20 }}>
            <h3 style={{ color: theme.navy, margin: "0 0 2px" }}>{t("Picked up at reception")}</h3>
            {/* The Arabic subtitle stays for English readers; in Arabic the heading above already says it. */}
            {!isAr && <div style={{ fontSize: 13, color: "#8a6d00", fontWeight: 700, marginBottom: 6 }} dir="rtl">مسحوبات من الاستقبال</div>}
            <p style={{ fontSize: 12, color: theme.gray, margin: "0 0 8px" }}>
              {pickups.length === 1
                ? t("1 pickup, newest first. The unpaid ones make up the balance above.")
                : t("{n} pickups, newest first. The unpaid ones make up the balance above.", { n: pickups.length })}
            </p>
            {pickups.map((x) => (
              <div key={x.id} style={{ borderTop: "1px solid #f0f0f0", padding: "10px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 700, color: theme.navy, fontSize: 14 }}><Ltr>{t("{amount} EGP", { amount: Number(x.amount).toLocaleString() })}</Ltr></div>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                    background: x.status === "open" || x.status === "partly" ? "#fff8e1" : "#e7f6ec",
                    color: x.status === "open" || x.status === "partly" ? "#8a6d00" : "#1e7a3c" }}>
                    {x.status === "open" ? t("Not paid yet")
                      : x.status === "partly" ? t("Partly paid")
                      : x.status === "settled" ? t("Paid later")
                      : t("Paid at pickup")}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: theme.gray, margin: "3px 0 6px" }}>
                  {new Date(x.date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  {x.receipt_no ? ` \u00b7 ${x.receipt_no}` : ""}{x.discount_percent > 0 ? ` \u00b7 ${t("{pct}% discount", { pct: x.discount_percent })}` : ""}
                </div>
                {x.items.map((l, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12, padding: "2px 0", color: theme.navy }}>
                    <div style={{ minWidth: 0 }}>
                      <div dir="auto" style={{ fontWeight: 600 }}>{l.item_name}</div>
                      <div dir="ltr" style={{ color: theme.gray, fontSize: 11 }}>{l.quantity} × {Number(l.unit_price).toLocaleString()} {t("EGP")}</div>
                    </div>
                    <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{Number(l.line_total).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {view === "orders" && orders.length === 0 && itemRequests.length === 0 && pickups.length === 0 && (
          <div style={{ background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)", color: theme.gray, fontSize: 14 }}>
            {t("No supply orders yet. Use \"Request Dental Stock Items\" above to place one.")}
          </div>
        )}

        <div style={{ background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)", display: view === "scans" ? "block" : "none" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Clinic Patients")}</h3>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>{t("Every patient referred to {code} is shown here, including cases referred by other doctors at this clinic.", { code: data.doctor?.clinic_code })}</p>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Search by patient name or mobile...")}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, marginBottom: 16, boxSizing: "border-box" }}
          />
          {Object.keys(patientGroups).length === 0 && <p style={{ color: theme.gray, fontSize: 14 }}>{t("No referrals yet.")}</p>}
          {Object.keys(patientGroups).length > 0 && filteredGroups.length === 0 && <p style={{ color: theme.gray, fontSize: 14 }}>{t("No patients match \"{query}\".", { query })}</p>}
          {filteredGroups.map(([patientId, group]) => (
            <div key={patientId} style={{ borderBottom: "1px solid #f0f0f0", padding: "10px 0" }}>
              <div
                onClick={() => toggleFiles(patientId)}
                style={{ display: "flex", justifyContent: "space-between", cursor: "pointer" }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: theme.navy }}>{group.name}</div>
                  <div style={{ fontSize: 12, color: theme.gray }}>{group.visits.length > 1 ? t("{n} visits", { n: group.visits.length }) : t("{n} visit", { n: group.visits.length })}</div>
                </div>
                <span style={{ color: theme.gold, fontSize: 12, fontWeight: 600 }}>
                  {openPatientId === patientId ? t("Hide Files") : t("View Files")}
                </span>
              </div>

              {openPatientId === patientId && (
                <div style={{ marginTop: 12, paddingInlineStart: 4 }}>
                  {group.visits.map((v) => (
                    <div key={v.id} style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 999, background: theme.goldLight, color: theme.navy, whiteSpace: "nowrap" }}>
                          {formatVisitDate(v.exam_date)}
                        </span>
                        <span style={{ fontSize: 12, color: theme.gray }}>{(v.scan_types || []).join(", ")}</span>
                      </div>
                      {v.doctors?.name && (
                        <div style={{ fontSize: 11, color: theme.gray, marginBottom: 4 }}>
                          {t("Referred by {name}", { name: doctorLabel(v.doctors.name) })}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                        <StatusChip label={t("Scanned")} active={v.scanned} />
                        <StatusChip label={t("Raw Data Uploaded")} active={v.raw_data_uploaded} />
                        <StatusChip label={t("Report Done")} active={v.report_done} />
                      </div>
                      <div style={{ fontSize: 11, color: v.payment_status === "paid" ? "#1e7a3c" : v.payment_status === "partial" ? "#b45309" : "#999", fontWeight: 600 }}>
                        {v.payment_status === "paid" && t("Paid in full")}
                        {v.payment_status === "partial" && t("Partial - Paid {paid} EGP, Due {due} EGP", { paid: Number(v.amount_paid || 0).toFixed(2), due: (Number(v.amount_due || 0) - Number(v.amount_paid || 0)).toFixed(2) })}
                        {v.payment_status === "pending" && t("Pending - Due {due} EGP", { due: Number(v.amount_due || 0).toFixed(2) })}
                        {(v.visit_payments || []).length > 0 && (
                          <span style={{ color: theme.gray, fontWeight: 400 }}> &middot; {[...new Set((v.visit_payments || []).map((p) => p.payment_method))].map((m) => (isAr ? tCode(m) : m)).join(" + ")}</span>
                        )}
                      </div>
                    </div>
                  ))}
                  <div style={{ marginTop: 8 }}>
                    {filesLoading && !filesByPatient[patientId] && <p style={{ fontSize: 12, color: theme.gray }}>{t("Loading files...")}</p>}
                    {filesByPatient[patientId]?.length === 0 && <p style={{ fontSize: 12, color: theme.gray }}>{t("No files uploaded for this patient yet.")}</p>}
                    {(() => {
                      const files = filesByPatient[patientId] || [];
                      const FileGrid = ({ items }) => (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 150px), 1fr))", gap: 8 }}>
                          {items.map((f) =>
                            f.seriesCount > 1 ? (
                              // The server folds a large set into one entry. It
                              // was drawn as a plain file before, so a doctor
                              // saw the first of 23 photos and nothing else.
                              <div key={f.id} style={{ background: "#faf9fb", borderRadius: 8, padding: 10, gridColumn: openSeries[f.id] ? "1 / -1" : undefined }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: theme.navy }}>
                                  {f.typeLabel ? (isAr ? tCode(f.typeLabel) : f.typeLabel.replace(/_/g, " ")) : t("Files")} &middot; {t("{n} files in one set", { n: f.seriesCount })}
                                </div>
                                <div style={{ fontSize: 10, color: theme.gray }}>{new Date(f.createdTime).toLocaleDateString()}</div>
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
                            ) : (
                              <a
                                key={f.id}
                                href={f.webViewLink}
                                target="_blank"
                                rel="noreferrer"
                                style={{ background: "#faf9fb", borderRadius: 8, padding: 10, textDecoration: "none" }}
                              >
                                <div style={{ fontSize: 12, fontWeight: 600, color: theme.navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                                <div style={{ fontSize: 10, color: theme.gray }}>{new Date(f.createdTime).toLocaleDateString()}</div>
                              </a>
                            )
                          )}
                        </div>
                      );
                      const ungrouped = files.filter((f) => !f.groupLabel);
                      const groups = {};
                      for (const f of files) if (f.groupLabel) (groups[f.groupLabel] = groups[f.groupLabel] || []).push(f);
                      return (
                        <>
                          {ungrouped.length > 0 && <FileGrid items={ungrouped} />}
                          {Object.entries(groups).map(([label, items]) => (
                            <div key={label} style={{ marginTop: 8 }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: theme.gray, marginBottom: 4, textTransform: "uppercase" }}>
                                {t("Visit")} &mdash; {label.split("__")[0]}
                              </div>
                              <FileGrid items={items} />
                            </div>
                          ))}
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
