import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "../../../../lib/session";

export async function GET() {
  const token = cookies().get("portal_session")?.value;
  const session = verifySession(token);
  if (!session) return NextResponse.json({ authenticated: false }, { status: 401 });
  return NextResponse.json({ authenticated: true, ...session });
}
