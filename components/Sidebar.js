"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../lib/supabase";
import { theme } from "../lib/theme";
import { usePermissions } from "../lib/usePermissions";
import {
  LayoutDashboard,
  ScanLine,
  User,
  Stethoscope,
  Wallet,
  Handshake,
  Boxes,
  Smile,
  Package,
  Users,
  UserPlus,
  Receipt,
  ClipboardList,
  Building2,
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronRight,
  LogOut,
  ExternalLink,
  Banknote,
  ArrowLeftRight,
  ListChecks,
  ShoppingBag,
  FileCheck2,
  LifeBuoy,
  Download,
} from "lucide-react";

// A "link" item is a single nav entry. A "group" item is a section header
// (Scan, Stock) with its own sub-items indented beneath it - not clickable
// itself, no single page represents "all of Scan" or "all of Stock".
// Icons are real components chosen to match each label's actual meaning
// (a person for Patient, a stethoscope for Doctor, a wallet for Cash Expenses)
// rather than generic shapes.
const NAV = [
  { type: "link", href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, key: "dashboard" },
  // No permission key restricts this - every staff member can see their own
  // tasks here regardless of role; the page itself further gates the
  // approvals section to admin only, the same way other pages gate specific
  // sections rather than the whole route.
  { type: "link", href: "/dashboard/action-center", label: "Action Center", icon: ListChecks, alwaysVisible: true },
  // Everyone can report a problem, including staff whose page access is
  // otherwise narrow - the whole point is to hear from the people who hit
  // the fault. The page itself shows only your own reports unless you are
  // the named owner of the list.
  { type: "link", href: "/dashboard/bug-reports", label: "Report a Problem", icon: LifeBuoy, alwaysVisible: true },
  {
    type: "group",
    label: "Scan Center Management",
    icon: ScanLine,
    items: [
      { href: "/dashboard/patients", label: "Patient", icon: User, key: "patients" },
      { href: "/dashboard/doctors", label: "Doctor", icon: Stethoscope, key: "doctors" },
      { href: "/dashboard/reports", label: "Reports", icon: FileCheck2, key: "vendors" },
      { href: "/dashboard/branches", label: "Branch Management", icon: Building2, key: "settings" },
      { href: "/dashboard/clients", label: "Clients Management", icon: Handshake, key: "vendors" },
    ],
  },
  {
    type: "group",
    label: "Inventory Management",
    icon: Boxes,
    items: [
      { href: "/dashboard/stock/dental", label: "Dental Stock", icon: Smile, key: "stock" },
      { href: "/dashboard/stock/dental-orders", label: "Dental Stock Orders", icon: ShoppingBag, key: "stock" },
      { href: "/dashboard/stock/el3awama", label: "El3awama Stock", icon: Package, key: "stock" },
    ],
  },
  {
    type: "group",
    label: "HR Management",
    icon: Users,
    items: [
      { href: "/dashboard/hr", label: "Employee Management", icon: UserPlus, key: "hr" },
      { href: "/dashboard/hr/payslips", label: "Payslips", icon: Receipt, key: "hr" },
      { href: "/dashboard/hr/deductions", label: "Deductions and Excuses", icon: ClipboardList, key: "hr" },
      { href: "/dashboard/cash-expenses", label: "Employee Advances", icon: Wallet, key: "cash_expenses" },
    ],
  },
  {
    type: "group",
    label: "Expenses Management",
    icon: Banknote,
    items: [
      { href: "/dashboard/expenses/scan", label: "Scan Cash", icon: Banknote, key: "expenses_scan" },
      { href: "/dashboard/expenses/dental-stock", label: "Dental Stock Cash", icon: Banknote, key: "expenses_dental_stock" },
      { href: "/dashboard/expenses/el3awama-stock", label: "El3awama Stock Cash", icon: Banknote, key: "expenses_el3awama_stock" },
      // Cross-brand by nature (moves money between two brands) and always
      // admin-confirmed, so it sits outside the per-brand permission model -
      // adminOnly, not grantable via a permission key, same pattern as the
      // Confirmation Queue right below it.
      { href: "/dashboard/expenses/brand-transfer", label: "Brand Transfer", icon: ArrowLeftRight, adminOnly: true },
      // Debt collection spans every brand (one customer can owe more than one
      // business), so it is gated on the reception/stock permissions the API
      // route already checks rather than a per-brand key.
      { href: "/dashboard/counter-sale", label: "Counter Sale", icon: Banknote, key: "reception" },
      { href: "/dashboard/debt-collection", label: "Debt Collection", icon: Banknote, key: "reception" },
    ],
  },
  { type: "link", href: "/dashboard/exports", label: "Export Centre", icon: Download, adminOnly: true },
  { type: "link", href: "/dashboard/settings", label: "Settings", icon: SettingsIcon, key: "settings" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { can, profile, loading, linkedEmployeeId, isAdmin } = usePermissions();
  const [isNarrowScreen, setIsNarrowScreen] = useState(false);
  const [manuallyCollapsed, setManuallyCollapsed] = useState(false);
  const [switchingPortal, setSwitchingPortal] = useState(false);

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

  async function handleOpenEmployeeDashboard() {
    setSwitchingPortal(true);
    const { data: session } = await supabase.auth.getSession();
    const res = await fetch("/api/staff/employee-portal-link", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.session?.access_token}` },
    });
    setSwitchingPortal(false);
    if (!res.ok) {
      alert("Could not open your employee dashboard.");
      return;
    }
    window.open("/portal/employee", "_blank");
  }

  const collapsed = isNarrowScreen || manuallyCollapsed;

  // An item is visible if: it's still loading (avoid a flash of nothing
  // while permissions load), OR it's adminOnly and this user is admin, OR
  // its permission key is granted. For a group, only children that pass this
  // check are shown, and the whole group hides if none do.
  function isVisible(navItem) {
    if (loading) return true;
    if (navItem.alwaysVisible) return true;
    if (navItem.adminOnly) return isAdmin;
    return can(navItem.key);
  }
  const visibleNav = NAV.map((item) => {
    if (item.type === "link") {
      return isVisible(item) ? item : null;
    }
    const visibleItems = item.items.filter(isVisible);
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
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
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
                  <item.icon size={13} strokeWidth={2.5} />
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
        <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{profile.name}</div>
          <div
            style={{
              display: "inline-block",
              marginTop: 4,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.5,
              textTransform: "uppercase",
              padding: "2px 8px",
              borderRadius: 999,
              background: profile.role === "admin" ? theme.gold : "rgba(255,255,255,0.15)",
              color: profile.role === "admin" ? theme.navy : "#fff",
            }}
          >
            {profile.role}
          </div>
        </div>
      )}
      {linkedEmployeeId && !collapsed && (
        <button
          onClick={handleOpenEmployeeDashboard}
          disabled={switchingPortal}
          title="Open your own employee portal in a new tab"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.2)",
            color: "#fff",
            borderRadius: 8,
            padding: "9px 12px",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
            width: "100%",
            marginBottom: 8,
          }}
        >
          <ExternalLink size={13} />
          {switchingPortal ? "Opening..." : "Employee Dashboard"}
        </button>
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
        {collapsed ? <LogOut size={16} /> : (
          <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <LogOut size={14} /> Log Out
          </span>
        )}
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
      <item.icon size={collapsed ? 20 : 16} strokeWidth={2} />
      {!collapsed && item.label}
    </Link>
  );
}
