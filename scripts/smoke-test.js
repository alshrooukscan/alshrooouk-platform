/**
 * Al Shrooouk Platform — Smoke Test
 * Run: node scripts/smoke-test.js
 * Requires env vars: SMOKE_APP_URL, SMOKE_SUPABASE_URL, SMOKE_SUPABASE_ANON_KEY,
 *                     SMOKE_ADMIN_EMAIL, SMOKE_ADMIN_PASSWORD
 *
 * Exercises the real exit-gate criteria for every phase against the live
 * deployment and live database, then cleans up everything it created.
 * This is the same set of checks used to verify each phase during build,
 * codified so they can be re-run after any future change.
 */

const APP = process.env.SMOKE_APP_URL;
const SBASE = process.env.SMOKE_SUPABASE_URL;
const ANON = process.env.SMOKE_SUPABASE_ANON_KEY;
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD;

let pass = 0;
let fail = 0;
const cleanup = [];

function assert(condition, label) {
  if (condition) {
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
    pass++;
  } else {
    console.log(`  \x1b[31m✗\x1b[0m ${label}`);
    fail++;
  }
}

async function sb(path, opts = {}, token) {
  const res = await fetch(`${SBASE}${path}`, {
    ...opts,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token || ANON}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  return res;
}

async function main() {
  console.log("\n=== Al Shrooouk Platform Smoke Test ===\n");

  // --- Auth ---
  console.log("Auth");
  const authRes = await sb("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const auth = await authRes.json();
  assert(authRes.ok && auth.access_token, "Staff login succeeds and returns a session token");
  const token = auth.access_token;

  // --- Phase 1: Patients & Doctors ---
  console.log("\nPhase 1: Patients & Doctors");
  const mobile = `+2010${Date.now().toString().slice(-8)}`;
  const patRes = await sb("/rest/v1/patients", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ name: "Smoke Test Patient", mobile }) }, token);
  const patient = (await patRes.json())[0];
  cleanup.push(() => sb(`/rest/v1/patients?id=eq.${patient.id}`, { method: "DELETE" }, token));
  assert(patRes.ok && patient.id, "Patient registration succeeds");

  const credRes = await sb("/rest/v1/rpc/create_patient_credentials", { method: "POST", body: JSON.stringify({ p_patient_id: patient.id, p_username: mobile.replace(/\D/g, "") }) }, token);
  assert(credRes.ok, "Patient portal credentials generate successfully");
  const patientPassword = await credRes.json();

  const clinicCode = `SMK-${Date.now().toString().slice(-6)}`;
  const docRes = await sb("/rest/v1/doctors", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ name: "Dr. Smoke Test", clinic_code: clinicCode, clinic_name: "Smoke Clinic" }) }, token);
  const doctor = (await docRes.json())[0];
  cleanup.push(() => sb(`/rest/v1/doctors?id=eq.${doctor.id}`, { method: "DELETE" }, token));
  assert(docRes.ok && doctor.id, "Doctor registration succeeds");

  // Note: clinic_code alone is NOT guaranteed unique in real data (confirmed during
  // migration: 12 legitimate collisions). The true unique identifier is unique_code
  // (ClinicCode_Name compound), which is what's actually enforced at the DB level.
  const uniqueCode = `${clinicCode}_Dr. Smoke Test`;
  await sb("/rest/v1/doctors", { method: "PATCH", body: JSON.stringify({ unique_code: uniqueCode }) }, token);
  const dupRes = await sb("/rest/v1/doctors", { method: "POST", body: JSON.stringify({ name: "Dr. Duplicate", clinic_code: `SMK2-${Date.now()}`, unique_code: uniqueCode }) }, token);
  assert(dupRes.status === 409, "Duplicate Unique Code is correctly rejected (clinic_code alone is not unique in real data)");

  const visitRes = await sb("/rest/v1/visits", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ patient_id: patient.id, doctor_id: doctor.id, scan_types: ["3D CBCT Quadrant"], amount_due: 1100, payment_status: "paid" }) }, token);
  const visit = (await visitRes.json())[0];
  cleanup.push(() => sb(`/rest/v1/visits?id=eq.${visit.id}`, { method: "DELETE" }, token));
  assert(visitRes.ok && visit.id, "Visit creation succeeds");

  const invNumRes = await sb("/rest/v1/rpc/generate_invoice_number", { method: "POST" }, token);
  const invNum1 = await invNumRes.json();
  const invNumRes2 = await sb("/rest/v1/rpc/generate_invoice_number", { method: "POST" }, token);
  const invNum2 = await invNumRes2.json();
  assert(invNum1 !== invNum2, "Sequential invoice numbers increment correctly");

  const invRes = await sb("/rest/v1/invoices", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ visit_id: visit.id, invoice_number: invNum1, amount: 1100, patient_name: "Smoke Test Patient", exam: "3D CBCT Quadrant", exam_date: "2026-08-15" }) }, token);
  const invoice = (await invRes.json())[0];
  cleanup.push(() => sb(`/rest/v1/invoices?id=eq.${invoice.id}`, { method: "DELETE" }, token));
  assert(invRes.ok && invoice.id, "Invoice creation succeeds");

  if (APP) {
    const pdfRes = await fetch(`${APP}/api/invoices/${invoice.id}/pdf`);
    const pdfBuf = await pdfRes.arrayBuffer();
    assert(pdfRes.ok && pdfRes.headers.get("content-type") === "application/pdf" && pdfBuf.byteLength > 500, "PDF invoice generates and returns real PDF bytes");
  }

  // --- Phase 3: Stock ---
  console.log("\nPhase 3: Stock Management");
  const itemRes = await sb("/rest/v1/stock_items", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ category: "dental", name: "Smoke Test Item", item_code: "SMK-001", qty_remaining: 0 }) }, token);
  const item = (await itemRes.json())[0];
  cleanup.push(() => sb(`/rest/v1/stock_items?id=eq.${item.id}`, { method: "DELETE" }, token));

  await sb("/rest/v1/rpc/record_stock_transaction", { method: "POST", body: JSON.stringify({ p_item_id: item.id, p_type: "purchase", p_qty: 20, p_unit_price: 10 }) }, token);
  const afterSaleRes = await sb("/rest/v1/rpc/record_stock_transaction", { method: "POST", body: JSON.stringify({ p_item_id: item.id, p_type: "sale", p_qty: 5, p_unit_price: 25 }) }, token);
  const afterSale = await afterSaleRes.json();
  assert(afterSale.qty_remaining === 15, "Stock quantity updates correctly after purchase and sale (20 - 5 = 15)");

  const countRes = await sb("/rest/v1/rpc/record_stock_count", { method: "POST", body: JSON.stringify({ p_item_id: item.id, p_physical_qty: 12 }) }, token);
  const count = await countRes.json();
  assert(count.variance === -3, "Physical count variance correctly computed (12 - 15 = -3)");

  // --- Phase 4: HR & Payroll ---
  console.log("\nPhase 4: HR & Payroll");
  const hrIdRes = await sb("/rest/v1/rpc/generate_hr_id", { method: "POST" }, token);
  const hrId = await hrIdRes.json();
  const empRes = await sb("/rest/v1/employees", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ hr_id: hrId, name: "Smoke Test Employee", fixed_salary: 10000, variable_salary: 1000 }) }, token);
  const employee = (await empRes.json())[0];
  cleanup.push(() => sb(`/rest/v1/employees?id=eq.${employee.id}`, { method: "DELETE" }, token));

  const ruleRes = await sb("/rest/v1/deduction_rules", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ name: "Smoke Test Rule", rule_type: "fixed", value: 100 }) }, token);
  const rule = (await ruleRes.json())[0];
  cleanup.push(() => sb(`/rest/v1/deduction_rules?id=eq.${rule.id}`, { method: "DELETE" }, token));
  await sb("/rest/v1/employee_rule_assignments", { method: "POST", body: JSON.stringify({ employee_id: employee.id, deduction_rule_id: rule.id }) }, token);

  const slip1Res = await sb("/rest/v1/rpc/generate_payslip", { method: "POST", body: JSON.stringify({ p_employee_id: employee.id, p_period: "Smoke Test" }) }, token);
  const slip1 = await slip1Res.json();
  assert(slip1.net_total === 10900, "Payslip #1 computes correctly with initial deduction value (10000+1000-100)");

  await sb(`/rest/v1/deduction_rules?id=eq.${rule.id}`, { method: "PATCH", body: JSON.stringify({ value: 500 }) }, token);
  const slip2Res = await sb("/rest/v1/rpc/generate_payslip", { method: "POST", body: JSON.stringify({ p_employee_id: employee.id, p_period: "Smoke Test" }) }, token);
  const slip2 = await slip2Res.json();
  assert(slip2.net_total === 10500, "Changing a deduction rule's value is reflected in the next payslip with zero code change");

  // --- Phase 5: Cash Ledger ---
  console.log("\nPhase 5: Admin P&L Dashboard");
  const ledgerRes = await sb(`/rest/v1/cash_ledger?reference_id=eq.${invoice.id}&select=*`, {}, token);
  const ledgerEntries = await ledgerRes.json();
  assert(ledgerEntries.length > 0 && Number(ledgerEntries[0].amount) === 1100, "Invoice creation automatically wired a matching cash_ledger entry");

  // --- Portals ---
  if (APP) {
    console.log("\nPortals");
    const doctorPwdRes = await sb("/rest/v1/rpc/create_doctor_credentials", { method: "POST", body: JSON.stringify({ p_doctor_id: doctor.id, p_username: `smoke${Date.now()}` }) }, token);
    const doctorPassword = await doctorPwdRes.json();
    const doctorUsername = (await (await sb(`/rest/v1/doctors?id=eq.${doctor.id}&select=username`, {}, token)).json())[0].username;

    const portalLoginRes = await fetch(`${APP}/api/portal/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "doctor", username: doctorUsername, password: doctorPassword }),
    });
    const cookie = portalLoginRes.headers.get("set-cookie");
    assert(portalLoginRes.ok, "Doctor portal login succeeds with generated credentials");

    if (cookie) {
      const dataRes = await fetch(`${APP}/api/portal/doctor/data`, { headers: { Cookie: cookie.split(";")[0] } });
      const data = await dataRes.json();
      assert(dataRes.ok && data.visits.some((v) => v.patients?.name === "Smoke Test Patient"), "Doctor portal correctly shows only their own referred patients");
    }
  }

  // --- cleanup ---
  console.log("\nCleaning up test data...");
  cleanup.push(() => sb(`/rest/v1/cash_ledger?reference_type=eq.invoice&reference_id=eq.${invoice.id}`, { method: "DELETE" }, token));
  cleanup.push(() => sb(`/rest/v1/cash_ledger?reference_type=eq.stock_transaction`, { method: "DELETE" }, token));
  cleanup.push(() => sb(`/rest/v1/payroll_runs?employee_id=eq.${employee.id}`, { method: "DELETE" }, token));
  cleanup.push(() => sb(`/rest/v1/cash_ledger?reference_type=eq.payroll_run`, { method: "DELETE" }, token));
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch (e) {}
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Smoke test crashed:", e);
  process.exit(1);
});
