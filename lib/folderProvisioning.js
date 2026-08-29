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
    .select("doctor_id")
    .eq("patient_id", patientId)
    .not("doctor_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let parentId = ROOT;
  if (visit && visit.doctor_id) {
    parentId = await ensureDoctorFolder(visit.doctor_id);
  }

  const folderId = await findOrCreateFolder(patient.name, parentId);
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
