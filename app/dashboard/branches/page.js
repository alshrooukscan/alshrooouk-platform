"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { theme } from "../../../lib/theme";
import { usePermissions } from "../../../lib/usePermissions";
import DocumentsUploader from "../../../components/DocumentsUploader";

export default function BranchesPage() {
  const { profile } = usePermissions();
  const [branches, setBranches] = useState([]);
  const [newBranch, setNewBranch] = useState("");
  const [expandedBranch, setExpandedBranch] = useState(null);
  const [branchDraft, setBranchDraft] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("branches").select("*").order("created_at");
    setBranches(data || []);
    setLoading(false);
  }

  async function toggleBranch(branch) {
    await supabase.from("branches").update({ is_active: !branch.is_active }).eq("id", branch.id);
    load();
  }

  function openBranchEditor(branch) {
    setExpandedBranch(branch.id === expandedBranch ? null : branch.id);
    setBranchDraft({
      drive_folder_id: branch.drive_folder_id || "",
      latitude: branch.latitude ?? "",
      longitude: branch.longitude ?? "",
      geofence_radius_m: branch.geofence_radius_m ?? 150,
    });
  }

  async function saveBranchDetails(branch) {
    await supabase
      .from("branches")
      .update({
        drive_folder_id: branchDraft.drive_folder_id || null,
        latitude: branchDraft.latitude === "" ? null : Number(branchDraft.latitude),
        longitude: branchDraft.longitude === "" ? null : Number(branchDraft.longitude),
        geofence_radius_m: branchDraft.geofence_radius_m === "" ? 150 : Number(branchDraft.geofence_radius_m),
      })
      .eq("id", branch.id);
    setExpandedBranch(null);
    load();
  }

  async function addBranch() {
    if (!newBranch) return;
    await supabase.from("branches").insert({ name: newBranch, is_active: true });
    setNewBranch("");
    load();
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: theme.gray, margin: "0 0 4px" }}>Scan Center Management</p>
      <h1 style={{ color: theme.navy, margin: "0 0 4px" }}>Branch Management</h1>
      <p style={{ color: theme.gray, margin: "0 0 24px" }}>Add branches, mark them active or inactive, and set each one's Drive folder and location.</p>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        {!loading && branches.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>No branches yet.</p>}
        {branches.map((b) => (
          <div key={b.id} style={{ borderBottom: "1px solid #f0f0f0", paddingBottom: 14, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: theme.navy, fontWeight: 700, fontSize: 15 }}>{b.name}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <button onClick={() => openBranchEditor(b)} style={{ fontSize: 12, color: theme.gold, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
                  {expandedBranch === b.id ? "Close" : "Drive & Location"}
                </button>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  {b.is_active ? "Active" : "Inactive"}
                  <input type="checkbox" checked={b.is_active} onChange={() => toggleBranch(b)} />
                </label>
              </div>
            </div>
            {expandedBranch === b.id && (
              <div style={{ marginTop: 10, padding: 12, background: "#faf9fb", borderRadius: 8, display: "grid", gap: 8 }}>
                <div>
                  <span style={{ fontSize: 11, color: theme.gray }}>Drive folder ID for this branch (root for anything filed under it)</span>
                  <input
                    style={inp}
                    value={branchDraft.drive_folder_id}
                    onChange={(e) => setBranchDraft({ ...branchDraft, drive_folder_id: e.target.value })}
                    placeholder="Drive folder ID"
                  />
                  <p style={{ fontSize: 11, color: theme.gray, margin: "4px 0 0" }}>
                    Share this folder with elsherouk-drive-uploader@elsherouk-drive-integration.iam.gserviceaccount.com
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 11, color: theme.gray }}>Latitude</span>
                    <input style={inp} value={branchDraft.latitude} onChange={(e) => setBranchDraft({ ...branchDraft, latitude: e.target.value })} placeholder="30.0444" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 11, color: theme.gray }}>Longitude</span>
                    <input style={inp} value={branchDraft.longitude} onChange={(e) => setBranchDraft({ ...branchDraft, longitude: e.target.value })} placeholder="31.2357" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 11, color: theme.gray }}>Radius (m)</span>
                    <input style={inp} value={branchDraft.geofence_radius_m} onChange={(e) => setBranchDraft({ ...branchDraft, geofence_radius_m: e.target.value })} placeholder="150" />
                  </div>
                </div>
                <button onClick={() => saveBranchDetails(b)} style={{ ...smallPrimary, alignSelf: "flex-start" }}>Save</button>
                <div style={{ marginTop: 6 }}>
                  <DocumentsUploader
                    entityType="branch"
                    entityId={b.id}
                    profile={profile}
                    disabledReason={!b.drive_folder_id ? "Set this branch's Drive folder above first, then documents can be uploaded here." : null}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <input style={{ ...inp, marginBottom: 0 }} value={newBranch} onChange={(e) => setNewBranch(e.target.value)} placeholder="New branch name" />
          <button onClick={addBranch} style={smallPrimary}>+ Add Branch</button>
        </div>
      </div>
    </div>
  );
}

const inp = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box", marginBottom: 16 };
const smallPrimary = { padding: "0 16px", height: 40, borderRadius: 8, border: "none", background: "#27214D", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 13 };
