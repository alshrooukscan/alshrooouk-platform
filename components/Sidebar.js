"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";
import { theme } from "../lib/theme";
import { usePermissions } from "../lib/usePermissions";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "\u25A6", key: "dashboard" },
  { href: "/dashboard/patients", label: "Patients", icon: "\u25CB", key: "patients" },
  { href: "/dashboard/doctors", label: "Doctors", icon: "\u2695", key: "doctors" },
  { href: "/dashboard/stock", label: "Stock", icon: "\u25A4", key: "stock" },
  { href: "/dashboard/hr", label: "HR", icon: "\u25A3", key: "hr" },
  { href: "/dashboard/settings", label: "Settings", icon: "\u2699", key: "settings" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { can, profile, loading } = usePermissions();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const visibleNav = NAV.filter((item) => loading || can(item.key));

  return (
    <aside
      style={{
        width: 260,
        background: theme.navy,
        color: "#fff",
        minHeight: "100vh",
        padding: "24px 16px",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
      }}
    >
      <div style={{ marginBottom: 32, paddingLeft: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 17 }}>Al Shrooouk</div>
        <div style={{ fontSize: 11, letterSpacing: 1, color: theme.goldLight }}>SCAN &amp; LAB</div>
      </div>

      <nav style={{ flex: 1 }}>
        {visibleNav.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                marginBottom: 4,
                borderRadius: 8,
                textDecoration: "none",
                color: active ? theme.navy : "#e8e6f0",
                background: active
                  ? `linear-gradient(135deg, ${theme.gold}, ${theme.goldLight})`
                  : "transparent",
                fontWeight: active ? 700 : 500,
                fontSize: 14,
              }}
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {profile && (
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 8, paddingLeft: 4 }}>
          {profile.name} &middot; {profile.role}
        </div>
      )}
      <button
        onClick={handleLogout}
        style={{
          background: "transparent",
          border: "1px solid rgba(255,255,255,0.2)",
          color: "#fff",
          borderRadius: 8,
          padding: "10px 12px",
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        Log Out
      </button>
    </aside>
  );
}
