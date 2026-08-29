import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

// Read-only catalog browse - only active items with stock on hand are shown,
// matching what an e-commerce catalog would do rather than exposing the full
// admin inventory list including things that are out of stock or retired.
export async function GET() {
  const token = cookies().get("portal_session")?.value;
  const session = verifySession(token);
  if (!session || session.role !== "doctor") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: items } = await supabaseAdmin
    .from("stock_items")
    .select("id, name, sale_price, image_url, qty_remaining")
    .eq("category", "dental")
    .gt("qty_remaining", 0)
    .order("name");

  return NextResponse.json({ items: items || [] });
}
