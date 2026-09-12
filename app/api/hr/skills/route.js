import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireStaff } from "../../../../lib/requireStaff";

// Skills were assignable only by writing SQL by hand, yet they are not
// cosmetic: employee_cash_keeper_streams is a view over employee_skills, and
// that view decides whether payroll sweeps an employee's cash at the end of
// the month. A setting with that much consequence needs a screen.

const CASH_KEEPER_KEYS = ["cash_keeper_scan", "cash_keeper_material", "cash_keeper_fnb"];

function canHr(staff) {
  return staff && (staff.role === "admin" || staff.permissions?.hr === true);
}

// GET ?employeeId=<id>  -> every skill, flagged with whether this person holds it
export async function GET(req) {
  const staff = await requireStaff(req);
  if (!canHr(staff)) return NextResponse.json({ error: "HR access required." }, { status: 403 });

  const employeeId = new URL(req.url).searchParams.get("employeeId");
  if (!employeeId) return NextResponse.json({ error: "Employee is required." }, { status: 400 });

  const [{ data: all }, { data: held }, { data: streams }] = await Promise.all([
    supabaseAdmin.from("skills").select("*").order("category").order("label"),
    supabaseAdmin
      .from("employee_skills")
      .select("id, skill_id, granted_by_name, granted_at")
      .eq("employee_id", employeeId),
    supabaseAdmin.from("employee_cash_keeper_streams").select("brand").eq("employee_id", employeeId),
  ]);

  const heldBy = new Map((held || []).map((h) => [h.skill_id, h]));
  const skills = (all || []).map((s) => ({
    ...s,
    held: heldBy.has(s.id),
    granted_by_name: heldBy.get(s.id)?.granted_by_name || null,
    granted_at: heldBy.get(s.id)?.granted_at || null,
    is_cash_keeper: CASH_KEEPER_KEYS.includes(s.key),
  }));

  // What the person is currently holding, so revoking a Cash Keeper skill is
  // never a blind click.
  const { data: balances } = await supabaseAdmin
    .from("employee_cash_balances")
    .select("brand, balance")
    .eq("employee_id", employeeId);

  return NextResponse.json({
    skills,
    exempt_streams: (streams || []).map((s) => s.brand),
    cash_balances: (balances || []).filter((b) => Number(b.balance) > 0),
  });
}

export async function POST(req) {
  const staff = await requireStaff(req);
  if (!canHr(staff)) return NextResponse.json({ error: "HR access required." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { employeeId, skillId, action } = body;
  if (!employeeId || !skillId) {
    return NextResponse.json({ error: "Employee and skill are required." }, { status: 400 });
  }

  const { data: skill } = await supabaseAdmin
    .from("skills")
    .select("id, key, label")
    .eq("id", skillId)
    .maybeSingle();
  if (!skill) return NextResponse.json({ error: "That skill no longer exists." }, { status: 404 });

  // Granting or revoking a Cash Keeper skill changes what payroll does with
  // real money, so only an admin may move one.
  if (CASH_KEEPER_KEYS.includes(skill.key) && staff.role !== "admin") {
    return NextResponse.json(
      { error: "Only an admin can change a Cash Keeper skill. It decides whether payroll sweeps this person's cash." },
      { status: 403 }
    );
  }

  if (action === "revoke") {
    const { error } = await supabaseAdmin
      .from("employee_skills")
      .delete()
      .eq("employee_id", employeeId)
      .eq("skill_id", skillId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  } else {
    const { error } = await supabaseAdmin.from("employee_skills").insert({
      employee_id: employeeId,
      skill_id: skillId,
      granted_by_id: staff.id || null,
      granted_by_name: staff.name || "Unknown",
    });
    // Granting a skill someone already holds is not an error worth showing.
    if (error && error.code !== "23505") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  try {
    await supabaseAdmin.from("activity_log").insert({
      actor_type: staff.role === "admin" ? "admin" : "employee",
      actor_id: staff.id || null,
      actor_name: staff.name || "Unknown",
      action: action === "revoke" ? "skill_revoked" : "skill_granted",
      entity_type: "employee",
      entity_id: employeeId,
      details: { skill: skill.key, label: skill.label },
    });
  } catch (e) {
    console.error("skill activity log failed", e);
  }

  return NextResponse.json({ ok: true });
}
