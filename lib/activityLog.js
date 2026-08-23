import { supabase } from "./supabase";

// Item 12: one central log for "who did what, when" across the platform.
// Call this from any client-side mutation. Never throws - a logging failure
// should never block the actual action the user was trying to take.
export async function logActivity({ actorId, actorName, actorType = "employee", action, entityType, entityId, details }) {
  try {
    await supabase.from("activity_log").insert({
      actor_type: actorType,
      actor_id: actorId || null,
      actor_name: actorName || "Unknown",
      action,
      entity_type: entityType,
      entity_id: entityId || null,
      details: details || null,
    });
  } catch (e) {
    console.error("activity log failed", e);
  }
}
