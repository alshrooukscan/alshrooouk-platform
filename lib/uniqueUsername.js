// Mobile numbers aren't guaranteed unique in this business (family members
// share a number), but every username column has a UNIQUE constraint. Using
// mobile as the default username is convenient, but a second person with the
// same number needs a distinguishable username or their credential creation
// fails outright. This resolves the first free "base", "base-2", "base-3"...
export async function resolveUniqueUsername(supabase, table, baseUsername, { excludeId, idColumn = "id" } = {}) {
  let candidate = baseUsername;
  let suffix = 2;
  // Hard cap so a pathological run of collisions can't loop forever.
  for (let attempts = 0; attempts < 50; attempts++) {
    let query = supabase.from(table).select(idColumn).eq("username", candidate).limit(1);
    if (excludeId) query = query.neq(idColumn, excludeId);
    const { data } = await query;
    if (!data || data.length === 0) return candidate;
    candidate = `${baseUsername}-${suffix}`;
    suffix += 1;
  }
  return `${baseUsername}-${Date.now()}`;
}

// Specifically for patient_auth, which has RLS enabled with zero policies -
// the plain client-side check above can never see existing rows there, so
// this goes through a server-side route using the service role key instead.
// Same "base", "base-2", "base-3"... resolution, just able to actually see
// what's taken.
export async function resolvePatientUsername(baseUsername, excludeId, { timeoutMs = 15000 } = {}) {
  // fetch has no default timeout. On a dropped or stalled connection - which
  // is ordinary on clinic wifi - the promise never settles and every caller
  // waits forever. A registration froze on "Registering..." for 34 minutes
  // that way, with the patient and visit already written. Aborting turns that
  // into an error the caller can actually handle.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("/api/patients/resolve-username", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseUsername, excludeId }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to resolve username");
    return data.username;
  } catch (e) {
    if (e?.name === "AbortError") throw new Error("Timed out while checking the portal username.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
