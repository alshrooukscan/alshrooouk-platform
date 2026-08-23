import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, verifyEmployeeSession } from "../../../../lib/session";

export async function GET() {
  const token = cookies().get("portal_session")?.value;
  const raw = verifySession(token);
  if (!raw) return NextResponse.json({ authenticated: false }, { status: 401 });

  // Employees additionally need their session to still be the live one - a
  // login elsewhere invalidates this token even though its signature is fine.
  if (raw.role === "employee") {
    const session = await verifyEmployeeSession(token);
    if (!session) return NextResponse.json({ authenticated: false, reason: "signed_in_elsewhere" }, { status: 401 });
    return NextResponse.json({ authenticated: true, ...session });
  }

  return NextResponse.json({ authenticated: true, ...raw });
}
