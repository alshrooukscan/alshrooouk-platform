import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { requireStaff } from "../../../lib/requireStaff";

function canSell(staff) {
  if (!staff) return false;
  return staff.role === "admin" || staff.permissions?.stock === true || staff.permissions?.reception === true;
}

async function employeeIdFor(staff) {
  if (!staff?.email) return null;
  const { data } = await supabaseAdmin
    .from("employees").select("id").ilike("staff_account_email", staff.email).maybeSingle();
  return data?.id || null;
}

// GET: everything the counter screen needs in one call - sellable stock for
// the chosen business, staff who may use a tab, and each of their remaining
// spend capacity for today.
export async function GET(req) {
  const staff = await requireStaff(req);
  if (!canSell(staff)) {
    return NextResponse.json({ error: "You don't have access to counter sales." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const brand = searchParams.get("brand") === "dental_stock" ? "dental_stock" : "el3awama_stock";
  const category = brand === "dental_stock" ? "dental" : "el3awama";

  const [{ data: items }, { data: employees }, { data: doctors }] = await Promise.all([
    supabaseAdmin
      .from("stock_items")
      .select("id, name, item_code, sale_price, qty_remaining")
      .eq("category", category)
      .gt("qty_remaining", 0)
      .order("name"),
    supabaseAdmin
      .from("employees")
      .select("id, name, role, fnb_tab_enabled, staff_discount_percent, tab_pin_hash")
      .eq("is_active", true)
      .order("name"),
    supabaseAdmin.from("doctors").select("id, name, clinic_name").order("name"),
  ]);

  // Capacity is per employee and changes through the day as they work, so it
  // is computed live rather than cached.
  const staffRows = [];
  for (const e of employees || []) {
    let remaining = 0;
    if (e.fnb_tab_enabled) {
      const { data: cap } = await supabaseAdmin.rpc("employee_spend_capacity", { p_employee_id: e.id });
      remaining = Number(cap?.remaining || 0);
    }
    staffRows.push({
      id: e.id,
      name: e.name,
      role: e.role,
      tab_enabled: !!e.fnb_tab_enabled,
      has_pin: !!e.tab_pin_hash,
      discount_percent: Number(e.staff_discount_percent || 0),
      remaining,
    });
  }

  return NextResponse.json({ items: items || [], staff: staffRows, doctors: doctors || [] });
}

export async function POST(req) {
  const staff = await requireStaff(req);
  if (!canSell(staff)) {
    return NextResponse.json({ error: "You don't have access to counter sales." }, { status: 403 });
  }

  const body = await req.json();

  // Setting or resetting a staff PIN is an admin act - it controls what that
  // person can spend against their own salary.
  if (body.action === "set_pin") {
    if (staff.role !== "admin") {
      return NextResponse.json({ error: "Only an admin can set a staff tab PIN." }, { status: 403 });
    }
    const { error } = await supabaseAdmin.rpc("set_tab_pin", {
      p_employee_id: body.employeeId,
      p_pin: String(body.pin || ""),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await supabaseAdmin.from("activity_log").insert({
      actor_id: staff.id, actor_name: staff.name, actor_type: "admin",
      action: "staff_tab_pin_set", entity_type: "employee", entity_id: body.employeeId,
      details: {},   // never log the PIN itself
    });
    return NextResponse.json({ ok: true });
  }

  const { brand, items, paymentMethod, customerType, customerId, employeeId, tabPin, note } = body;
  if (!brand || !Array.isArray(items) || items.length === 0 || !paymentMethod) {
    return NextResponse.json({ error: "brand, items and paymentMethod are required" }, { status: 400 });
  }

  let collectedBy = null;
  if (paymentMethod === "cash") {
    collectedBy = body.collectedByEmployeeId || (await employeeIdFor(staff));
    if (!collectedBy) {
      return NextResponse.json(
        { error: "Cash sales must record who took the money. Your login isn't linked to an employee record - ask an admin to link it, or pick who collected it." },
        { status: 400 }
      );
    }
  }

  const { data, error } = await supabaseAdmin.rpc("record_counter_sale", {
    p_brand: brand,
    p_sale_type: paymentMethod === "staff_tab" ? "staff_tab" : "walk_in",
    p_items: items,
    p_payment_method: paymentMethod,
    p_customer_type: customerType || null,
    p_customer_id: customerId || null,
    p_employee_id: employeeId || null,
    p_tab_pin: tabPin || null,
    p_collected_by: collectedBy,
    p_staff_id: staff.id,
    p_staff_name: staff.name,
    p_note: note || null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await supabaseAdmin.from("activity_log").insert({
    actor_id: staff.id, actor_name: staff.name,
    actor_type: staff.role === "admin" ? "admin" : "employee",
    action: "counter_sale_recorded", entity_type: "counter_sale", entity_id: data?.sale_id || null,
    details: { brand, method: paymentMethod, net: data?.net, receipt: data?.receipt_no },
  });

  return NextResponse.json({ ok: true, result: data });
}
