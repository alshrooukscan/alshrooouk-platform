"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { theme } from "../../../lib/theme";
import { usePermissions } from "../../../lib/usePermissions";
import { logActivity } from "../../../lib/activityLog";
import { vendorWhatsAppLink } from "../../../lib/whatsapp";

const STATUS_LABEL = { assigned: "Assigned", in_progress: "In Progress", done: "Done" };
const STATUS_COLOR = {
  assigned: { bg: "#fdecea", fg: "#ba1a1a" },
  in_progress: { bg: "#fff8e1", fg: "#a97c00" },
  done: { bg: "#e8f5e9", fg: "#2e7d32" },
};

export default function VendorsPage() {
  const { profile } = usePermissions();
  const [requests, setRequests] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data: r } = await supabase
      .from("vendor_requests")
      .select("*, vendors(id, name, mobile), employees(name)")
      .order("created_at", { ascending: false });
    const { data: v } = await supabase.from("vendors").select("*").order("name");
    const { data: emp } = await supabase.from("employees").select("id, name").eq("is_active", true).order("name");
    setRequests(r || []);
    setVendors(v || []);
    setEmployees(emp || []);
    setLoading(false);
  }

  const filtered = statusFilter ? requests.filter((r) => r.status === statusFilter) : requests;

  async function updateStatus(request, newStatus) {
    setBusyId(request.id);
    const update = { status: newStatus };
    if (newStatus === "done") {
      update.completed_at = new Date().toISOString();
      update.reported_back_at = new Date().toISOString();
    }
    await supabase.from("vendor_requests").update(update).eq("id", request.id);
    logActivity({
      actorId: profile?.id,
      actorName: profile?.name,
      actorType: profile?.role === "admin" ? "admin" : "employee",
      action: `vendor_request_${newStatus}`,
      entityType: "vendor_request",
      entityId: request.id,
      details: { vendorName: request.vendors?.name, description: request.description },
    });
    await load();
    setBusyId(null);

    if (newStatus === "done" && request.vendors?.mobile) {
      const link = vendorWhatsAppLink({
        mobile: request.vendors.mobile,
        vendorName: request.vendors.name,
        description: request.description,
        completedDate: new Date().toLocaleDateString(),
      });
      window.open(link, "_blank");
    } else if (newStatus === "done" && !request.vendors?.mobile) {
      alert("This vendor has no mobile number on file, no WhatsApp message could be opened.");
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <p style={{ color: theme.gold, fontSize: 12, fontWeight: 700, letterSpacing: 1, margin: 0 }}>EXTERNAL VENDOR REQUESTS</p>
          <h1 style={{ color: theme.navy, margin: "4px 0" }}>External Reports</h1>
          <p style={{ color: theme.gray, margin: 0 }}>Incoming vendor requests, assigned internally, reported back on completion.</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          style={{ padding: "10px 20px", borderRadius: 8, background: `linear-gradient(135deg, ${theme.gold}, ${theme.goldLight})`, color: theme.navy, fontWeight: 700, border: "none", cursor: "pointer", fontSize: 14 }}
        >
          + Log Vendor Request
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {["", "assigned", "in_progress", "done"].map((s) => (
          <button
            key={s || "all"}
            onClick={() => setStatusFilter(s)}
            style={{ padding: "6px 14px", borderRadius: 999, border: `1px solid ${statusFilter === s ? theme.gold : "#ddd"}`, background: statusFilter === s ? theme.goldLight : "#fff", color: theme.navy, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >
            {s === "" ? "All" : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: theme.gray }}>Loading...</p>}
      {!loading && filtered.length === 0 && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, textAlign: "center", color: theme.gray }}>No requests yet.</div>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        {filtered.map((r) => {
          const c = STATUS_COLOR[r.status];
          return (
            <div key={r.id} style={{ background: "#fff", borderRadius: 12, padding: 16, display: "flex", alignItems: "center", gap: 16, boxShadow: "0 2px 10px rgba(39,33,77,0.05)" }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: c.bg, color: c.fg, minWidth: 90, textAlign: "center" }}>
                {STATUS_LABEL[r.status]}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: theme.navy, fontSize: 14 }}>{r.vendors?.name || "Unknown vendor"}</div>
                <div style={{ fontSize: 13, color: theme.gray }}>{r.description}</div>
                <div style={{ fontSize: 11, color: theme.gray, marginTop: 2 }}>
                  {r.requested_date} &middot; Assigned to {r.employees?.name || "Unassigned"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {r.status === "assigned" && (
                  <button onClick={() => updateStatus(r, "in_progress")} disabled={busyId === r.id} style={smallBtn}>Start</button>
                )}
                {r.status !== "done" && (
                  <button onClick={() => updateStatus(r, "done")} disabled={busyId === r.id} style={{ ...smallBtn, background: "#2e7d32", color: "#fff", border: "none" }}>
                    Mark Done &amp; WhatsApp
                  </button>
                )}
                {r.status === "done" && r.vendors?.mobile && (
                  <button
                    onClick={() => window.open(vendorWhatsAppLink({ mobile: r.vendors.mobile, vendorName: r.vendors.name, description: r.description, completedDate: new Date(r.completed_at).toLocaleDateString() }), "_blank")}
                    style={smallBtn}
                  >
                    Resend WhatsApp
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showForm && (
        <RequestForm
          vendors={vendors}
          employees={employees}
          profile={profile}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function RequestForm({ vendors, employees, profile, onClose, onSaved }) {
  const [mode, setMode] = useState("existing");
  const [vendorId, setVendorId] = useState("");
  const [newVendorName, setNewVendorName] = useState("");
  const [newVendorMobile, setNewVendorMobile] = useState("");
  const [description, setDescription] = useState("");
  const [assignedEmployeeId, setAssignedEmployeeId] = useState("");
  const [requestedDate, setRequestedDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!description) {
      setError("Describe the request");
      return;
    }
    setSaving(true);

    let finalVendorId = vendorId;
    if (mode === "new") {
      if (!newVendorName) {
        setError("Vendor name is required");
        setSaving(false);
        return;
      }
      const { data: newVendor, error: vErr } = await supabase.from("vendors").insert({ name: newVendorName, mobile: newVendorMobile || null }).select("id").single();
      if (vErr) {
        setError(vErr.message);
        setSaving(false);
        return;
      }
      finalVendorId = newVendor.id;
    }
    if (!finalVendorId) {
      setError("Pick or create a vendor");
      setSaving(false);
      return;
    }

    const { data, error: insertError } = await supabase
      .from("vendor_requests")
      .insert({
        vendor_id: finalVendorId,
        description,
        assigned_employee_id: assignedEmployeeId || null,
        requested_date: requestedDate,
        created_by_id: profile?.id || null,
        created_by_name: profile?.name || null,
      })
      .select("id")
      .single();
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }

    logActivity({
      actorId: profile?.id,
      actorName: profile?.name,
      actorType: profile?.role === "admin" ? "admin" : "employee",
      action: "logged_vendor_request",
      entityType: "vendor_request",
      entityId: data.id,
      details: { description },
    });
    onSaved();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,11,56,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <form onSubmit={handleSubmit} style={{ background: "#fff", borderRadius: 16, padding: 28, width: 440, maxWidth: "90vw", maxHeight: "88vh", overflowY: "auto" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Log Vendor Request</h3>

        <div style={{ display: "flex", gap: 16, marginBottom: 10 }}>
          <label style={{ fontSize: 13, color: theme.navy, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} /> Existing vendor
          </label>
          <label style={{ fontSize: 13, color: theme.navy, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} /> New vendor
          </label>
        </div>

        {mode === "existing" ? (
          <>
            <FieldLabel>Vendor</FieldLabel>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} style={inp}>
              <option value="">Select vendor...</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </>
        ) : (
          <>
            <FieldLabel>Vendor Name</FieldLabel>
            <input value={newVendorName} onChange={(e) => setNewVendorName(e.target.value)} style={inp} />
            <FieldLabel>Mobile Number</FieldLabel>
            <input value={newVendorMobile} onChange={(e) => setNewVendorMobile(e.target.value)} style={inp} placeholder="+20..." />
          </>
        )}

        <FieldLabel>What did they request?</FieldLabel>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ ...inp, minHeight: 70, resize: "vertical" }} />

        <FieldLabel>Assign to</FieldLabel>
        <select value={assignedEmployeeId} onChange={(e) => setAssignedEmployeeId(e.target.value)} style={inp}>
          <option value="">Unassigned</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>{emp.name}</option>
          ))}
        </select>

        <FieldLabel>Date requested</FieldLabel>
        <input type="date" value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} style={inp} />

        {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontWeight: 600, cursor: "pointer" }}>
            Cancel
          </button>
          <button type="submit" disabled={saving} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", background: theme.gold, color: theme.navy, fontWeight: 700, cursor: "pointer" }}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

function FieldLabel({ children }) {
  return <label style={{ display: "block", fontSize: 11, color: theme.gray, fontWeight: 600, marginTop: 10, marginBottom: 4 }}>{children}</label>;
}

const inp = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box" };
const smallBtn = { padding: "8px 14px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontWeight: 600, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" };
