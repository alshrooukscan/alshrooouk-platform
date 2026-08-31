import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await supabaseAdmin.rpc("drive_backup_progress");
  if (error) {
    const { data: rows } = await supabaseAdmin
      .from("drive_backup_map").select("is_folder,status");
    return Response.json({ ok: true, fallback: true, count: rows?.length ?? 0 });
  }
  return Response.json({ ok: true, progress: data });
}
