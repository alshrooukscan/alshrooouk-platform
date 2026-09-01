"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import { formatVisitDate } from "../../../../lib/format";
import { formatPhone } from "../../../../lib/formatPhone";
import PortalAccessCard from "../../../../components/PortalAccessCard";
import {
  doctorPortalWhatsAppLink,
  doctorReportWhatsAppLink,
  doctorRawDataWhatsAppLink,
  directWhatsAppLink,
} from "../../../../lib/whatsapp";
import WhatsAppDropdown from "../../../../components/WhatsAppDropdown";
import { resolveUniqueUsername } from "../../../../lib/uniqueUsername";
import { usePermissions } from "../../../../lib/usePermissions";
import { logActivity } from "../../../../lib/activityLog";
import DeleteEntityButton from "../../../../components/DeleteEntityButton";

export default function DoctorProfilePage() {
  const { id } = useParams();
  const router = useRouter();
  const { isAdmin, profile } = usePermissions();
  const [doctor, setDoctor] = useState(null);
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState([]);
  const [editingInfo, setEditingInfo] = useState(false);
  const [infoDraft, setInfoDraft] = useState({});
  const [infoError, setInfoError] = useState("");
  const [savingInfo, setSavingInfo] = useState(false);

  useEffect(() => {
    load();
    supabase.from("branches").select("id, name").eq("is_active", true).then(({ data }) => setBranches(data || []));
  }, [id]);

  async function load() {
    setLoading(true);
    const { data: d } = await supabase.from("doctors").select("*").eq("id", id).single();
    const { data: v } = await supabase
      .from("visits")
      .select("id, scan_types, exam_date, payment_status, patients(name)")
      .eq("doctor_id", id)
      .order("exam_date", { ascending: false });
    setDoctor(d);
    setVisits(v || []);
    setLoading(false);
  }

  function startEditInfo() {
    setInfoDraft({
      name: doctor.name || "",
      clinic_code: doctor.clinic_code || "",
      clinic_name: doctor.clinic_name || "",
      phone: doctor.phone || "",
      phone_2: doctor.phone_2 || "",
      email: doctor.email || "",
      branch_id: doctor.branch_id || "",
      discount_pct: doctor.discount_pct ?? "",
      special_note: doctor.special_note || "",
    });
    setInfoError("");
    setEditingInfo(true);
  }

  async function handleSaveInfo() {
    if (!infoDraft.name || !infoDraft.clinic_code) {
      setInfoError("Name and clinic code are required.");
      return;
    }
    setSavingInfo(true);
    const { error } = await supabase
      .from("doctors")
      .update({
        name: infoDraft.name,
        clinic_code: infoDraft.clinic_code,
        clinic_name: infoDraft.clinic_name || null,
        phone: formatPhone(infoDraft.phone),
        phone_2: infoDraft.phone_2 ? formatPhone(infoDraft.phone_2) : null,
        email: infoDraft.email || null,
        branch_id: infoDraft.branch_id || null,
        discount_pct: infoDraft.discount_pct === "" ? 0 : Number(infoDraft.discount_pct),
        special_note: infoDraft.special_note || null,
      })
      .eq("id", id);
    setSavingInfo(false);
    if (error) {
      setInfoError(error.message);
      return;
    }
    logActivity({
      actorId: profile?.id,
      actorName: profile?.name,
      actorType: "admin",
      action: "edited_doctor",
      entityType: "doctor",
      entityId: id,
      details: { name: infoDraft.name, clinicCode: infoDraft.clinic_code },
    });
    setEditingInfo(false);
    load();
  }

  if (loading) return <p style={{ color: theme.gray }}>Loading...</p>;
  if (!doctor) return <p style={{ color: theme.gray }}>Doctor not found.</p>;

  const thisMonth = visits.filter((v) => {
    const d = new Date(v.exam_date);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const pending = visits.filter((v) => v.payment_status !== "paid").length;

  return (
    <div>
      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginBottom: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        {!editingInfo ? (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ color: theme.navy, margin: 0 }}>{doctor.name}</h1>
            <p style={{ color: theme.gold, fontWeight: 600, margin: "4px 0" }}>{doctor.clinic_code} · {doctor.clinic_name}</p>
            <p style={{ color: theme.gray, margin: 0 }}>
              {formatPhone(doctor.phone)}
              {doctor.phone_2 && ` · ${formatPhone(doctor.phone_2)}`}
              {doctor.email ? ` · ${doctor.email}` : ""}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
          {isAdmin && (
            <button onClick={startEditInfo} style={{ padding: "10px 18px", borderRadius: 8, border: `1px solid ${theme.navy}`, background: "#fff", color: theme.navy, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
              Edit
            </button>
          )}
          {isAdmin && (
            <DeleteEntityButton
              entityLabel="doctor"
              entityName={doctor.name}
              onDelete={async () => {
                const { error } = await supabase.from("doctors").delete().eq("id", id);
                if (error) throw error;
                logActivity({
                  actorId: profile?.id,
                  actorName: profile?.name,
                  actorType: "admin",
                  action: "deleted_doctor",
                  entityType: "doctor",
                  entityId: id,
                  details: { name: doctor.name, clinicCode: doctor.clinic_code },
                });
              }}
              onDeleted={() => router.push("/dashboard/doctors")}
            />
          )}
          </div>
        </div>
        ) : (
        <div>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Edit Doctor Info</h3>
          <p style={{ fontSize: 11, color: theme.gray, marginTop: -8, marginBottom: 16 }}>Admin only.</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={editLabel}>Name</label>
              <input style={editInp} value={infoDraft.name} onChange={(e) => setInfoDraft({ ...infoDraft, name: e.target.value })} />
            </div>
            <div>
              <label style={editLabel}>Clinic Code</label>
              <input style={editInp} value={infoDraft.clinic_code} onChange={(e) => setInfoDraft({ ...infoDraft, clinic_code: e.target.value })} />
            </div>
            <div>
              <label style={editLabel}>Clinic Name</label>
              <input style={editInp} value={infoDraft.clinic_name} onChange={(e) => setInfoDraft({ ...infoDraft, clinic_name: e.target.value })} />
            </div>
            <div>
              <label style={editLabel}>Branch</label>
              <select style={editInp} value={infoDraft.branch_id} onChange={(e) => setInfoDraft({ ...infoDraft, branch_id: e.target.value })}>
                <option value="">None</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={editLabel}>Phone</label>
              <input style={editInp} value={infoDraft.phone} onChange={(e) => setInfoDraft({ ...infoDraft, phone: e.target.value })} placeholder="+20 1X XXX XXXX" />
            </div>
            <div>
              <label style={editLabel}>Phone 2</label>
              <input style={editInp} value={infoDraft.phone_2} onChange={(e) => setInfoDraft({ ...infoDraft, phone_2: e.target.value })} placeholder="+20 1X XXX XXXX" />
            </div>
            <div>
              <label style={editLabel}>Email</label>
              <input style={editInp} value={infoDraft.email} onChange={(e) => setInfoDraft({ ...infoDraft, email: e.target.value })} />
            </div>
            <div>
              <label style={editLabel}>Discount %</label>
              <input style={editInp} type="number" value={infoDraft.discount_pct} onChange={(e) => setInfoDraft({ ...infoDraft, discount_pct: e.target.value })} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={editLabel}>Special Note (auto-added to new visit notes for this doctor)</label>
              <input style={editInp} value={infoDraft.special_note} onChange={(e) => setInfoDraft({ ...infoDraft, special_note: e.target.value })} />
            </div>
          </div>
          {infoError && <p style={{ color: "#ba1a1a", fontSize: 13, marginTop: 8 }}>{infoError}</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button onClick={() => setEditingInfo(false)} style={{ padding: "10px 18px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontWeight: 600, cursor: "pointer" }}>
              Cancel
            </button>
            <button onClick={handleSaveInfo} disabled={savingInfo} style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
              {savingInfo ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
        )}
      </div>

      <PortalAccessCard
        loginAs={{ type: "doctor", id, name: doctor.name }}
        hasAccount={!!doctor.username}
        username={doctor.username}
        defaultUsername={(doctor.phone || "").replace(/\D/g, "")}
        onGenerate={async (username) => {
          const unique = await resolveUniqueUsername(supabase, "doctors", username, { excludeId: id });
          const { data } = await supabase.rpc("create_doctor_credentials", { p_doctor_id: id, p_username: unique });
          setDoctor((d) => ({ ...d, username: unique }));
          return data;
        }}
        buildWhatsAppLink={(username, password) =>
          doctorPortalWhatsAppLink({
            mobile: doctor.phone,
            doctorName: doctor.name,
            portalUrl: `${window.location.origin.replace("/dashboard", "")}/portal`,
            username,
            password,
          })
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 20 }}>
        <StatCard label="Total Referred" value={visits.length} />
        <StatCard label="This Month" value={thisMonth} />
        <StatCard label="Pending Payments" value={pending} />
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Referred Patients</h3>
        {visits.length === 0 && <p style={{ color: theme.gray, fontSize: 14 }}>No referrals yet.</p>}
        {visits.map((v) => (
          <div key={v.id} style={{ borderBottom: "1px solid #f0f0f0", padding: "10px 0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 600, color: theme.navy }}>{v.patients?.name}</div>
              <div style={{ fontSize: 12, color: theme.gray }}>{(v.scan_types || []).join(", ")}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ textAlign: "right", fontSize: 12, color: theme.gray }}>
                <div style={{ fontWeight: 700, color: theme.navy }}>{formatVisitDate(v.exam_date)}</div>
                <div>{v.payment_status}</div>
              </div>
              <WhatsAppDropdown
                buttonStyle={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                options={[
                  {
                    label: "Greeting",
                    onClick: async () => {
                      const baseUsername = doctor.username || (doctor.phone || "").replace(/\D/g, "");
                      const username = doctor.username
                        ? baseUsername
                        : await resolveUniqueUsername(supabase, "doctors", baseUsername, { excludeId: doctor.id });
                      const { data: pwd } = await supabase.rpc("create_doctor_credentials", { p_doctor_id: doctor.id, p_username: username });
                      const portalUrl = `${window.location.origin.replace("/dashboard", "")}/portal`;
                      window.open(doctorPortalWhatsAppLink({ mobile: doctor.phone, doctorName: doctor.name, portalUrl, username, password: pwd }), "_blank");
                    },
                  },
                  {
                    label: "Report",
                    onClick: () => window.open(doctorReportWhatsAppLink({ mobile: doctor.phone, doctorName: doctor.name, patientName: v.patients?.name, scanTypes: (v.scan_types || []).join(", "), examDate: v.exam_date }), "_blank"),
                  },
                  {
                    label: "Raw Data",
                    onClick: () => window.open(doctorRawDataWhatsAppLink({ mobile: doctor.phone, doctorName: doctor.name, patientName: v.patients?.name, scanTypes: (v.scan_types || []).join(", "), examDate: v.exam_date }), "_blank"),
                  },
                  { label: "Direct (empty)", onClick: () => window.open(directWhatsAppLink(doctor.phone), "_blank") },
                ]}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={{ background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
      <div style={{ fontSize: 12, color: theme.gray, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: theme.navy }}>{value}</div>
    </div>
  );
}
const editLabel = { display: "block", fontSize: 11, color: "#48464E", fontWeight: 600, marginBottom: 4 };
const editInp = { width: "100%", padding: "9px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, boxSizing: "border-box" };
