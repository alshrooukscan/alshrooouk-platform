"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { theme } from "../../../lib/theme";
import { usePermissions } from "../../../lib/usePermissions";
import DocumentsUploader from "../../../components/DocumentsUploader";
import WorkforceCalendar from "../../../components/WorkforceCalendar";
import { useAutoRefresh } from "../../../lib/useAutoRefresh";

const CATEGORY_LABELS = {
  "2d": "2D",
  "3d": "3D",
  bundle: "Bundle",
  misc: "Misc",
};
const CATEGORY_ORDER = ["2d", "3d", "bundle", "misc"];

export default function BranchesPage() {
  const { profile, isAdmin } = usePermissions();
  useAutoRefresh(["branches", "exam_types"], () => {
    load();
  });
  const [branches, setBranches] = useState([]);
  const [newBranch, setNewBranch] = useState("");
  const [expandedBranch, setExpandedBranch] = useState(null);
  const [branchDraft, setBranchDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [examTypes, setExamTypes] = useState([]);
  const [scheduleBranchId, setScheduleBranchId] = useState("");
  const [editingExamId, setEditingExamId] = useState(null);
  const [examDraft, setExamDraft] = useState({});
  const [newExam, setNewExam] = useState({
    name: "",
    price: "",
    category: "misc",
    requires_report: true,
  });
  const [addingExam, setAddingExam] = useState(false);
  const [stepsFor, setStepsFor] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("branches")
      .select("*")
      .order("created_at");
    setBranches(data || []);
    setLoading(false);
  }

  // Scan types are branch-owned - each branch keeps its own standalone list
  // and price, so this always loads for one specific branch, never globally.
  async function loadExamTypes(branchId) {
    const { data } = await supabase
      .from("exam_types")
      .select("*")
      .eq("branch_id", branchId)
      .order("category")
      .order("name");
    setExamTypes(data || []);
  }

  function startEditExam(exam) {
    setEditingExamId(exam.id);
    setExamDraft({
      name: exam.name,
      price: exam.price ?? "",
      requires_report: exam.requires_report,
    });
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
    loadExamTypes(exam.branch_id);
  }

  async function toggleExamActive(exam) {
    await supabase
      .from("exam_types")
      .update({ is_active: !exam.is_active })
      .eq("id", exam.id);
    loadExamTypes(exam.branch_id);
  }

  async function addExamType(branchId) {
    if (!newExam.name.trim()) return;
    setAddingExam(true);
    await supabase.from("exam_types").insert({
      name: newExam.name.trim(),
      price: newExam.price === "" ? null : Number(newExam.price),
      category: newExam.category,
      requires_report: newExam.requires_report,
      branch_id: branchId,
    });
    setNewExam({
      name: "",
      price: "",
      category: "misc",
      requires_report: true,
    });
    setAddingExam(false);
    loadExamTypes(branchId);
  }

  async function toggleBranch(branch) {
    await supabase
      .from("branches")
      .update({ is_active: !branch.is_active })
      .eq("id", branch.id);
    load();
  }

  function openBranchEditor(branch) {
    const opening = branch.id !== expandedBranch;
    setExpandedBranch(opening ? branch.id : null);
    setBranchDraft({
      drive_folder_id: branch.drive_folder_id || "",
      latitude: branch.latitude ?? "",
      longitude: branch.longitude ?? "",
      geofence_radius_m: branch.geofence_radius_m ?? 150,
    });
    if (opening) {
      loadExamTypes(branch.id);
    } else {
      setExamTypes([]);
    }
  }

  async function saveBranchDetails(branch) {
    await supabase
      .from("branches")
      .update({
        drive_folder_id: branchDraft.drive_folder_id || null,
        latitude:
          branchDraft.latitude === "" ? null : Number(branchDraft.latitude),
        longitude:
          branchDraft.longitude === "" ? null : Number(branchDraft.longitude),
        geofence_radius_m:
          branchDraft.geofence_radius_m === ""
            ? 150
            : Number(branchDraft.geofence_radius_m),
      })
      .eq("id", branch.id);
    setExpandedBranch(null);
    load();
  }

  async function addBranch() {
    if (!newBranch) return;
    await supabase
      .from("branches")
      .insert({ name: newBranch, is_active: true });
    setNewBranch("");
    load();
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: theme.gray, margin: "0 0 4px" }}>
        Scan Center Management
      </p>
      <h1 style={{ color: theme.navy, margin: "0 0 4px" }}>
        Branch Management
      </h1>
      <p style={{ color: theme.gray, margin: "0 0 24px" }}>
        Add branches, mark them active or inactive, and set each one's Drive
        folder and location.
      </p>

      {isAdmin && (
        <div
          style={{
            background: "#fff",
            borderRadius: 16,
            padding: 24,
            boxShadow: "0 4px 20px rgba(39,33,77,0.06)",
            marginBottom: 24,
          }}
        >
          <h3 style={{ color: theme.navy, marginTop: 0 }}>
            Workforce Schedule
          </h3>
          <p style={{ color: theme.gray, fontSize: 13, margin: "0 0 16px" }}>
            Weekly shift times per branch. Select one or more employees and one
            or more days, then apply a time or mark a day off.
          </p>
          <div style={{ marginBottom: 16 }}>
            <select
              value={scheduleBranchId}
              onChange={(e) => setScheduleBranchId(e.target.value)}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #ddd",
                fontSize: 13,
                minWidth: 220,
              }}
            >
              <option value="">Select a branch...</option>
              {branches
                .filter((b) => b.is_active)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </div>
          <WorkforceCalendar branchId={scheduleBranchId} />
        </div>
      )}

      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          padding: 24,
          boxShadow: "0 4px 20px rgba(39,33,77,0.06)",
        }}
      >
        {!loading && branches.length === 0 && (
          <p style={{ color: theme.gray, fontSize: 13 }}>No branches yet.</p>
        )}
        {branches.map((b) => (
          <div
            key={b.id}
            style={{
              borderBottom: "1px solid #f0f0f0",
              paddingBottom: 14,
              marginBottom: 14,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span
                style={{ color: theme.navy, fontWeight: 700, fontSize: 15 }}
              >
                {b.name}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <button
                  onClick={() => openBranchEditor(b)}
                  style={{
                    fontSize: 12,
                    color: theme.gold,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  {expandedBranch === b.id ? "Close" : "Show Details"}
                </button>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                  }}
                >
                  {b.is_active ? "Active" : "Inactive"}
                  <input
                    type="checkbox"
                    checked={b.is_active}
                    onChange={() => toggleBranch(b)}
                  />
                </label>
              </div>
            </div>
            {expandedBranch === b.id && (
              <div
                style={{
                  marginTop: 10,
                  padding: 12,
                  background: "#faf9fb",
                  borderRadius: 8,
                  display: "grid",
                  gap: 8,
                }}
              >
                <div>
                  <span style={{ fontSize: 11, color: theme.gray }}>
                    Drive folder ID for this branch (root for anything filed
                    under it)
                  </span>
                  <input
                    style={inp}
                    value={branchDraft.drive_folder_id}
                    onChange={(e) =>
                      setBranchDraft({
                        ...branchDraft,
                        drive_folder_id: e.target.value,
                      })
                    }
                    placeholder="Drive folder ID"
                  />
                  <p
                    style={{
                      fontSize: 11,
                      color: theme.gray,
                      margin: "4px 0 0",
                    }}
                  >
                    Share this folder with
                    elsherouk-drive-uploader@elsherouk-drive-integration.iam.gserviceaccount.com
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 11, color: theme.gray }}>
                      Latitude
                    </span>
                    <input
                      style={inp}
                      value={branchDraft.latitude}
                      onChange={(e) =>
                        setBranchDraft({
                          ...branchDraft,
                          latitude: e.target.value,
                        })
                      }
                      placeholder="30.0444"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 11, color: theme.gray }}>
                      Longitude
                    </span>
                    <input
                      style={inp}
                      value={branchDraft.longitude}
                      onChange={(e) =>
                        setBranchDraft({
                          ...branchDraft,
                          longitude: e.target.value,
                        })
                      }
                      placeholder="31.2357"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 11, color: theme.gray }}>
                      Radius (m)
                    </span>
                    <input
                      style={inp}
                      value={branchDraft.geofence_radius_m}
                      onChange={(e) =>
                        setBranchDraft({
                          ...branchDraft,
                          geofence_radius_m: e.target.value,
                        })
                      }
                      placeholder="150"
                    />
                  </div>
                </div>
                <button
                  onClick={() => saveBranchDetails(b)}
                  style={{ ...smallPrimary, alignSelf: "flex-start" }}
                >
                  Save
                </button>
                <div style={{ marginTop: 6 }}>
                  <DocumentsUploader
                    entityType="branch"
                    entityId={b.id}
                    profile={profile}
                    disabledReason={
                      !b.drive_folder_id
                        ? "Set this branch's Drive folder above first, then documents can be uploaded here."
                        : null
                    }
                  />
                </div>

                <div
                  style={{
                    marginTop: 16,
                    paddingTop: 16,
                    borderTop: "1px solid #ececf0",
                  }}
                >
                  <h4
                    style={{
                      color: theme.navy,
                      margin: "0 0 4px",
                      fontSize: 14,
                    }}
                  >
                    Scan Types &amp; Pricing
                  </h4>
                  <p
                    style={{
                      fontSize: 12,
                      color: theme.gray,
                      marginTop: 0,
                      marginBottom: 16,
                    }}
                  >
                    Every scan type available when adding a new patient scan,
                    and whether it shows in the pending-reports tracking once
                    that's live.
                    {!isAdmin && " Price changes require an admin."}
                  </p>

                  {CATEGORY_ORDER.map((cat) => {
                    const items = examTypes.filter(
                      (e) => (e.category || "misc") === cat,
                    );
                    if (items.length === 0) return null;
                    return (
                      <div key={cat} style={{ marginBottom: 18 }}>
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            letterSpacing: 0.5,
                            color: theme.gray,
                            textTransform: "uppercase",
                            marginBottom: 8,
                          }}
                        >
                          {CATEGORY_LABELS[cat]}
                        </div>
                        {items.map((exam) => (
                          <div key={exam.id} style={{ borderBottom: "1px solid #f5f5f5", opacity: exam.is_active ? 1 : 0.5 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 12,
                              padding: "8px 0",
                            }}
                          >
                            {editingExamId === exam.id ? (
                              <>
                                <input
                                  style={{ ...smallInp, flex: 1 }}
                                  value={examDraft.name}
                                  onChange={(e) =>
                                    setExamDraft({
                                      ...examDraft,
                                      name: e.target.value,
                                    })
                                  }
                                />
                                <input
                                  style={{ ...smallInp, width: 90 }}
                                  value={examDraft.price}
                                  onChange={(e) =>
                                    setExamDraft({
                                      ...examDraft,
                                      price: e.target.value,
                                    })
                                  }
                                  placeholder="Price"
                                  disabled={!isAdmin}
                                  title={
                                    !isAdmin
                                      ? "Only an admin can change the price"
                                      : ""
                                  }
                                />
                                <label
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    fontSize: 12,
                                    color: theme.gray,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={examDraft.requires_report}
                                    onChange={(e) =>
                                      setExamDraft({
                                        ...examDraft,
                                        requires_report: e.target.checked,
                                      })
                                    }
                                  />
                                  Requires Report
                                </label>
                                <button
                                  onClick={() => saveExam(exam)}
                                  style={{
                                    ...smallPrimary,
                                    height: 32,
                                    padding: "0 12px",
                                    fontSize: 12,
                                  }}
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => setEditingExamId(null)}
                                  style={{
                                    fontSize: 12,
                                    color: theme.gray,
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                  }}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <span
                                  style={{
                                    flex: 1,
                                    fontSize: 13,
                                    color: theme.navy,
                                    fontWeight: 600,
                                  }}
                                >
                                  {exam.name}
                                </span>
                                <span
                                  style={{
                                    fontSize: 13,
                                    color: theme.navy,
                                    width: 90,
                                  }}
                                >
                                  {exam.price != null
                                    ? `${Number(exam.price).toFixed(2)} EGP`
                                    : "—"}
                                </span>
                                <span
                                  style={{
                                    fontSize: 11,
                                    color: exam.requires_report
                                      ? theme.navy
                                      : theme.gray,
                                    minWidth: 100,
                                  }}
                                >
                                  {exam.requires_report
                                    ? "Requires report"
                                    : "No report needed"}
                                </span>
                                <button
                                  onClick={() => startEditExam(exam)}
                                  style={{
                                    fontSize: 12,
                                    color: theme.gold,
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    fontWeight: 600,
                                  }}
                                >
                                  Edit
                                </button>
                                {/* The stages this scan goes through, and how
                                    long each should take. Paid and Invoice
                                    Generated are not here - they bracket every
                                    visit and are not the clinic's to rename. */}
                                <button
                                  onClick={() => setStepsFor(stepsFor === exam.id ? null : exam.id)}
                                  style={{
                                    fontSize: 12,
                                    color: stepsFor === exam.id ? theme.gold : theme.navy,
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    fontWeight: 600,
                                  }}
                                >
                                  {stepsFor === exam.id ? "Hide steps" : "Steps"}
                                </button>
                                <label
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    fontSize: 11,
                                    color: theme.gray,
                                  }}
                                >
                                  {exam.is_active ? "Active" : "Inactive"}
                                  <input
                                    type="checkbox"
                                    checked={exam.is_active}
                                    onChange={() => toggleExamActive(exam)}
                                  />
                                </label>
                              </>
                            )}
                          </div>
                          {stepsFor === exam.id && (
                            <ExamSteps
                              examTypeId={exam.id}
                              examName={exam.name}
                              onClose={() => setStepsFor(null)}
                            />
                          )}
                          </div>
                        ))}
                      </div>
                    );
                  })}

                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      marginTop: 12,
                      flexWrap: "wrap",
                      alignItems: "center",
                    }}
                  >
                    <input
                      style={{ ...smallInp, flex: 1, minWidth: 160 }}
                      value={newExam.name}
                      onChange={(e) =>
                        setNewExam({ ...newExam, name: e.target.value })
                      }
                      placeholder="New scan type name"
                    />
                    <input
                      style={{ ...smallInp, width: 90 }}
                      value={newExam.price}
                      onChange={(e) =>
                        setNewExam({ ...newExam, price: e.target.value })
                      }
                      placeholder="Price"
                      disabled={!isAdmin}
                      title={!isAdmin ? "Only an admin can set the price" : ""}
                    />
                    <select
                      style={{ ...smallInp, width: 100 }}
                      value={newExam.category}
                      onChange={(e) =>
                        setNewExam({ ...newExam, category: e.target.value })
                      }
                    >
                      {CATEGORY_ORDER.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABELS[c]}
                        </option>
                      ))}
                    </select>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12,
                        color: theme.gray,
                        whiteSpace: "nowrap",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={newExam.requires_report}
                        onChange={(e) =>
                          setNewExam({
                            ...newExam,
                            requires_report: e.target.checked,
                          })
                        }
                      />
                      Requires Report
                    </label>
                    <button
                      onClick={() => addExamType(b.id)}
                      disabled={addingExam}
                      style={smallPrimary}
                    >
                      + Add Scan Type
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <input
            style={{ ...inp, marginBottom: 0 }}
            value={newBranch}
            onChange={(e) => setNewBranch(e.target.value)}
            placeholder="New branch name"
          />
          <button onClick={addBranch} style={smallPrimary}>
            + Add Branch
          </button>
        </div>
      </div>
    </div>
  );
}

const inp = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #ddd",
  fontSize: 14,
  boxSizing: "border-box",
  marginBottom: 16,
};
const smallPrimary = {
  padding: "0 16px",
  height: 40,
  borderRadius: 8,
  border: "none",
  background: "#27214D",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: 13,
};
const smallInp = {
  padding: "7px 10px",
  borderRadius: 6,
  border: "1px solid #ddd",
  fontSize: 13,
  boxSizing: "border-box",
};

// The stages a scan goes through between the money arriving and the invoice
// leaving, in order, each with how long it ought to take. Steps carrying a
// legacy_field are the three the platform has always had - their names can be
// changed but they cannot be deleted, because years of visits store their
// completion in dedicated columns on the visit itself.
function ExamSteps({ examTypeId, examName, onClose }) {
  const [steps, setSteps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ name: "", target_minutes: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("exam_type_steps")
      .select("*")
      .eq("exam_type_id", examTypeId)
      .order("sort_order");
    setSteps(data || []);
    setLoading(false);
  }, [examTypeId]);

  useEffect(() => { load(); }, [load]);

  async function addStep() {
    if (!draft.name.trim()) return setError("Give the step a name.");
    setSaving(true);
    setError("");
    const nextOrder = steps.length ? Math.max(...steps.map((s) => s.sort_order)) + 1 : 1;
    const { error: err } = await supabase.from("exam_type_steps").insert({
      exam_type_id: examTypeId,
      name: draft.name.trim(),
      sort_order: nextOrder,
      target_minutes: draft.target_minutes === "" ? null : Number(draft.target_minutes),
    });
    setSaving(false);
    if (err) return setError(err.message);
    setDraft({ name: "", target_minutes: "" });
    load();
  }

  async function updateStep(step, patch) {
    await supabase.from("exam_type_steps").update(patch).eq("id", step.id);
    load();
  }

  async function removeStep(step) {
    if (step.legacy_field) return;
    if (!confirm(`Remove "${step.name}" from ${examName}? Visits already past this step keep their record of it.`)) return;
    await supabase.from("exam_type_steps").delete().eq("id", step.id);
    load();
  }

  async function move(step, direction) {
    const ordered = [...steps].sort((a, b) => a.sort_order - b.sort_order);
    const i = ordered.findIndex((x) => x.id === step.id);
    const j = i + direction;
    if (j < 0 || j >= ordered.length) return;
    await supabase.from("exam_type_steps").update({ sort_order: ordered[j].sort_order }).eq("id", step.id);
    await supabase.from("exam_type_steps").update({ sort_order: step.sort_order }).eq("id", ordered[j].id);
    load();
  }

  const box = { padding: "6px 8px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 };

  return (
    <div style={{ margin: "0 0 12px", padding: 14, background: "#f7f8fa", borderRadius: 8, border: "1px solid #e5e7eb", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: theme.navy }}>
          Steps for {examName}
          <div style={{ fontWeight: 400, color: theme.gray, marginTop: 2 }}>
            Shown on every visit with this scan, between Paid and Invoice Generated.
          </div>
        </div>
        {/* Opening the panel replaced the Steps button with nothing to press,
            so the only way out was to find the button again behind it. */}
        <button
          onClick={onClose}
          title="Close"
          style={{
            border: "1px solid #ddd",
            background: "#fff",
            borderRadius: 6,
            width: 26,
            height: 26,
            lineHeight: "22px",
            fontSize: 15,
            color: theme.gray,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          &times;
        </button>
      </div>

      {loading ? (
        <p style={{ fontSize: 12, color: theme.gray }}>Loading...</p>
      ) : (
        <>
          {steps.map((st, idx) => (
            <div key={st.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, color: theme.gray, width: 18 }}>{idx + 1}.</span>
              <input
                defaultValue={st.name}
                onBlur={(e) => e.target.value.trim() && e.target.value !== st.name && updateStep(st, { name: e.target.value.trim() })}
                style={{ ...box, width: 190 }}
              />
              <input
                type="number"
                min="0"
                defaultValue={st.target_minutes ?? ""}
                placeholder="mins"
                onBlur={(e) => updateStep(st, { target_minutes: e.target.value === "" ? null : Number(e.target.value) })}
                style={{ ...box, width: 80 }}
              />
              <span style={{ fontSize: 11, color: theme.gray }}>
                {st.target_minutes ? humanMinutes(st.target_minutes) : "no target"}
              </span>
              <button onClick={() => move(st, -1)} disabled={idx === 0} style={arrowBtn}>&uarr;</button>
              <button onClick={() => move(st, 1)} disabled={idx === steps.length - 1} style={arrowBtn}>&darr;</button>
              {st.legacy_field ? (
                <span style={{ fontSize: 10, color: theme.gray }} title="Built in - visits store this one directly, so it can be renamed but not removed">
                  built in
                </span>
              ) : (
                <button onClick={() => removeStep(st)} style={{ ...arrowBtn, color: "#b42318" }}>Remove</button>
              )}
            </div>
          ))}

          {steps.length === 0 && (
            <p style={{ fontSize: 12, color: theme.gray }}>No steps yet. Visits will show only Paid and Invoice Generated.</p>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="New step name"
              style={{ ...box, width: 190 }}
            />
            <input
              type="number"
              min="0"
              value={draft.target_minutes}
              onChange={(e) => setDraft({ ...draft, target_minutes: e.target.value })}
              placeholder="mins"
              style={{ ...box, width: 80 }}
            />
            <button
              onClick={addStep}
              disabled={saving}
              style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: theme.gold, color: theme.navy, fontWeight: 700, fontSize: 12, cursor: "pointer" }}
            >
              Add step
            </button>
            <button
              onClick={onClose}
              style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", fontSize: 12, cursor: "pointer" }}
            >
              Done
            </button>
          </div>
          {error && <p style={{ fontSize: 12, color: "#b42318", margin: "6px 0 0" }}>{error}</p>}
        </>
      )}
    </div>
  );
}

const arrowBtn = {
  fontSize: 11,
  padding: "3px 7px",
  borderRadius: 5,
  border: "1px solid #ddd",
  background: "#fff",
  cursor: "pointer",
};

// "90" reads as nothing in particular; "1h 30m" reads as a target.
function humanMinutes(mins) {
  const m = Number(mins) || 0;
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}
