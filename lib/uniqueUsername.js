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
