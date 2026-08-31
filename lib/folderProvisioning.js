import { supabaseAdmin } from "./supabaseAdmin";
import { findOrCreateFolder } from "./googleDrive";

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

  // Land new patients directly under their clinic folder - matching the real,
  // manually-organized historical structure - instead of the app's own
  // per-doctor silo, so every doctor at a clinic can see all of its cases.
  // No referring doctor on file (walk-ins, root-level patients) still falls
  // back to ROOT, unchanged from before.
  let parentId = ROOT;
  const clinicCode = visit?.doctors?.clinic_code;
  if (clinicCode) {
    parentId = await ensureClinicFolder(clinicCode);
  }

  // Include the patient ID so a same-named patient at the same clinic never
  // collides with another - matches the naming convention already applied to
  // the reorganized historical folders.
  const folderName = `${patient.name}__${patientId.slice(0, 8)}`;
  const folderId = await findOrCreateFolder(folderName, parentId);
  await supabaseAdmin.from("drive_folder_index").insert({ entity_type: "patient", entity_id: patientId, drive_folder_id: folderId });
  await supabaseAdmin.from("patients").update({ drive_folder_id: folderId }).eq("id", patientId);
  return folderId;
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
