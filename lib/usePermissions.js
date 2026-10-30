"use client";
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

// One profile load per page, shared by every component that calls this hook
// (layout, sidebar, page and its tabs). It used to run a network auth.getUser()
// plus a staff_profiles read in each of them, one after another, before any
// page data could start (performance review P-03). getSession() reads the
// signed-in session locally; the database still enforces access on every query.
let shared = null; // { promise, at }
if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((event) => {
    if (event !== "TOKEN_REFRESHED") shared = null;
  });
}
function loadShared() {
  const run = async () => {
    const { data } = await supabase.auth.getSession();
    const user = data?.session?.user;
    if (!user) return { profile: null, linkedEmployeeId: null };
    const { data: prof } = await supabase.from("staff_profiles").select("*").eq("id", user.id).maybeSingle();
    return { profile: prof, linkedEmployeeId: user.user_metadata?.employee_id || null, userId: user.id };
  };
  // Shared for a minute, so moving between pages still picks up a
  // permission change an admin just made, as it did before.
  if (!shared || Date.now() - shared.at > 60000) {
    const promise = run().catch((e) => { shared = null; throw e; });
    shared = { promise, at: Date.now() };
  }
  return shared.promise;
}

export function usePermissions() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [linkedEmployeeId, setLinkedEmployeeId] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const r = await loadShared();
      setProfile(r.profile);
      // Present only for staff accounts provisioned via employee elevation
      // (Staff Dashboard Access) - lets the sidebar offer a way back to their
      // own employee portal without a second login.
      setLinkedEmployeeId(r.linkedEmployeeId);
    } finally {
      setLoading(false);
    }
  }

  function can(module) {
    if (!profile) return false;
    if (profile.role === "admin") return true;
    return !!profile.permissions?.[module];
  }

  return { profile, loading, can, isAdmin: profile?.role === "admin", linkedEmployeeId };
}
