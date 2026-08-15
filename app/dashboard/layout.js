"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";
import Sidebar from "../../components/Sidebar";

export default function DashboardLayout({ children }) {
  const [ready, setReady] = useState(false);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/login");
      } else {
        setReady(true);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace("/login");
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  if (!ready) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: theme.navy }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: theme.bg }}>
      <Sidebar />
      <main style={{ flex: 1, padding: 32 }}>{children}</main>
    </div>
  );
}
