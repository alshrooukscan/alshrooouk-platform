import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

// Read-only catalogue browse. Out-of-stock items are deliberately included:
// the doctor can still order them and they are delivered when they arrive.
// Hiding them meant a doctor had no way to ask for something that had simply
// run out, and no way to see it existed at all.
//
// qty_available is what is on the shelf minus what is already promised to
// other placed orders, so two doctors cannot be sold the same box.
export async function GET() {
  const token = cookies().get("portal_session")?.value;
  const session = verifySession(token);
  if (!session || session.role !== "doctor") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: items } = await supabaseAdmin
    .from("stock_items")
    .select("id, name, sale_price, image_url, qty_remaining, qty_reserved")
    .eq("category", "dental")
    .order("name");

  const withAvailability = (items || []).map((it) => ({
    id: it.id,
    name: it.name,
    sale_price: it.sale_price,
    image_url: it.image_url,
    qty_available: Math.max(Number(it.qty_remaining || 0) - Number(it.qty_reserved || 0), 0),
  }));

  return NextResponse.json({ items: withAvailability });
}
