import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasServiceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    hasGoogleKey: !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
    hasRootFolder: !!process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
  });
}
