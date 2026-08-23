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
