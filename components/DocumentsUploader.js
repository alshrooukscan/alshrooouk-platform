"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { theme } from "../lib/theme";
import { uploadFileToDrive } from "../lib/uploadToDrive";

// Shared document list + upload for both employee hiring paperwork and
// branch legal documents - same shape either way (a custom name, a file,
// who uploaded it), routed to the right Drive folder server-side based on
// entityType.
export default function DocumentsUploader({ entityType, entityId, profile, disabledReason }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [fileName, setFileName] = useState("");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("entity_documents")
      .select("*")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false });
    setDocs(data || []);
    setLoading(false);
  }

  async function handleUpload() {
    if (!fileName.trim()) {
      setError("Give this document a name.");
      return;
    }
    if (!file) {
      setError("Choose a file to upload.");
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    setError("");
    try {
      const fileId = await uploadFileToDrive({
        file,
        initEndpoint: "/api/drive/document-session",
        initBody: { entityType, entityId, fileName: fileName.trim(), mimeType: file.type },
        onProgress: (frac) => setUploadProgress(Math.round(frac * 100)),
      });
      const res = await fetch("/api/drive/document-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId, entityType, entityId, fileName: fileName.trim(), mimeType: file.type,
          uploaderId: profile?.id, uploaderName: profile?.name,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setFileName("");
      setFile(null);
      setShowForm(false);
      load();
    } catch (e) {
      setError(e.message);
    }
    setUploading(false);
    setUploadProgress(0);
  }

  return (
    <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ color: theme.navy, margin: 0 }}>Documents</h3>
        {!disabledReason && (
          <button
            onClick={() => setShowForm((v) => !v)}
            style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${theme.navy}`, background: "#fff", color: theme.navy, fontWeight: 700, cursor: "pointer", fontSize: 12 }}
          >
            {showForm ? "Cancel" : "+ Add Document"}
          </button>
        )}
      </div>

      {disabledReason && <p style={{ fontSize: 12, color: "#a97c00", background: "#fff8e1", padding: "8px 12px", borderRadius: 8 }}>{disabledReason}</p>}

      {showForm && !disabledReason && (
        <div style={{ background: "#faf9fb", borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 11, color: "#48464E", fontWeight: 600, marginBottom: 4 }}>File Name</label>
          <input
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder="e.g. National ID, Contract, Certificate"
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box", marginBottom: 10 }}
          />
          <label style={{ display: "block", fontSize: 11, color: "#48464E", fontWeight: 600, marginBottom: 4 }}>File</label>
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ marginBottom: 10 }} />
          {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}
          <button
            onClick={handleUpload}
            disabled={uploading}
            style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13, position: "relative", overflow: "hidden" }}
          >
            {uploading && (
              <div style={{ position: "absolute", inset: 0, left: 0, width: `${uploadProgress}%`, background: "rgba(255,255,255,0.25)", transition: "width 0.15s linear" }} />
            )}
            <span style={{ position: "relative" }}>{uploading ? `Uploading... ${uploadProgress}%` : "Upload"}</span>
          </button>
        </div>
      )}

      {!loading && docs.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>No documents uploaded yet.</p>}
      <div style={{ display: "grid", gap: 8 }}>
        {docs.map((d) => (
          <a
            key={d.id}
            href={`https://drive.google.com/file/d/${d.drive_file_id}/view`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f0f0f0", textDecoration: "none" }}
          >
            <span style={{ color: theme.navy, fontWeight: 600, fontSize: 13 }}>{d.file_name}</span>
            <span style={{ color: theme.gray, fontSize: 11 }}>
              {d.uploaded_by_name && `${d.uploaded_by_name} \u00b7 `}
              {new Date(d.created_at).toLocaleDateString()}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
