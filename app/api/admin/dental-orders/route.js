import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireStaff } from "../../../../lib/requireStaff";

function canManage(staff) {
  if (!staff) return false;
  return staff.role === "admin" || staff.permissions?.stock === true;
}

// Resolves the staff member to their employee record, which is what the cash
// ledger is keyed on. Only that link lets collected cash show in Cash In Hand.
async function employeeIdFor(staff) {
  if (!staff?.email) return null;
  const { data } = await supabaseAdmin
    .from("employees")
    .select("id")
    .ilike("staff_account_email", staff.email)
    .maybeSingle();
  return data?.id || null;
}

export async function GET(req) {
  const staff = await requireStaff(req);
  if (!canManage(staff)) {
    return NextResponse.json({ error: "You don't have access to dental stock orders." }, { status: 403 });
  }

  const { data } = await supabaseAdmin
    .from("dental_orders")
    .select("*, doctors(id, name, clinic_code, phone), dental_order_items(*)")
    .order("created_at", { ascending: false });

  return NextResponse.json({ orders: data || [] });
}

export async function POST(req) {
  const staff = await requireStaff(req);
  if (!canManage(staff)) {
    return NextResponse.json({ error: "You don't have access to dental stock orders." }, { status: 403 });
  }

  const body = await req.json();
  const { orderId, action, amount, paymentMethod, note } = body;
  if (!orderId || !action) {
    return NextResponse.json({ error: "orderId and action are required" }, { status: 400 });
  }

  const { data: order } = await supabaseAdmin
    .from("dental_orders")
    .select("*, doctors(name)")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return NextResponse.json({ error: "That order no longer exists." }, { status: 404 });

  const now = new Date().toISOString();

  if (action === "review") {
    if (order.status !== "placed") {
      return NextResponse.json({ error: `This order is already ${order.status}.` }, { status: 409 });
    }
    await supabaseAdmin
      .from("dental_orders")
      .update({ status: "reviewed", reviewed_by_id: staff.id, reviewed_by_name: staff.name, reviewed_at: now, note: note || order.note })
      .eq("id", orderId)
      .eq("status", "placed");
    return NextResponse.json({ ok: true, status: "reviewed" });
  }

  // Stage 4. Delivery is no longer a single button. The order is assigned,
  // goes in transit with a 4-digit code sent to the customer, and only a
  // verified code (or an explicit manager override) closes it. Cash cannot
  // be recorded until that has happened - enforced in the database too.
  if (action === "assign") {
    const { data, error } = await supabaseAdmin.rpc("assign_delivery", {
      p_order_id: orderId,
      p_employee_id: body.employeeId || null,
      p_staff_id: staff.id,
      p_staff_name: staff.name,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await supabaseAdmin.from("activity_log").insert({
      actor_id: staff.id, actor_name: staff.name,
      actor_type: staff.role === "admin" ? "admin" : "employee",
      action: "dental_delivery_assigned", entity_type: "dental_order", entity_id: orderId,
      details: { doctor: order.doctors?.name, assignedTo: data?.assigned_to, source: data?.source },
    });

    // The code is returned so it can be sent to the customer over WhatsApp.
    return NextResponse.json({ ok: true, result: data });
  }

  if (action === "verify") {
    const { data, error } = await supabaseAdmin.rpc("verify_delivery_otp", {
      p_order_id: orderId,
      p_code: String(body.code || "").trim(),
      p_staff_id: staff.id,
      p_staff_name: staff.name,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await supabaseAdmin.from("activity_log").insert({
      actor_id: staff.id, actor_name: staff.name,
      actor_type: staff.role === "admin" ? "admin" : "employee",
      action: "dental_delivery_verified", entity_type: "dental_order", entity_id: orderId,
      details: { doctor: order.doctors?.name },
    });
    return NextResponse.json({ ok: true, result: data });
  }

  if (action === "override") {
    // A14: closing a delivery without the customer's code is a manager act.
    if (staff.role !== "admin" && staff.permissions?.stock !== true) {
      return NextResponse.json(
        { error: "Only a manager can close a delivery without the customer's code." },
        { status: 403 }
      );
    }
    const { data, error } = await supabaseAdmin.rpc("override_delivery", {
      p_order_id: orderId,
      p_reason: body.reason || "",
      p_staff_id: staff.id,
      p_staff_name: staff.name,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await supabaseAdmin.from("activity_log").insert({
      actor_id: staff.id, actor_name: staff.name,
      actor_type: staff.role === "admin" ? "admin" : "employee",
      action: "dental_delivery_overridden", entity_type: "dental_order", entity_id: orderId,
      details: { doctor: order.doctors?.name, reason: body.reason },
    });
    return NextResponse.json({ ok: true, result: data });
  }

  if (action === "cancel") {
    if (order.status === "delivered" || Number(order.amount_paid) > 0) {
      return NextResponse.json(
        { error: "A delivered or part-paid order can't be cancelled. Handle it as a return instead." },
        { status: 409 }
      );
    }
    // Stock left the shelf when the order was placed, so cancelling has to put
    // it back or the shelf count stays permanently short.
    const { data: items } = await supabaseAdmin
      .from("dental_order_items")
      .select("stock_item_id, quantity")
      .eq("order_id", orderId);
    for (const it of items || []) {
      const { data: si } = await supabaseAdmin.from("stock_items").select("qty_remaining").eq("id", it.stock_item_id).maybeSingle();
      if (si) {
        await supabaseAdmin
          .from("stock_items")
          .update({ qty_remaining: Number(si.qty_remaining || 0) + Number(it.quantity || 0) })
          .eq("id", it.stock_item_id);
      }
    }
    await supabaseAdmin.from("dental_orders").update({ status: "cancelled", note: note || order.note }).eq("id", orderId);
    return NextResponse.json({ ok: true, status: "cancelled" });
  }

  if (action === "pay") {
    const amt = Number(amount);
    if (!amt || amt <= 0) return NextResponse.json({ error: "Enter the amount collected." }, { status: 400 });

    const employeeId = await employeeIdFor(staff);
    if (!employeeId && (paymentMethod || "cash").toLowerCase() === "cash") {
      return NextResponse.json(
        { error: "Your staff login isn't linked to an employee record, so cash can't be attributed to you. Ask an admin to link it." },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin.rpc("settle_dental_order", {
      p_order_id: orderId,
      p_amount: amt,
      p_payment_method: paymentMethod || "cash",
      p_staff_id: staff.id,
      p_staff_name: staff.name,
      p_employee_id: employeeId,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await supabaseAdmin.from("activity_log").insert({
      actor_id: staff.id,
      actor_name: staff.name,
      actor_type: staff.role === "admin" ? "admin" : "employee",
      action: "dental_order_payment",
      entity_type: "dental_order",
      entity_id: orderId,
      details: { doctor: order.doctors?.name, amount: amt, method: paymentMethod || "cash" },
    });

    return NextResponse.json({ ok: true, order: data });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
