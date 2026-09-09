// Single source of truth for the permission modules shown wherever staff
// access gets granted (Settings > Staff Users, and HR > Staff Dashboard
// Access on an employee's profile). Labels are the exact names shown in the
// sidebar (components/Sidebar.js), so granting access reads the same as what
// the person will actually see there. Several sidebar items share one
// permission key (e.g. both stock pages, or all three HR pages) - those are
// spelled out together so it's clear one toggle covers all of them.
export const MODULES = [
  { key: "dashboard", label: "Dashboard" },
  { key: "patients", label: "Patient" },
  { key: "doctors", label: "Doctor" },
  { key: "cash_expenses", label: "Employee Advances" },
  { key: "vendors", label: "Clients Management & Reports" },
  { key: "settings", label: "Settings & Branch Management" },
  { key: "stock", label: "Dental Stock & El3awama Stock" },
  { key: "hr", label: "HR Management (Employee Management, Payslips, Deductions and Excuses)" },
  // Note: cash_expenses (Employee Advances) is now grouped under HR Management in the sidebar too.
  // Expenses Management: one permission per brand (not per action within a
  // brand) - having access to a brand covers Cash Out, Cash Transfer, and
  // Cash Collection for it. The real risk this guards against is cross-brand
  // access (someone on Scan touching Dental Stock's cash), not someone
  // needing partial access within a single brand they're already trusted
  // with. Brand Transfer and the Confirmation Queue are admin-only, not
  // grantable here, same as Login As and Delete.
  { key: "expenses_scan", label: "Expenses Management: Scan Cash" },
  { key: "expenses_dental_stock", label: "Expenses Management: Dental Stock Cash" },
  { key: "expenses_el3awama_stock", label: "Expenses Management: El3awama Stock Cash" },
  // The sidebar gates Counter Sale and Debt Collection on "reception", and both
  // pages check it themselves - but the key was never added here, so there was
  // no switch anywhere to turn it on. Both pages were invisible to every
  // non-admin and there was no way to grant them, which is not a permission
  // being withheld so much as a permission that did not exist.
  { key: "reception", label: "Expenses Management: Counter Sale & Debt Collection" },
  // Previously admin-only and therefore ungrantable. Kept off by default:
  // granting this shows one person the cash every OTHER employee is holding,
  // which is a deliberate decision rather than a routine one.
  { key: "cash_monitor", label: "Expenses Management: Cash Monitor (shows every employee's cash)" },
  { key: "internal_purchases", label: "Expenses Management: Internal Purchases between businesses" },
];
