"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import { resolveUniqueUsername } from "../../../../lib/uniqueUsername";
import LoginAsButton from "../../../../components/LoginAsButton";
import WhatsAppDropdown from "../../../../components/WhatsAppDropdown";
import PortalAccessCard from "../../../../components/PortalAccessCard";
import { APP_URL } from "../../../../lib/appUrl";
import {
  clientPortalWhatsAppLink,
  clientPortalLinkWhatsAppLink,
  directWhatsAppLink,
} from "../../../../lib/whatsapp";

// A client is a medical centre that sends scans here and shows the results to
// its own patients. Until now the only thing that could be done with one was
// create it, so a changed phone number or a forgotten password had no answer
// on this screen at all. This page gives a client the same handling a doctor
// and a patient already have.
export default function ClientDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", contact_phone: "", contact_email: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => { load(); }, [id]);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("clients").select("*").eq("id", id).single();
    setClient(data || null);
    if (data) setForm({ name: data.name || "", contact_phone: data.contact_phone || "", contact_email: data.contact_email || "" });
    setLoading(false);
  }

  async function saveEdits() {
    setSaving(true); setError("");
    if (!form.name.trim()) { setError("A client needs a name."); setSaving(false); return; }
    const { error: e } = await supabase
      .from("clients")
      .update({ name: form.name.trim(), contact_phone: form.contact_phone.trim() || null, contact_email: form.contact_email.trim() || null })
      .eq("id", id);
    setSaving(false);
    if (e) { setError(e.message); return; }
    setEditing(false); setNotice("Saved.");
    load();
  }

  // Creating an account and resetting a password are different decisions, so
  // they are different buttons calling different functions. Resending a portal
  // link does neither, and never disturbs the password in use.
  // The logo replaces our mark on this client's own portal. Their patients see
  // that page, and it is the client's relationship with them, not ours.
  async function uploadLogo(file) {
    if (!file) return;
    setUploading(true); setError("");
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${client.id}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("client-logos").upload(path, file, { upsert: true });
    if (upErr) { setError(upErr.message); setUploading(false); return; }
    const { data: pub } = supabase.storage.from("client-logos").getPublicUrl(path);
    await supabase.from("clients").update({ logo_url: pub.publicUrl }).eq("id", client.id);
    setUploading(false); setNotice("Logo updated. It appears on their portal.");
    load();
  }

  if (loading) return <p style={{ color: theme.gray }}>Loading...</p>;
  if (!client) return <p style={{ color: theme.gray }}>This client could not be found.</p>;

  const portalUrl = `${APP_URL}/portal`;

  return (
    <div>
      <p style={{ fontSize: 12, color: theme.gray, margin: "0 0 4px" }}>
        <Link href="/dashboard" style={{ color: theme.gray }}>Dashboard</Link> &gt;{" "}
        <Link href="/dashboard/clients" style={{ color: theme.gray }}>Clients</Link> &gt; {client.name}
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18, flexWrap: "wrap" }}>
        {client.logo_url ? (
          <img src={client.logo_url} alt="" style={{ height: 52, width: 52, objectFit: "contain", borderRadius: 10, border: "1px solid #eee", background: "#fff" }} />
        ) : (
          <div style={{ height: 52, width: 52, borderRadius: 10, border: "1px dashed #ddd", display: "flex", alignItems: "center", justifyContent: "center", color: theme.gray, fontSize: 10, textAlign: "center" }}>
            no logo
          </div>
        )}
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 style={{ color: theme.navy, margin: 0 }}>{client.name}</h1>
          <p style={{ color: theme.gray, margin: "2px 0 0", fontSize: 13 }}>
            {client.contact_phone || "no phone"}
            {" · "}Username: {client.username || "no login yet"}
          </p>
        </div>
        {client.username && <LoginAsButton type="client" id={client.id} name={client.name} size="small" />}
      </div>

      {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}
      {notice && <p style={{ color: "#1e7a3c", fontSize: 13 }}>{notice}</p>}

      <div style={{ background: "#fff", borderRadius: 16, padding: 22, boxShadow: "0 4px 20px rgba(39,33,77,0.06)", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ color: theme.navy, margin: 0, fontSize: 15 }}>Details</h3>
          {!editing && (
            <button onClick={() => setEditing(true)} style={btn("#fff", theme.navy, true)}>Edit</button>
          )}
        </div>

        {!editing ? (
          <div style={{ fontSize: 13, color: theme.navy, display: "grid", gap: 6 }}>
            <div><span style={{ color: theme.gray }}>Name: </span>{client.name}</div>
            <div><span style={{ color: theme.gray }}>Phone: </span>{client.contact_phone || "not recorded"}</div>
            <div><span style={{ color: theme.gray }}>Email: </span>{client.contact_email || "not recorded"}</div>
          </div>
        ) : (
          <div>
            <label style={lbl}>Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inp} />
            <label style={lbl}>Phone</label>
            <input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} style={inp} />
            <label style={lbl}>Email</label>
            <input value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} style={inp} />
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button onClick={saveEdits} disabled={saving} style={btn(theme.navy, "#fff")}>{saving ? "Saving..." : "Save"}</button>
              <button onClick={() => { setEditing(false); setError(""); }} style={btn("#fff", theme.navy, true)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 22, boxShadow: "0 4px 20px rgba(39,33,77,0.06)", marginBottom: 16 }}>
        <h3 style={{ color: theme.navy, margin: "0 0 4px", fontSize: 15 }}>Their logo</h3>
        <p style={{ color: theme.gray, fontSize: 12, margin: "0 0 12px" }}>
          Shown on this client&apos;s portal in place of ours. Their patients see that page, so it should carry their name, not ours.
        </p>
        <input type="file" accept="image/*" onChange={(e) => uploadLogo(e.target.files?.[0])} disabled={uploading} style={{ fontSize: 12 }} />
        {uploading && <span style={{ fontSize: 12, color: theme.gray, marginLeft: 8 }}>Uploading...</span>}
      </div>

      {/* The same card doctors use. It already distinguishes creating an
          account from resetting a password, confirms before resetting, and
          reveals the password once - so a client gets exactly the handling a
          doctor gets, rather than a second version of it that drifts. */}
      <PortalAccessCard
        loginAs={{ type: "client", id: client.id, name: client.name }}
        hasAccount={!!client.username}
        username={client.username}
        defaultUsername={(client.contact_phone || "").replace(/\D/g, "")}
        onGenerate={async (username) => {
          const unique = await resolveUniqueUsername(supabase, "clients", username, { excludeId: client.id });
          const { data } = await supabase.rpc("create_client_credentials", { p_client_id: client.id, p_username: unique });
          setClient((c) => ({ ...c, username: unique }));
          return data;
        }}
        buildWhatsAppLink={(username, password) =>
          clientPortalWhatsAppLink({
            mobile: client.contact_phone,
            clientName: client.name,
            portalUrl: `${APP_URL}/portal`,
            username,
            password,
          })
        }
      />

      {client.contact_phone && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 22, boxShadow: "0 4px 20px rgba(39,33,77,0.06)", marginTop: 16 }}>
          <h3 style={{ color: theme.navy, margin: "0 0 4px", fontSize: 15 }}>Message them</h3>
          <p style={{ color: theme.gray, fontSize: 12, margin: "0 0 12px" }}>
            Sending the portal link never changes their password. Use Reset above only when they have lost it.
          </p>
          <WhatsAppDropdown
            buttonStyle={btn("#fff", theme.navy, true)}
            options={[
              {
                label: "Portal link",
                onClick: () =>
                  window.open(
                    clientPortalLinkWhatsAppLink({
                      mobile: client.contact_phone,
                      clientName: client.name,
                      portalUrl: `${APP_URL}/portal`,
                      username: client.username || "not set yet",
                    }),
                    "_blank"
                  ),
              },
              { label: "Direct (empty)", onClick: () => window.open(directWhatsAppLink(client.contact_phone), "_blank") },
            ]}
          />
        </div>
      )}

    </div>
  );
}

function btn(bg, fg, bordered) {
  return { padding: "8px 16px", borderRadius: 8, border: bordered ? "1px solid #ddd" : "none", background: bg, color: fg, fontWeight: 700, fontSize: 12, cursor: "pointer" };
}
const lbl = { display: "block", fontSize: 11, color: "#48464E", fontWeight: 600, marginBottom: 4, marginTop: 10 };
const inp = { width: "100%", padding: "9px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, boxSizing: "border-box" };
