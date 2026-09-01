import { supabaseAdmin } from "./supabaseAdmin";
import { findOrCreateFolder, findFolderByName } from "./googleDrive";

const ROOT = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

let employeePhotosFolderCache = null;

export async function ensureEmployeePhotosFolder() {
  if (employeePhotosFolderCache) return employeePhotosFolderCache;
  const folderId = await findOrCreateFolder("_Employee Face Enrollment", ROOT);
  employeePhotosFolderCache = folderId;
  return folderId;
}

export async function ensureDoctorFolder(doctorId) {
  const { data: existing } = await supabaseAdmin
    .from("drive_folder_index")
    .select("drive_folder_id")
    .eq("entity_type", "doctor")
    .eq("entity_id", doctorId)
    .maybeSingle();
  if (existing) return existing.drive_folder_id;

  const { data: doctor } = await supabaseAdmin.from("doctors").select("name, clinic_code").eq("id", doctorId).single();
  const folderName = `${doctor.clinic_code}_${doctor.name}`;
  const folderId = await findOrCreateFolder(folderName, ROOT);

  await supabaseAdmin.from("drive_folder_index").insert({ entity_type: "doctor", entity_id: doctorId, drive_folder_id: folderId });
  await supabaseAdmin.from("doctors").update({ drive_folder_id: folderId }).eq("id", doctorId);
  return folderId;
}

// Root folder for employee hiring documents, provided directly by the
// client (not built by the app, unlike ROOT which is our own service
// account's working area) - named "Employees" in their Drive.
const EMPLOYEE_DOCUMENTS_ROOT = "1yP4rY-8taCzrH5kqIXPb_Rby3iO0V4f0";

export async function ensureEmployeeDocumentsFolder(employeeId, employeeName) {
  const { data: existing } = await supabaseAdmin
    .from("drive_folder_index")
    .select("drive_folder_id")
    .eq("entity_type", "employee_documents")
    .eq("entity_id", employeeId)
    .maybeSingle();
  if (existing) return existing.drive_folder_id;

  const folderId = await findOrCreateFolder(employeeName, EMPLOYEE_DOCUMENTS_ROOT);
  await supabaseAdmin.from("drive_folder_index").insert({ entity_type: "employee_documents", entity_id: employeeId, drive_folder_id: folderId });
  return folderId;
}

// Clinics, not doctors, own the shared Drive space - all doctors at a clinic
// need to see all of that clinic's cases. drive_folder_index.entity_id is a
// uuid column and clinic codes aren't uuids, so this gets its own small
// cache table instead of reusing that one.
export async function ensureClinicFolder(clinicCode) {
  const { data: existing } = await supabaseAdmin
    .from("drive_clinic_folder_index")
    .select("drive_folder_id")
    .eq("clinic_code", clinicCode)
    .maybeSingle();
  if (existing) return existing.drive_folder_id;

  const folderId = await findOrCreateFolder(clinicCode, ROOT);
  await supabaseAdmin.from("drive_clinic_folder_index").insert({ clinic_code: clinicCode, drive_folder_id: folderId });
  return folderId;
}

export async function ensurePatientFolder(patientId) {
  const { data: existing } = await supabaseAdmin
    .from("drive_folder_index")
    .select("drive_folder_id")
    .eq("entity_type", "patient")
    .eq("entity_id", patientId)
    .maybeSingle();
  if (existing) return existing.drive_folder_id;

  const { data: patient } = await supabaseAdmin.from("patients").select("name").eq("id", patientId).single();

  const { data: visit } = await supabaseAdmin
    .from("visits")
    .select("doctor_id, doctors(clinic_code)")
    .eq("patient_id", patientId)
    .not("doctor_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Patients land directly under their clinic folder, matching the structure the
  // clinic actually maintains by hand, so every doctor at that clinic sees all of
  // its cases. A patient with no referring doctor (walk-in) still falls back to
  // the drive root.
  //
  // ensureClinicFolder resolves to the clinic's REAL folder - the migration once
  // built a parallel "<clinic>_<Dr Name>" tree per doctor and pointed patients at
  // it, which left files invisible in the app and sent new uploads somewhere the
  // clinic never looks. Nothing here may recreate that shape.
  let parentId = ROOT;
  const clinicCode = visit?.doctors?.clinic_code;
  if (clinicCode) {
    parentId = await ensureClinicFolder(clinicCode);
  }

  // Adopt an existing folder of the same name before making a new one. Clinic
  // staff have been creating these by hand for years, so the folder holding this
  // patient's history usually already exists - claiming it is what makes those
  // files appear in the app instead of silently starting an empty second folder
  // beside them.
  let folderId = null;
  if (clinicCode) {
    const candidate = await findFolderByName(patient.name, parentId);
    if (candidate) {
      // Only adopt it if no other patient already owns it, or two same-named
      // patients at one clinic would end up sharing a folder. Real duplicate
      // names exist in this data, so this check is not theoretical.
      const { data: claimed } = await supabaseAdmin
        .from("drive_folder_index")
        .select("entity_id")
        .eq("entity_type", "patient")
        .eq("drive_folder_id", candidate)
        .maybeSingle();
      if (!claimed) folderId = candidate;
    }
  }

  // Nothing to adopt: create it. The short id keeps same-named patients apart.
  if (!folderId) {
    folderId = await findOrCreateFolder(`${patient.name}__${patientId.slice(0, 8)}`, parentId);
  }

  await supabaseAdmin.from("drive_folder_index").insert({ entity_type: "patient", entity_id: patientId, drive_folder_id: folderId });
  await supabaseAdmin.from("patients").update({ drive_folder_id: folderId }).eq("id", patientId);
  return folderId;
}

const FILE_TYPE_SUBFOLDER = {
  raw_data: "Raw_DICOM",
  report: "Reports",
  images: "Images",
  photos: "Photos",
  other: "Exports",
};

function sanitizeForFolderName(s) {
  return String(s || "").trim().replace(/[\/\\:*?"<>|]/g, "-").replace(/\s+/g, " ");
}

// New-upload-flow only (client feedback: leave the already-reorganized historical
// files exactly as they are; every NEW upload from now on - for an old or new
// patient alike - lands in this structure instead). Creates/reuses:
//   [patientFolder]/Visit_[YYYY-MM-DD]_[ScanTypes]/[Raw_DICOM|Reports|Exports]/
export async function ensureVisitFolder(patientFolderId, visitId) {
  const { data: existing } = await supabaseAdmin
    .from("drive_folder_index")
    .select("drive_folder_id")
    .eq("entity_type", "visit")
    .eq("entity_id", visitId)
    .maybeSingle();
  if (existing) return existing.drive_folder_id;

  const { data: visit } = await supabaseAdmin.from("visits").select("exam_date, scan_types").eq("id", visitId).single();
  const dateStr = visit?.exam_date || new Date().toISOString().slice(0, 10);
  const scanTypeStr = sanitizeForFolderName((visit?.scan_types || []).join("+")) || "Scan";
  const folderName = `Visit_${dateStr}_${scanTypeStr}`;

  const folderId = await findOrCreateFolder(folderName, patientFolderId);
  await supabaseAdmin.from("drive_folder_index").insert({ entity_type: "visit", entity_id: visitId, drive_folder_id: folderId });
  return folderId;
}

// The Raw_DICOM/Reports/Exports subfolder inside a visit folder, keyed by the
// same fileType classification staff already pick at upload time.
export async function ensureVisitTypeFolder(visitFolderId, visitId, fileType) {
  const subName = FILE_TYPE_SUBFOLDER[fileType] || FILE_TYPE_SUBFOLDER.other;
  // A visit needs up to 3 subfolders (Raw_DICOM/Reports/Exports), and
  // drive_folder_index only holds one row per (entity_type, entity_id) pair,
  // so this gets its own small lookup table keyed on (visit_id, subfolder_name).
  const { data: cached } = await supabaseAdmin
    .from("drive_visit_type_folder_index")
    .select("drive_folder_id")
    .eq("visit_id", visitId)
    .eq("subfolder_name", subName)
    .maybeSingle();
  if (cached) return cached.drive_folder_id;

  const folderId = await findOrCreateFolder(subName, visitFolderId);
  await supabaseAdmin.from("drive_visit_type_folder_index").insert({ visit_id: visitId, subfolder_name: subName, drive_folder_id: folderId });
  return folderId;
}

export const FILE_TYPE_LABEL = {
  raw_data: "Raw Data",
  report: "Report",
  images: "Images",
  photos: "Photos",
  other: "Export",
};

// "Patient Name - Type - Date.ext". Files were previously landing under whatever
// the camera or scanner called them ("22222222-5.jpg"), which is unreadable in
// Drive and told a doctor receiving it nothing about whose scan it was.
//
// The patient name is sanitised, not trusted: Drive rejects slashes in names,
// and a name containing one would otherwise fail the upload outright.
export async function buildStandardFileName(patientId, examDate, fileType, originalName) {
  const { data: patient } = await supabaseAdmin.from("patients").select("name").eq("id", patientId).maybeSingle();
  const safeName = String(patient?.name || patientId.slice(0, 8))
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const dateStr = examDate || new Date().toISOString().slice(0, 10);
  const typeLabel = FILE_TYPE_LABEL[fileType] || FILE_TYPE_LABEL.other;
  const ext = originalName.includes(".") ? originalName.split(".").pop() : "";
  // A short unique tail keeps a second upload of the same type on the same day
  // from silently colliding with the first.
  const tail = Math.random().toString(36).slice(2, 6);
  const base = `${safeName} - ${typeLabel} - ${dateStr} - ${tail}`;
  return ext ? `${base}.${ext}` : base;
}

export async function ensureClientFolder(clientId) {
  const { data: existing } = await supabaseAdmin
    .from("drive_folder_index")
    .select("drive_folder_id")
    .eq("entity_type", "client")
    .eq("entity_id", clientId)
    .maybeSingle();
  if (existing) return existing.drive_folder_id;

  const { data: client } = await supabaseAdmin.from("clients").select("name").eq("id", clientId).single();
  const folderId = await findOrCreateFolder(client.name, ROOT);

  await supabaseAdmin.from("drive_folder_index").insert({ entity_type: "client", entity_id: clientId, drive_folder_id: folderId });
  await supabaseAdmin.from("clients").update({ drive_folder_id: folderId }).eq("id", clientId);
  return folderId;
}

// One subfolder per report request, named scan name + date required, nested
// under the client's own folder - holds both what the client uploaded and
// the eventual report file, whether the "client" here is a real external
// party or the branch-named pseudo-client for an internal patient request.
export async function ensureReportFolder(reportId) {
  const { data: existing } = await supabaseAdmin
    .from("drive_folder_index")
    .select("drive_folder_id")
    .eq("entity_type", "report")
    .eq("entity_id", reportId)
    .maybeSingle();
  if (existing) return existing.drive_folder_id;

  const { data: report } = await supabaseAdmin.from("reports").select("client_id, scan_name, date_required").eq("id", reportId).single();
  const clientFolderId = await ensureClientFolder(report.client_id);
  const folderName = `${report.scan_name} - ${report.date_required}`;
  const folderId = await findOrCreateFolder(folderName, clientFolderId);

  await supabaseAdmin.from("drive_folder_index").insert({ entity_type: "report", entity_id: reportId, drive_folder_id: folderId });
  await supabaseAdmin.from("reports").update({ drive_folder_id: folderId }).eq("id", reportId);
  return folderId;
}
