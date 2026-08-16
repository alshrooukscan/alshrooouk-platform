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
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    function check() {
      setIsMobile(window.innerWidth < 768);
    }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const visibleNav = NAV.filter((item) => loading || can(item.key));

  return (
    <aside
      style={{
        width: isMobile ? 64 : 260,
        background: theme.navy,
        color: "#fff",
        minHeight: "100vh",
        padding: isMobile ? "16px 8px" : "24px 16px",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        alignItems: isMobile ? "center" : "stretch",
        transition: "width 0.15s ease",
        flexShrink: 0,
      }}
    >
      <div style={{ marginBottom: isMobile ? 20 : 32, paddingLeft: isMobile ? 0 : 8, textAlign: isMobile ? "center" : "left" }}>
        <img src="/logo-mark.png" alt="Al Shrooouk" style={{ height: isMobile ? 36 : 44, width: "auto", display: "block", margin: isMobile ? "0 auto" : "0 0 6px 0" }} />
        {!isMobile && (
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
                justifyContent: isMobile ? "center" : "flex-start",
                gap: 10,
                padding: isMobile ? "12px 0" : "10px 12px",
                marginBottom: 4,
                borderRadius: 8,
                textDecoration: "none",
                color: active ? theme.navy : "#e8e6f0",
                background: active
                  ? `linear-gradient(135deg, ${theme.gold}, ${theme.goldLight})`
                  : "transparent",
                fontWeight: active ? 700 : 500,
                fontSize: isMobile ? 18 : 14,
              }}
            >
              <span>{item.icon}</span>
              {!isMobile && item.label}
            </Link>
          );
        })}
      </nav>

      {profile && !isMobile && (
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
          padding: isMobile ? "10px" : "10px 12px",
          cursor: "pointer",
          fontSize: isMobile ? 16 : 13,
          width: isMobile ? 40 : "100%",
        }}
      >
        {isMobile ? "\u23FB" : "Log Out"}
      </button>
    </aside>
  );
}
