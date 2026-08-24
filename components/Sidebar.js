"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../lib/supabase";
import { theme } from "../lib/theme";
import { usePermissions } from "../lib/usePermissions";

// A "link" item is a single nav entry. A "group" item is a section header
// (Scan, Stock) with its own sub-items indented beneath it - not clickable
// itself, no single page represents "all of Scan" or "all of Stock".
const NAV = [
  { type: "link", href: "/dashboard", label: "Dashboard", icon: "\u25A6", key: "dashboard" },
  {
    type: "group",
    label: "Scan",
    icon: "\u25C9",
    items: [
      { href: "/dashboard/patients", label: "Patient", icon: "\u25CB", key: "patients" },
      { href: "/dashboard/doctors", label: "Doctor", icon: "\u2695", key: "doctors" },
      { href: "/dashboard/cash-expenses", label: "Cash Expenses", icon: "\u26AA", key: "cash_expenses" },
      { href: "/dashboard/vendors", label: "External Vendors", icon: "\u2709", key: "vendors" },
    ],
  },
  {
    type: "group",
    label: "Stock",
    icon: "\u25A4",
    items: [
      { href: "/dashboard/stock?category=dental", label: "Dental Stock", icon: "\u25A4", key: "stock" },
      { href: "/dashboard/stock?category=el3awama", label: "El3awama Stock", icon: "\u25A4", key: "stock" },
    ],
  },
  { type: "link", href: "/dashboard/hr", label: "HR", icon: "\u25A3", key: "hr" },
  { type: "link", href: "/dashboard/settings", label: "Settings", icon: "\u2699", key: "settings" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
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

  // For a link: visible if permitted. For a group: visible if at least one
  // child is permitted, and only the permitted children are shown.
  const visibleNav = NAV.map((item) => {
    if (item.type === "link") {
      return loading || can(item.key) ? item : null;
    }
    const visibleItems = item.items.filter((child) => loading || can(child.key));
    return visibleItems.length > 0 ? { ...item, items: visibleItems } : null;
  }).filter(Boolean);

  function isChildActive(child) {
    // /dashboard/stock?category=dental should be "active" when pathname matches
    // and, if the link itself carries a category, the current querystring agrees.
    // Reads via useSearchParams() so this actually updates on client navigation
    // between two links that share the same path but differ only in query string.
    const [childPath, childQuery] = child.href.split("?");
    if (pathname !== childPath) return false;
    if (!childQuery) return true;
    const [qKey, qVal] = childQuery.split("=");
    return searchParams.get(qKey) === qVal;
  }

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
          if (item.type === "link") {
            const active = pathname === item.href;
            return <NavLink key={item.href} item={item} active={active} collapsed={collapsed} />;
          }
          // Group: a non-clickable section label, followed by its indented children.
          return (
            <div key={item.label} style={{ marginBottom: 4 }}>
              {!collapsed && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 12px 4px",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 1,
                    color: "rgba(255,255,255,0.45)",
                    textTransform: "uppercase",
                  }}
                >
                  <span>{item.icon}</span>
                  {item.label}
                </div>
              )}
              {item.items.map((child) => (
                <NavLink key={child.href} item={child} active={isChildActive(child)} collapsed={collapsed} indent={!collapsed} />
              ))}
            </div>
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

function NavLink({ item, active, collapsed, indent }) {
  return (
    <Link
      href={item.href}
      title={item.label}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: collapsed ? "center" : "flex-start",
        gap: 10,
        padding: collapsed ? "12px 0" : "9px 12px",
        marginBottom: 3,
        marginLeft: indent ? 10 : 0,
        borderRadius: 8,
        textDecoration: "none",
        color: active ? theme.navy : "#e8e6f0",
        background: active ? `linear-gradient(135deg, ${theme.gold}, ${theme.goldLight})` : "transparent",
        fontWeight: active ? 700 : 500,
        fontSize: collapsed ? 18 : 13,
      }}
    >
      <span>{item.icon}</span>
      {!collapsed && item.label}
    </Link>
  );
}
