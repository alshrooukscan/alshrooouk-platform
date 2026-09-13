import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { requireStaff } from "../../../lib/requireStaff";

// Section 7, Phase 1. Read-only in every sense: the timeline underneath is a
// view, so nothing here can alter a visit. It measures the workflow that
// already exists rather than imposing a new one.
export async function GET(req) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const isAllowed = staff.role === "admin" || staff.permissions?.hr === true || staff.permissions?.patients === true;
  if (!isAllowed) return NextResponse.json({ error: "You don't have access to the workflow board." }, { status: 403 });

  const url = new URL(req.url);
  const days = Math.min(Math.max(Number(url.searchParams.get("days") || 14), 1), 90);

  const [{ data: board, error: be }, { data: sla, error: se }] = await Promise.all([
    supabaseAdmin.rpc("workflow_board", { p_days: days }),
    supabaseAdmin.rpc("workflow_sla_summary", { p_days: days }),
  ]);
  if (be || se) {
    return NextResponse.json({ error: (be || se).message }, { status: 500 });
  }

  const rows = board || [];
  return NextResponse.json({
    days,
    sla: sla || [],
    open: rows.filter((r) => r.status === "open"),
    recent_done: rows.filter((r) => r.status === "done").slice(0, 40),
    counts: {
      open: rows.filter((r) => r.status === "open").length,
      open_breached: rows.filter((r) => r.status === "open" && r.breached).length,
      done: rows.filter((r) => r.status === "done").length,
    },
  });
}
