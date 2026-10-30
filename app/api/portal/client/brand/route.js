import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

// The client's logo and name, and nothing else, so their portal can show their
// mark on the loading screen instead of ours (Mohamed Said, 30 Oct 2026). One
// small read, answered before the full portal data.
export async function GET() {
  const session = verifySession(cookies().get("portal_session")?.value);
  if (!session || session.role !== "client") return NextResponse.json({ logo_url: null, name: null }, { status: 401 });
  const { data } = await supabaseAdmin.from("clients").select("name, logo_url").eq("id", session.id).maybeSingle();
  return NextResponse.json({ logo_url: data?.logo_url || null, name: data?.name || null });
}
