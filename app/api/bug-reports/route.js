import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { requireStaff } from "../../../lib/requireStaff";

// The single person who triages bug reports. Deliberately a constant rather
// than a permission flag: this is one named owner, not a role, and it should
// not be grantable through the normal per-page access screen by mistake.
const TRIAGE_EMAIL = "moamen@i-gamify.net";

function canTriage(staff) {
  return (staff?.email || "").toLowerCase() === TRIAGE_EMAIL;
}

// GET - the triage owner sees everything; everyone else sees only their own
// reports, so they can check whether what they raised has been dealt with.
export async function GET(req) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: "Sign in to view reports." }, { status: 401 });

  const status = new URL(req.url).searchParams.get("status");
  let q = supabaseAdmin.from("bug_reports").select("*").order("created_at", { ascending: false });
  if (!canTriage(staff)) q = q.eq("reporter_id", staff.id);
  if (status && status !== "all") q = q.eq("status", status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ reports: data || [], canTriage: canTriage(staff) });
}

export async function POST(req) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: "Sign in to report a problem." }, { status: 401 });

  const body = await req.json();
  const { pageUrl, errorType, errorMessage, description, screenshotDriveId, screenshotName } = body;

  if (!description || !description.trim()) {
    return NextResponse.json({ error: "Describe what happened." }, { status: 400 });
  }
  if (!errorType) {
    return NextResponse.json({ error: "Choose what kind of problem this is." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("bug_reports")
    .insert({
      reporter_id: staff.id,
      reporter_name: staff.name,
      reporter_email: staff.email,
      reporter_role: staff.role,
      page_url: pageUrl || null,
      error_type: errorType,
      error_message: errorMessage || null,
      description: description.trim(),
      screenshot_drive_id: screenshotDriveId || null,
      screenshot_name: screenshotName || null,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}

// PATCH - triage only. Reporters can raise a report but must not be able to
// close their own, or the list stops reflecting what has actually been fixed.
export async function PATCH(req) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canTriage(staff)) {
    return NextResponse.json({ error: "Only the bug report owner can update reports." }, { status: 403 });
  }

  const { id, status, adminNotes } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const update = {};
  if (status) {
    update.status = status;
    update.resolved_by_name = staff.name;
    update.resolved_at = ["resolved", "wont_fix"].includes(status) ? new Date().toISOString() : null;
  }
  if (adminNotes !== undefined) update.admin_notes = adminNotes;

  const { error } = await supabaseAdmin.from("bug_reports").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
