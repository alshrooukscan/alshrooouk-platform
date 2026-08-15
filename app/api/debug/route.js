import { NextResponse } from "next/server";

export async function GET() {
  const steps = {};
  try {
    const { supabaseAdmin } = await import("../../../../lib/supabaseAdmin");
    steps.supabaseAdminImported = !!supabaseAdmin;
    steps.supabaseAdminHasFrom = typeof supabaseAdmin?.from;

    const { data, error } = await supabaseAdmin.from("branches").select("id").limit(1);
    steps.queryResult = { data, error };
  } catch (e) {
    steps.error = e.message;
  }

  try {
    const { google } = await import("googleapis");
    steps.googleapisImported = !!google;
    const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    steps.keyParsed = !!key.client_email;
    const auth = new google.auth.GoogleAuth({ credentials: key, scopes: ["https://www.googleapis.com/auth/drive"] });
    const drive = google.drive({ version: "v3", auth });
    steps.driveClientCreated = !!drive;
    const test = await drive.about.get({ fields: "user" });
    steps.driveAboutTest = test.data;
  } catch (e) {
    steps.driveError = e.message;
  }

  return NextResponse.json(steps);
}
