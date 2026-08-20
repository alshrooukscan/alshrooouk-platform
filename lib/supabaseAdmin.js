import { createClient } from "@supabase/supabase-js";

let _client = null;

function getClient() {
  if (!_client) {
    _client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
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
