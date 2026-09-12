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

  // Trends for the one person who triages. Computed here rather than in the
  // browser so the page does not have to pull every ticket to count them, and
  // so nobody without the triage email can reach the figures at all.
  let insights = null;
  if (canTriage(staff)) {
    const { data: all } = await supabaseAdmin
      .from("bug_reports")
      .select("error_type, status, reporter_name, page_url, created_at, resolved_at");

    const rows = all || [];
    const tally = (key) =>
      Object.entries(
        rows.reduce((acc, r) => {
          const k = r[key] || "unknown";
          acc[k] = (acc[k] || 0) + 1;
          return acc;
        }, {})
      ).sort((a, b) => b[1] - a[1]);

    const hoursToResolve = rows
      .filter((r) => r.resolved_at)
      .map((r) => (new Date(r.resolved_at) - new Date(r.created_at)) / 3600000)
      .sort((a, b) => a - b);

    // Median, not mean. One ticket left open over a weekend drags an average
    // far enough to make a healthy week look bad.
    const median = hoursToResolve.length
      ? hoursToResolve[Math.floor(hoursToResolve.length / 2)]
      : null;

    const byMonth = Object.entries(
      rows.reduce((acc, r) => {
        const k = String(r.created_at).slice(0, 7);
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {})
    ).sort((a, b) => a[0].localeCompare(b[0]));

    const byReporter = Object.values(
      rows.reduce((acc, r) => {
        const k = r.reporter_name || "unknown";
        acc[k] = acc[k] || { name: k, raised: 0, resolved: 0 };
        acc[k].raised += 1;
        if (r.status === "resolved") acc[k].resolved += 1;
        return acc;
      }, {})
    ).sort((a, b) => b.raised - a.raised);

    // The page is what the person was doing when it went wrong, which is a
    // better guide to where the platform hurts than the ticket's own wording.
    const byPage = Object.entries(
      rows.reduce((acc, r) => {
        // Record pages carry the record's id, so /patients/<uuid> would split
        // into one-offs and hide that the patient page is where trouble lands.
        const k =
          (r.page_url || "unknown")
            .replace(/^https?:\/\/[^/]+/, "")
            .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
            .replace(/\?.*$/, "") || "/";
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]).slice(0, 8);

    insights = {
      total: rows.length,
      open: rows.filter((r) => r.status === "open").length,
      inProgress: rows.filter((r) => r.status === "in_progress").length,
      resolved: rows.filter((r) => r.status === "resolved").length,
      medianHours: median === null ? null : Math.round(median * 10) / 10,
      byType: tally("error_type"),
      byMonth,
      byReporter,
      byPage,
    };
  }

  return NextResponse.json({ reports: data || [], canTriage: canTriage(staff), insights });
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
