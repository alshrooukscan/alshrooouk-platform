"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";
import Sidebar from "../../components/Sidebar";
import { usePermissions } from "../../lib/usePermissions";
import Loading from "../../lib/Loading";

// Keys here must match what the sidebar offers each person. Where the two
// disagree, staff are shown a link and then refused when they follow it.
const ROUTE_PERMISSION = {
  "/dashboard/patients": "patients",
  "/dashboard/invoices": "patients",
  "/dashboard/doctors": "doctors",
  "/dashboard/reports": "vendors",
  "/dashboard/clients": "vendors",
  "/dashboard/vendors": "vendors",
  "/dashboard/branches": "settings",
  "/dashboard/stock": "stock",
  "/dashboard/hr": "hr",
  "/dashboard/cash-expenses": "cash_expenses",
  "/dashboard/cash-monitor": "cash_monitor",
  "/dashboard/internal-purchases": "internal_purchases",
  "/dashboard/expenses/scan": "expenses_scan",
  "/dashboard/expenses/dental-stock": "expenses_dental_stock",
  "/dashboard/expenses/el3awama-stock": "expenses_el3awama_stock",
  "/dashboard/settings": "settings",
};

// Brands Cash carries all three businesses on one page and shows only the ones
// this person can see, so holding any one of the three is enough to open it.
// A single required key would have shut out someone granted only El3awama.
// Matched before the table below, which is exact-prefix and one key per path.
const ANY_OF_ROUTES = [
  { path: "/dashboard/expenses", keys: ["expenses_scan", "expenses_dental_stock", "expenses_el3awama_stock"] },
];

// Pages everyone signed in may open, whatever their page permissions.
const OPEN_ROUTES = ["/dashboard/action-center", "/dashboard/bug-reports"];

// Admin only, and not grantable by a permission key. These are not in the table
// above, so without this they would fall through to "no permission required".
// Cash Monitor and Internal Purchases were made grantable - the sidebar offers
// them and the pages honour the key - but they were still listed here, so a
// person granted the permission saw the link, clicked it, and was refused by
// the layout. They are gated by their own keys now, like every other page.
const ADMIN_ROUTES = ["/dashboard/exports", "/dashboard/expenses/brand-transfer", "/dashboard/paymob"];

function permissionForPath(pathname) {
  if (OPEN_ROUTES.some((p) => pathname.startsWith(p))) return null;

  // "/dashboard" is matched EXACTLY. It used to be in the table above and
  // matched as a prefix, so every route not listed - invoices, reports,
  // clients, the cash pages, the Action Center - fell through to it and
  // demanded the dashboard permission. No staff account has that permission,
  // so all of those pages refused everyone but an admin, while the sidebar
  // went on offering them.
  if (pathname === "/dashboard") return "dashboard";

  // The old per-brand routes are still in the table and are longer, so they
  // keep their own single-key guard; only the merged path lands here.
  const anyOf = ANY_OF_ROUTES.find((r) => pathname === r.path);
  if (anyOf) return { anyOf: anyOf.keys };

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
  const adminOnly = ADMIN_ROUTES.some((p) => pathname.startsWith(p));
  const lacksRequired = required?.anyOf
    ? !required.anyOf.some((k) => can(k))
    : !!required && !can(required);
  const denied = ready && !permsLoading && (lacksRequired || (adminOnly && profile?.role !== "admin"));

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
