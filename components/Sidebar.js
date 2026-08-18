"use client";
import { useEffect, useState } from "react";
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
  const [isNarrowScreen, setIsNarrowScreen] = useState(false);
  const [manuallyCollapsed, setManuallyCollapsed] = useState(false);

  useEffect(() => {
    function check() {
      setIsNarrowScreen(window.innerWidth < 768);
    }
    check();
    window.addEventListener("resize", check);
    const saved = window.localStorage.getItem("sidebar_collapsed");
    if (saved === "true") setManuallyCollapsed(true);
    return () => window.removeEventListener("resize", check);
  }, []);

  function toggleCollapse() {
    setManuallyCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem("sidebar_collapsed", String(next));
      return next;
    });
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const collapsed = isNarrowScreen || manuallyCollapsed;
  const visibleNav = NAV.filter((item) => loading || can(item.key));

  return (
    <aside
      style={{
        width: collapsed ? 64 : 260,
        background: theme.navy,
        color: "#fff",
        minHeight: "100vh",
        padding: collapsed ? "16px 8px" : "24px 16px",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        alignItems: collapsed ? "center" : "stretch",
        transition: "width 0.15s ease",
        flexShrink: 0,
        position: "relative",
      }}
    >
      {!isNarrowScreen && (
        <button
          onClick={toggleCollapse}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{
            position: "absolute",
            top: 18,
            right: collapsed ? "50%" : 14,
            transform: collapsed ? "translateX(50%)" : "none",
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.15)",
            color: "#fff",
            borderRadius: 6,
            width: 24,
            height: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            fontSize: 12,
            zIndex: 2,
          }}
        >
          {collapsed ? "\u203A" : "\u2039"}
        </button>
      )}

      <div style={{ marginBottom: collapsed ? 20 : 32, marginTop: collapsed ? 28 : 0, paddingLeft: collapsed ? 0 : 8, textAlign: collapsed ? "center" : "left" }}>
        <img src="/logo-mark.png" alt="Al Shrooouk" style={{ height: collapsed ? 36 : 44, width: "auto", display: "block", margin: collapsed ? "0 auto" : "0 0 6px 0" }} />
        {!collapsed && (
          <>
            <div style={{ fontWeight: 700, fontSize: 17, marginTop: 6 }}>Al Shrooouk</div>
            <div style={{ fontSize: 11, letterSpacing: 1, color: theme.goldLight }}>SCAN &amp; LAB</div>
          </>
        )}
      </div>

      <nav style={{ flex: 1, width: "100%" }}>
        {visibleNav.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: collapsed ? "center" : "flex-start",
                gap: 10,
                padding: collapsed ? "12px 0" : "10px 12px",
                marginBottom: 4,
                borderRadius: 8,
                textDecoration: "none",
                color: active ? theme.navy : "#e8e6f0",
                background: active
                  ? `linear-gradient(135deg, ${theme.gold}, ${theme.goldLight})`
                  : "transparent",
                fontWeight: active ? 700 : 500,
                fontSize: collapsed ? 18 : 14,
              }}
            >
              <span>{item.icon}</span>
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>

      {profile && !collapsed && (
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 8, paddingLeft: 4 }}>
          {profile.name} &middot; {profile.role}
        </div>
      )}
      <button
        onClick={handleLogout}
        title="Log Out"
        style={{
          background: "transparent",
          border: "1px solid rgba(255,255,255,0.2)",
          color: "#fff",
          borderRadius: 8,
          padding: collapsed ? "10px" : "10px 12px",
          cursor: "pointer",
          fontSize: collapsed ? 16 : 13,
          width: collapsed ? 40 : "100%",
        }}
      >
        {collapsed ? "\u23FB" : "Log Out"}
      </button>
    </aside>
  );
}
