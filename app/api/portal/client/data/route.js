import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "../../../../../lib/session";
import { buildAccountEntries } from "../../../../../lib/arStatement";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";


// Records are withheld until the account is off its staff-issued temporary
// password. The redirect on the portal page is only a client-side courtesy;
// on its own it left this data reachable by calling the route directly with a
// temporary password that had travelled over WhatsApp and may be sitting in
// someone else's chat history.
//
// Returns 200 with mustChangePassword set rather than an error status, because
// the portal page reads exactly this response to decide to redirect - failing
// the request would strand the person on a broken screen instead of sending
// them to the form that fixes it.
function passwordChangeRequired() {
  return NextResponse.json({ mustChangePassword: true, gated: true });
}

export async function GET() {
  const token = cookies().get("portal_session")?.value;
  const session = verifySession(token);
  if (!session || session.role !== "client") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: client } = await supabaseAdmin.from("clients").select("id, name, contact_phone, contact_email, must_change_password, logo_url").eq("id", session.id).single();
  const { data: reports } = await supabaseAdmin
    .from("reports")
    .select("id, scan_name, request_note, date_required, status, client_uploaded_file_name, report_file_url, report_file_name, report_files, created_at, completed_at")
    .eq("client_id", session.id)
    .order("created_at", { ascending: false });

  // Checked fresh from the database, not read from the session token. The
  // token's must-change value is a snapshot from login time - if it said
  // true then, and the client changed their password since, the token still
  // says true until they log in again. Trusting it here would send them
  // into a loop, back to the change-password screen even after completing it.
    // Impersonating admins are exempt: they are inspecting the account, not
  // using it, and cannot set someone else's password.
  if (!session.impersonated && client?.must_change_password) return passwordChangeRequired();
  // Scan types the client can ask for (those that need a report), and each
  // request shown under the scan type it resolves to: "cbctq" and "cbct q"
  // both read "3D CBCT Quadrant" (Mohamed Said, 30 Oct 2026).
  const { data: types } = await supabaseAdmin
    .from("exam_types").select("name, name_aliases, counts_in_report_baseline, default_client_report_price, is_active").eq("is_active", true);
  const byName = new Map();
  for (const t of types || []) {
    byName.set(t.name.trim().toLowerCase(), t.name);
    for (const a of t.name_aliases || []) if (!byName.has(a.trim().toLowerCase())) byName.set(a.trim().toLowerCase(), t.name);
  }
  // Only the scans eligible for reports in the Reports Rule Center.
  const eligible = (types || []).filter((t) => t.counts_in_report_baseline);
  const { data: myPrices } = await supabaseAdmin
    .from("client_report_prices").select("price, exam_types(name)").eq("client_id", session.id);
  const priceByName = Object.fromEntries((myPrices || []).map((p) => [p.exam_types?.name, Number(p.price)]));
  // Each scan type with this client's report price, shown as they choose it.
  const scanTypes = eligible
    .map((t) => ({ name: t.name, price: priceByName[t.name] ?? (t.default_client_report_price != null ? Number(t.default_client_report_price) : null) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // What they owe us and what it is made of, the same lines reception prints.
  let account = { entries: [], totals: { balance: 0 } };
  try { account = await buildAccountEntries([{ type: "client", id: session.id }]); } catch {}
  let openFrom = 0;
  account.entries.forEach((e, i) => { if (e.running <= 0.005) openFrom = i + 1; });
  const trim = (e) => ({ id: e.id, date: e.date, brand: e.brand, kind: e.kind, label: e.label, receipt_no: e.receipt_no,
    payment_method: e.payment_method, note: e.note, amount: e.amount, lines: e.lines, difference: e.difference, running: e.running });
  const shaped = (reports || []).map((r) => ({ ...r, scan_type_name: byName.get(String(r.scan_name || "").trim().toLowerCase()) || null }));

  return NextResponse.json({ client, reports: shaped, scanTypes,
    owes: Math.round(Number(account.totals.balance || 0) * 100) / 100,
    accountOpen: account.entries.slice(openFrom).map(trim),
    accountHistory: account.entries.slice(Math.max(0, openFrom - 40), openFrom).map(trim), mustChangePassword: session.impersonated ? false : !!client?.must_change_password, impersonatedBy: session.impersonatedBy || null });
}
