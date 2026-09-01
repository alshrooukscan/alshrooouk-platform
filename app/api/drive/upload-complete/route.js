import { NextResponse } from "next/server";
import { getFileMeta } from "../../../../lib/googleDrive";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

// Step 2: called once the browser's direct PUT to Google finished. Records
// the file the same way the old base64 upload route used to, so every
// downstream behaviour (visit stage flags, audit stamps) is unchanged.
export async function POST(req) {
  try {
    const { fileId, patientId, filename, fileType, visitId, uploaderEmail, uploaderName } = await req.json();
    if (!fileId || !patientId || !filename) {
      return NextResponse.json({ error: "fileId, patientId, and filename are required" }, { status: 400 });
    }
    const file = await getFileMeta(fileId);

    // Use the SAME visit upload-session already resolved (passed through from
    // the client) rather than independently re-guessing "most recent" here -
    // otherwise the file could physically land in one visit's folder while
    // getting attributed to a different visit in the database if the two
    // guesses ever disagreed (e.g. a new visit got created in between the two
    // calls). Falls back to the old guess-by-recency only if the caller
    // genuinely didn't have a visitId (shouldn't happen via the current UI).
    let targetVisit = null;
    if (visitId) {
      const { data } = await supabaseAdmin.from("visits").select("id, scanned").eq("id", visitId).maybeSingle();
      targetVisit = data;
    } else {
      const { data } = await supabaseAdmin
        .from("visits")
        .select("id, scanned")
        .eq("patient_id", patientId)
        .order("exam_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      targetVisit = data;
    }

    const classifiedType = ["raw_data", "report", "images", "photos", "other"].includes(fileType) ? fileType : "other";
    const now = new Date().toISOString();

    await supabaseAdmin.from("patient_files").insert({
      patient_id: patientId,
      visit_id: targetVisit?.id || null,
      drive_file_id: file.id,
      file_name: filename,
      file_type: classifiedType,
      uploaded_by_email: uploaderEmail || null,
      uploaded_by_name: uploaderName || null,
    });

    if (targetVisit) {
      if (classifiedType === "raw_data") {
        // Raw data existing means the scan itself obviously happened - auto-flag
        // Scanned too (only if not already marked, so we never clobber an earlier,
        // more accurate manual timestamp or attribution).
        const scanUpdate = { raw_data_uploaded: true, raw_data_uploaded_at: now, raw_data_uploaded_by_name: uploaderName || uploaderEmail || null };
        if (!targetVisit.scanned) {
          scanUpdate.scanned = true;
          scanUpdate.scanned_at = now;
          scanUpdate.scanned_by_name = uploaderName || uploaderEmail || null;
        }
        await supabaseAdmin.from("visits").update(scanUpdate).eq("id", targetVisit.id);
      } else if (classifiedType === "images") {
        // Scan images prove the scan happened, but they are not the raw DICOM
        // set, so they flag Scanned only - never Raw Data Uploaded.
        if (!targetVisit.scanned) {
          await supabaseAdmin
            .from("visits")
            .update({ scanned: true, scanned_at: now, scanned_by_name: uploaderName || uploaderEmail || null })
            .eq("id", targetVisit.id);
        }
      } else if (classifiedType === "report") {
        // report_done_by_name was being left null here while the scanned branch
        // set its equivalent, so a report auto-flagged by an upload had no owner
        // recorded - and nothing to enforce the "only the person who set it can
        // unset it" rule against.
        await supabaseAdmin
          .from("visits")
          .update({ report_done: true, report_done_at: now, report_done_by_name: uploaderName || uploaderEmail || null })
          .eq("id", targetVisit.id);
      }
    }

    return NextResponse.json({ file, folderId: file.parents?.[0] });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Could not finalize upload" }, { status: 500 });
  }
}
