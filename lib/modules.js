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
  { key: "cash_expenses", label: "Center Expenses" },
  { key: "vendors", label: "External Vendors" },
  { key: "settings", label: "Settings & Branch Management" },
  { key: "stock", label: "Dental Stock & El3awama Stock" },
  { key: "hr", label: "HR Management (Employee Management, Payslips, Deductions and Excuses)" },
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
];
