import { google } from "googleapis";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Safety ceiling: never let the backup push the shared drive past this.
const MAX_DRIVE_BYTES = Number(process.env.DRIVE_BACKUP_MAX_BYTES || 0); // 0 = disabled
const FOLDER_BATCH = 60;
const FILE_BATCH = 8;

function driveClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY missing");
  const creds = JSON.parse(raw);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

async function getSetting(key, fallback) {
  const { data } = await supabaseAdmin
    .from("drive_backup_settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? fallback;
}

export async function GET(req) {
  return handler(req);
}
export async function POST(req) {
  return handler(req);
}

async function handler() {
  const started = Date.now();
  const result = { folders_created: 0, files_copied: 0, bytes: 0, errors: [], stopped: null };

  // --- KILL SWITCH -------------------------------------------------------
  const enabled = await getSetting("enabled", "true");
  if (String(enabled) !== "true") {
    return Response.json({ ok: true, paused: true, message: "backup paused via kill switch" });
  }

  const backupRoot = await getSetting("backup_root_id", null);
  if (!backupRoot) {
    return Response.json({ ok: false, error: "backup_root_id not set" }, { status: 400 });
  }

  const drive = driveClient();

  // --- PHASE 1: folders (parents before children) ------------------------
  const { data: pendingFolders } = await supabaseAdmin
    .from("drive_backup_map")
    .select("source_id,source_path,parent_source_id")
    .eq("is_folder", true).eq("status", "pending")
    .order("depth", { ascending: true })
    .limit(FOLDER_BATCH);

  if (pendingFolders?.length) {
    for (const row of pendingFolders) {
      if (Date.now() - started > 45000) break;
      let target = backupRoot;
      if (row.parent_source_id) {
        const { data: p } = await supabaseAdmin
          .from("drive_backup_map").select("backup_id,is_folder")
          .eq("source_id", row.parent_source_id).maybeSingle();
        // parent exists in map but isn't copied yet -> skip, retry next tick
        if (p && !p.backup_id) continue;
        if (p?.backup_id) target = p.backup_id;
      }
      const name = (row.source_path || "/").replace(/\/+$/, "").split("/").pop() || "unnamed";
      try {
        const res = await drive.files.create({
          requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [target] },
          fields: "id", supportsAllDrives: true,
        });
        await supabaseAdmin.from("drive_backup_map")
          .update({ backup_id: res.data.id, status: "done", copied_at: new Date().toISOString() })
          .eq("source_id", row.source_id);
        result.folders_created++;
      } catch (e) {
        await supabaseAdmin.from("drive_backup_map")
          .update({ status: "pending", err: String(e.message || e).slice(0, 200) })
          .eq("source_id", row.source_id);
        result.errors.push(String(e.message || e).slice(0, 120));
      }
    }
    return Response.json({ ok: true, phase: "folders", ...result, ms: Date.now() - started });
  }

  // --- PHASE 2: files ----------------------------------------------------
  const { data: pendingFiles } = await supabaseAdmin
    .from("drive_backup_map")
    .select("source_id,source_path,parent_source_id,size_bytes")
    .eq("is_folder", false).eq("status", "pending")
    .order("size_bytes", { ascending: true })
    .limit(FILE_BATCH);

  if (!pendingFiles?.length) {
    return Response.json({ ok: true, phase: "complete", message: "nothing pending", ...result });
  }

  for (const row of pendingFiles) {
    if (Date.now() - started > 45000) break;

    // QUOTA GUARD: abort before we can starve the live platform of storage.
    if (MAX_DRIVE_BYTES > 0) {
      const { data: agg } = await supabaseAdmin
        .from("drive_backup_map").select("size_bytes.sum()").eq("status", "done").single();
      const copied = Number(agg?.sum || 0);
      if (copied + Number(row.size_bytes || 0) > MAX_DRIVE_BYTES) {
        await supabaseAdmin.from("drive_backup_settings")
          .upsert({ key: "enabled", value: "false" }, { onConflict: "key" });
        result.stopped = "quota_ceiling_reached";
        break;
      }
    }

    const { data: p } = await supabaseAdmin
      .from("drive_backup_map").select("backup_id")
      .eq("source_id", row.parent_source_id).maybeSingle();
    if (!p?.backup_id) continue; // parent folder not ready yet

    const name = (row.source_path || "/").replace(/\/+$/, "").split("/").pop() || "unnamed";
    try {
      const res = await drive.files.copy({
        fileId: row.source_id,
        requestBody: { name, parents: [p.backup_id] },
        fields: "id", supportsAllDrives: true,
      });
      await supabaseAdmin.from("drive_backup_map")
        .update({ backup_id: res.data.id, status: "done", copied_at: new Date().toISOString() })
        .eq("source_id", row.source_id);
      result.files_copied++;
      result.bytes += Number(row.size_bytes || 0);
    } catch (e) {
      const msg = String(e.message || e).slice(0, 200);
      const { data: cur } = await supabaseAdmin
        .from("drive_backup_map").select("attempts").eq("source_id", row.source_id).maybeSingle();
      const attempts = Number(cur?.attempts || 0) + 1;
      await supabaseAdmin.from("drive_backup_map")
        .update({ status: attempts >= 5 ? "error" : "pending", attempts, err: msg })
        .eq("source_id", row.source_id);
      result.errors.push(msg.slice(0, 120));
    }
  }

  return Response.json({ ok: true, phase: "files", ...result, ms: Date.now() - started });
}
