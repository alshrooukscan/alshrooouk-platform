import { theme } from "../../lib/theme";

export default function DashboardHome() {
  return (
    <div>
      <h1 style={{ color: theme.navy, marginBottom: 4 }}>Staff Overview</h1>
      <p style={{ color: theme.gray, marginBottom: 24 }}>Real-time clinic metrics and recent activity.</p>
      <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        Sprint 1.1 shell is live. Patient search, registration, and the rest of Sprint 1.2 land next.
      </div>
    </div>
  );
}
