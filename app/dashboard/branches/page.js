"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { theme } from "../../../lib/theme";
import { usePermissions } from "../../../lib/usePermissions";
import DocumentsUploader from "../../../components/DocumentsUploader";

const CATEGORY_LABELS = { "2d": "2D", "3d": "3D", bundle: "Bundle", misc: "Misc" };
const CATEGORY_ORDER = ["2d", "3d", "bundle", "misc"];

export default function BranchesPage() {
  const { profile, isAdmin } = usePermissions();
  const [branches, setBranches] = useState([]);
  const [newBranch, setNewBranch] = useState("");
  const [expandedBranch, setExpandedBranch] = useState(null);
  const [branchDraft, setBranchDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [examTypes, setExamTypes] = useState([]);
  const [editingExamId, setEditingExamId] = useState(null);
  const [examDraft, setExamDraft] = useState({});
  const [newExam, setNewExam] = useState({ name: "", price: "", category: "misc", requires_report: true });
  const [addingExam, setAddingExam] = useState(false);

  useEffect(() => {
    load();
    loadExamTypes();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("branches").select("*").order("created_at");
    setBranches(data || []);
    setLoading(false);
  }

  async function loadExamTypes() {
    const { data } = await supabase.from("exam_types").select("*").order("category").order("name");
    setExamTypes(data || []);
  }

  function startEditExam(exam) {
    setEditingExamId(exam.id);
    setExamDraft({ name: exam.name, price: exam.price ?? "", requires_report: exam.requires_report });
  }

  async function saveExam(exam) {
    await supabase
      .from("exam_types")
      .update({
        name: examDraft.name,
        price: examDraft.price === "" ? null : Number(examDraft.price),
        requires_report: examDraft.requires_report,
      })
      .eq("id", exam.id);
    setEditingExamId(null);
    loadExamTypes();
  }

  async function toggleExamActive(exam) {
    await supabase.from("exam_types").update({ is_active: !exam.is_active }).eq("id", exam.id);
    loadExamTypes();
  }

  async function addExamType() {
    if (!newExam.name.trim()) return;
    setAddingExam(true);
    await supabase.from("exam_types").insert({
      name: newExam.name.trim(),
      price: newExam.price === "" ? null : Number(newExam.price),
      category: newExam.category,
      requires_report: newExam.requires_report,
    });
    setNewExam({ name: "", price: "", category: "misc", requires_report: true });
    setAddingExam(false);
    loadExamTypes();
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
                  {expandedBranch === b.id ? "Close" : "Show Details"}
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

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)", marginTop: 20 }}>
        <h3 style={{ color: theme.navy, marginTop: 0, marginBottom: 4 }}>Scan Types &amp; Pricing</h3>
        <p style={{ fontSize: 12, color: theme.gray, marginTop: 0, marginBottom: 16 }}>
          Every scan type available when adding a new patient scan, and whether it shows in the pending-reports tracking once that's live.
          {!isAdmin && " Price changes require an admin."}
        </p>

        {CATEGORY_ORDER.map((cat) => {
          const items = examTypes.filter((e) => (e.category || "misc") === cat);
          if (items.length === 0) return null;
          return (
            <div key={cat} style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: theme.gray, textTransform: "uppercase", marginBottom: 8 }}>
                {CATEGORY_LABELS[cat]}
              </div>
              {items.map((exam) => (
                <div key={exam.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid #f5f5f5", opacity: exam.is_active ? 1 : 0.5 }}>
                  {editingExamId === exam.id ? (
                    <>
                      <input
                        style={{ ...smallInp, flex: 1 }}
                        value={examDraft.name}
                        onChange={(e) => setExamDraft({ ...examDraft, name: e.target.value })}
                      />
                      <input
                        style={{ ...smallInp, width: 90 }}
                        value={examDraft.price}
                        onChange={(e) => setExamDraft({ ...examDraft, price: e.target.value })}
                        placeholder="Price"
                        disabled={!isAdmin}
                        title={!isAdmin ? "Only an admin can change the price" : ""}
                      />
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: theme.gray, whiteSpace: "nowrap" }}>
                        <input type="checkbox" checked={examDraft.requires_report} onChange={(e) => setExamDraft({ ...examDraft, requires_report: e.target.checked })} />
                        Requires Report
                      </label>
                      <button onClick={() => saveExam(exam)} style={{ ...smallPrimary, height: 32, padding: "0 12px", fontSize: 12 }}>Save</button>
                      <button onClick={() => setEditingExamId(null)} style={{ fontSize: 12, color: theme.gray, background: "none", border: "none", cursor: "pointer" }}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <span style={{ flex: 1, fontSize: 13, color: theme.navy, fontWeight: 600 }}>{exam.name}</span>
                      <span style={{ fontSize: 13, color: theme.navy, width: 90 }}>{exam.price != null ? `${Number(exam.price).toFixed(2)} EGP` : "—"}</span>
                      <span style={{ fontSize: 11, color: exam.requires_report ? theme.navy : theme.gray, minWidth: 100 }}>
                        {exam.requires_report ? "Requires report" : "No report needed"}
                      </span>
                      <button onClick={() => startEditExam(exam)} style={{ fontSize: 12, color: theme.gold, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>Edit</button>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: theme.gray }}>
                        {exam.is_active ? "Active" : "Inactive"}
                        <input type="checkbox" checked={exam.is_active} onChange={() => toggleExamActive(exam)} />
                      </label>
                    </>
                  )}
                </div>
              ))}
            </div>
          );
        })}

        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
          <input style={{ ...smallInp, flex: 1, minWidth: 160 }} value={newExam.name} onChange={(e) => setNewExam({ ...newExam, name: e.target.value })} placeholder="New scan type name" />
          <input
            style={{ ...smallInp, width: 90 }}
            value={newExam.price}
            onChange={(e) => setNewExam({ ...newExam, price: e.target.value })}
            placeholder="Price"
            disabled={!isAdmin}
            title={!isAdmin ? "Only an admin can set the price" : ""}
          />
          <select style={{ ...smallInp, width: 100 }} value={newExam.category} onChange={(e) => setNewExam({ ...newExam, category: e.target.value })}>
            {CATEGORY_ORDER.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: theme.gray, whiteSpace: "nowrap" }}>
            <input type="checkbox" checked={newExam.requires_report} onChange={(e) => setNewExam({ ...newExam, requires_report: e.target.checked })} />
            Requires Report
          </label>
          <button onClick={addExamType} disabled={addingExam} style={smallPrimary}>+ Add Scan Type</button>
        </div>
      </div>
    </div>
  );
}

const inp = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box", marginBottom: 16 };
const smallPrimary = { padding: "0 16px", height: 40, borderRadius: 8, border: "none", background: "#27214D", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 13 };
const smallInp = { padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, boxSizing: "border-box" };
