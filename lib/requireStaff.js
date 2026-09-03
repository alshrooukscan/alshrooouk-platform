import { supabaseAdmin } from "./supabaseAdmin";

// Shared guard for staff-only API routes.
//
// These upload-session routes hand out a Google resumable-upload URL, which is
// a live write handle into the clinic's shared Drive. They were previously
// open to anyone who knew the path, so this exists to require a real, active
// staff login first.
//
// Returns { id, email, name, role } on success, or null. Callers should treat
// null as 401 and stop.
export async function requireStaff(req) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return null;

  const { data: userData, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !userData?.user) return null;

  const { data: profile } = await supabaseAdmin
    .from("staff_profiles")
    .select("id, name, email, role, is_active, permissions, branch_id")
    .eq("id", userData.user.id)
    .single();

  if (!profile || profile.is_active === false) return null;
  return profile;
}
