import { createClient } from "@supabase/supabase-js";

let _client = null;

function getClient() {
  if (!_client) {
    // The URL itself isn't a secret (it's already public in every browser request),
    // so a hardcoded fallback here is safe. NEXT_PUBLIC_ vars have proven unreliable
    // at actual serverless runtime for this deployment method, even though regular
    // secrets like SUPABASE_SERVICE_ROLE_KEY do come through correctly.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://shsotkryegamrxulsjww.supabase.co";
    _client = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _client;
}

// A Proxy defers actually constructing the Supabase client until something on it
// is used at request time, so importing this module during Next.js's build-time
// page-data collection (when env vars aren't available) never crashes the build.
export const supabaseAdmin = new Proxy(
  {},
  {
    get(_target, prop) {
      return getClient()[prop];
    },
  }
);
