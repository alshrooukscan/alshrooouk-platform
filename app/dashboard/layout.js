"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";
import Sidebar from "../../components/Sidebar";
import { usePermissions } from "../../lib/usePermissions";
import Loading from "../../lib/Loading";

const ROUTE_PERMISSION = {
  "/dashboard": "dashboard",
  "/dashboard/patients": "patients",
  "/dashboard/doctors": "doctors",
  "/dashboard/stock": "stock",
  "/dashboard/hr": "hr",
  "/dashboard/settings": "settings",
};

function permissionForPath(pathname) {
  const match = Object.keys(ROUTE_PERMISSION)
    .sort((a, b) => b.length - a.length)
    .find((p) => pathname.startsWith(p));
  return match ? ROUTE_PERMISSION[match] : null;
}

export default function DashboardLayout({ children }) {
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { can, loading: permsLoading, profile } = usePermissions();

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

  const required = permissionForPath(pathname);
  const denied = ready && !permsLoading && required && !can(required);

  if (!ready || permsLoading) {
    return <Loading />;
  }

  if (!profile) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: theme.navy, textAlign: "center", padding: 24 }}>
        Your account isn't set up with access yet. Ask an admin to add you in Settings &gt; Staff Users.
      </div>
    );
  }

  if (denied) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", background: theme.bg }}>
        <Sidebar />
        <main style={{ flex: 1, padding: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center", color: theme.gray }}>
            <h2 style={{ color: theme.navy }}>Access restricted</h2>
            <p>You don't have permission to view this section. Ask an admin to grant access.</p>
          </div>
        </main>
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
