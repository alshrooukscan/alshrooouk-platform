"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import { formatPhone } from "../../../../lib/formatPhone";
import PortalAccessCard from "../../../../components/PortalAccessCard";
import { doctorPortalWhatsAppLink } from "../../../../lib/whatsapp";
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

  useEffect(() => {
    load();
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
      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginBottom: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ color: theme.navy, margin: 0 }}>{doctor.name}</h1>
          <p style={{ color: theme.gold, fontWeight: 600, margin: "4px 0" }}>{doctor.clinic_code} · {doctor.clinic_name}</p>
          <p style={{ color: theme.gray, margin: 0 }}>
            {formatPhone(doctor.phone)}
            {doctor.phone_2 && ` · ${formatPhone(doctor.phone_2)}`}
            {doctor.email ? ` · ${doctor.email}` : ""}
          </p>
        </div>
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

      <PortalAccessCard
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
          <div key={v.id} style={{ borderBottom: "1px solid #f0f0f0", padding: "10px 0", display: "flex", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 600, color: theme.navy }}>{v.patients?.name}</div>
              <div style={{ fontSize: 12, color: theme.gray }}>{(v.scan_types || []).join(", ")}</div>
            </div>
            <div style={{ textAlign: "right", fontSize: 12, color: theme.gray }}>
              <div>{v.exam_date}</div>
              <div>{v.payment_status}</div>
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
