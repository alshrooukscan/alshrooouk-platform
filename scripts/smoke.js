#!/usr/bin/env node
/*
 * Pre-deploy smoke test.
 *
 * Written after 16 September, when a change that built cleanly and shipped with
 * all its new text present in the bundle still took the employee portal down
 * for every member of staff overnight. A build passing proves the code
 * compiles. It does not prove a page renders, and grepping the bundle for a
 * string proves even less: the string was there, in a file that threw before
 * drawing anything.
 *
 * So this opens the real pages in a real browser and fails on a runtime error.
 * That is the only check that would have caught it.
 *
 * Usage:  node scripts/smoke.js [baseUrl]
 * Exits non-zero if any page crashes, so it can gate a deploy.
 */
const { chromium } = require("playwright");

const BASE = process.argv[2] || "https://shscan.com";

// Every page a member of staff can reach on an ordinary day. Signed out they
// redirect to login, which still exercises the component tree that broke.
const PAGES = [
  "/dashboard",
  "/dashboard/patients",
  "/dashboard/doctors",
  "/dashboard/clients",
  "/dashboard/reports",
  "/dashboard/workflow",
  "/dashboard/action-center",
  "/dashboard/debt-collection",
  "/dashboard/stock",
  "/dashboard/stock/orders",
  "/dashboard/counter-sale",
  "/dashboard/hr",
  "/dashboard/branches",
  "/portal/employee",
  "/portal/client",
  "/portal",
];

(async () => {
  const browser = await chromium.launch();
  const failures = [];

  for (const path of PAGES) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));

    try {
      await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 40000 });
      await page.waitForTimeout(1200);
      const body = (await page.textContent("body")) || "";

      // Next.js prints this when a component throws during render - the exact
      // thing staff saw on 16 September.
      const crashed = body.includes("Application error");

      if (crashed || errors.length) {
        failures.push({ path, crashed, error: errors[0] || "render threw" });
        console.log(`  FAIL  ${path}  ${crashed ? "page crashed" : ""} ${errors[0] || ""}`.trimEnd());
      } else {
        console.log(`  ok    ${path}`);
      }
    } catch (e) {
      failures.push({ path, error: e.message });
      console.log(`  FAIL  ${path}  ${e.message.split("\n")[0]}`);
    }
    await page.close();
  }

  await browser.close();

  console.log("");
  if (failures.length) {
    console.log(`${failures.length} of ${PAGES.length} pages broken. Do not deploy.`);
    process.exit(1);
  }
  console.log(`All ${PAGES.length} pages render.`);
})();
