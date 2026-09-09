import { NextResponse } from "next/server";
import { requireStaff } from "../../../../lib/requireStaff";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
export const dynamic = "force-dynamic";

export async function GET() {
  // Every route in this group ran with the service-role key and no
  // identity check at all, so anyone who knew the path could call it.
  // Reports the state of the Drive backup, including counts and paths. No caller left.
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { data, error } = await supabaseAdmin.rpc("drive_backup_progress");
  if (error) {
    const { data: rows } = await supabaseAdmin
      .from("drive_backup_map").select("is_folder,status");
    return Response.json({ ok: true, fallback: true, count: rows?.length ?? 0 });
  }
  return Response.json({ ok: true, progress: data });
}
