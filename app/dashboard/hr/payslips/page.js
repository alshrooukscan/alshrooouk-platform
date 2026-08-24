"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import { formatMoney } from "../../../../lib/format";
import { exportToCsv } from "../../../../lib/exportCsv";

function monthInputToPeriod(monthValue) {
  // <input type="month"> gives "YYYY-MM" - convert to the "Month YYYY" string
  // format generate_payslip() actually stores in payroll_runs.period.
  if (!monthValue) return "";
  const [year, month] = monthValue.split("-").map(Number);
  const d = new Date(year, month - 1, 1);
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}

export default function PayslipsPage() {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [monthValue, setMonthValue] = useState(defaultMonth);
  const [payslips, setPayslips] = useState([]);
  const [loading, setLoading] = useState(true);

  const period = monthInputToPeriod(monthValue);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthValue]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("payroll_runs")
      .select("*, employees(name, hr_id, role)")
      .eq("period", period)
      .order("generated_at", { ascending: false });
    setPayslips(data || []);
    setLoading(false);
  }

  const totalNet = payslips.reduce((sum, p) => sum + Number(p.net_total || 0), 0);
  const totalDeductions = payslips.reduce(
    (sum, p) => sum + (p.deductions || []).reduce((s, d) => s + Number(d.amount || 0), 0),
    0
  );

  return (
    <div>
      <p style={{ fontSize: 12, color: theme.gray, margin: "0 0 4px" }}>
        <Link href="/dashboard/hr" style={{ color: theme.gray }}>HR Management</Link> &gt; Payslips
      </p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ color: theme.navy, margin: 0 }}>Payslips</h1>
          <p style={{ color: theme.gray, margin: "4px 0 0" }}>Every payslip generated for the selected month.</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="month"
            value={monthValue}
            onChange={(e) => setMonthValue(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14 }}
          />
          {payslips.length > 0 && (
            <button
              onClick={() =>
                exportToCsv(
                  `payslips-${period.replace(" ", "-")}.csv`,
                  payslips.map((p) => ({
                    Employee: p.employees?.name,
                    "HR ID": p.employees?.hr_id,
                    "Fixed Salary": p.fixed_salary,
                    "Variable Salary": p.variable_salary,
                    Deductions: (p.deductions || []).reduce((s, d) => s + Number(d.amount || 0), 0),
                    "Net Total": p.net_total,
                  }))
                )
              }
              style={{ padding: "10px 20px", borderRadius: 8, border: `1px solid ${theme.navy}`, background: "#fff", color: theme.navy, fontWeight: 700, cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" }}
            >
              Export CSV
            </button>
          )}
        </div>
      </div>

      {payslips.length > 0 && (
        <div style={{ display: "flex", gap: 24, marginBottom: 20 }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: "14px 20px", boxShadow: "0 2px 10px rgba(39,33,77,0.05)" }}>
            <div style={{ fontSize: 11, color: theme.gray }}>PAYSLIPS THIS MONTH</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: theme.navy }}>{payslips.length}</div>
          </div>
          <div style={{ background: "#fff", borderRadius: 12, padding: "14px 20px", boxShadow: "0 2px 10px rgba(39,33,77,0.05)" }}>
            <div style={{ fontSize: 11, color: theme.gray }}>TOTAL NET PAID</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: theme.navy }}>{formatMoney(totalNet)} EGP</div>
          </div>
          <div style={{ background: "#fff", borderRadius: 12, padding: "14px 20px", boxShadow: "0 2px 10px rgba(39,33,77,0.05)" }}>
            <div style={{ fontSize: 11, color: theme.gray }}>TOTAL DEDUCTIONS</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: theme.navy }}>{formatMoney(totalDeductions)} EGP</div>
          </div>
        </div>
      )}

      <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#faf9fb", textAlign: "left" }}>
              <Th>Employee</Th>
              <Th>Role</Th>
              <Th>Fixed</Th>
              <Th>Variable</Th>
              <Th>Deductions</Th>
              <Th>Net Total</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {payslips.map((p) => {
              const deductionTotal = (p.deductions || []).reduce((s, d) => s + Number(d.amount || 0), 0);
              return (
                <tr key={p.id} style={{ borderTop: "1px solid #f0f0f0" }}>
                  <Td>
                    <Link href={`/dashboard/hr/${p.employee_id}`} style={{ color: theme.navy, fontWeight: 600, textDecoration: "none" }}>
                      {p.employees?.name}
                    </Link>
                    <div style={{ fontSize: 11, color: theme.gray }}>{p.employees?.hr_id}</div>
                  </Td>
                  <Td>{p.employees?.role || "\u2014"}</Td>
                  <Td>{formatMoney(p.fixed_salary)}</Td>
                  <Td>{formatMoney(p.variable_salary)}</Td>
                  <Td>
                    {deductionTotal > 0 ? (
                      <span title={(p.deductions || []).map((d) => `${d.name}: ${d.amount}`).join(", ")}>
                        {formatMoney(deductionTotal)}
                      </span>
                    ) : (
                      "\u2014"
                    )}
                  </Td>
                  <Td>
                    <span style={{ fontWeight: 700, color: theme.navy }}>{formatMoney(p.net_total)} EGP</span>
                  </Td>
                  <Td>
                    <Link href={`/dashboard/hr/${p.employee_id}`} style={{ fontSize: 12, color: theme.gold, fontWeight: 600, textDecoration: "none" }}>
                      View
                    </Link>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && payslips.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: theme.gray }}>No payslips generated yet for {period}.</div>
        )}
      </div>
    </div>
  );
}

function Th({ children }) {
  return <th style={{ padding: "12px 16px", fontSize: 11, color: theme.gray, fontWeight: 700, textTransform: "uppercase" }}>{children}</th>;
}
function Td({ children }) {
  return <td style={{ padding: "12px 16px", color: theme.navy }}>{children}</td>;
}
