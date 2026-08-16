"use client";
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export function usePermissions() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: session } = await supabase.auth.getUser();
    if (!session?.user) {
      setLoading(false);
      return;
    }
    const { data } = await supabase.from("staff_profiles").select("*").eq("id", session.user.id).maybeSingle();
    setProfile(data);
    setLoading(false);
  }

  function can(module) {
    if (!profile) return false;
    if (profile.role === "admin") return true;
    return !!profile.permissions?.[module];
  }

  return { profile, loading, can, isAdmin: profile?.role === "admin" };
}
