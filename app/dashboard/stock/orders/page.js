"use client";
import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import DentalOrdersPanel from "../../../../components/orders/DentalOrdersPanel";
import El3awamaOrdersPanel from "../../../../components/orders/El3awamaOrdersPanel";
import { theme } from "../../../../lib/theme";

// One Stock Orders screen for both businesses, mirroring Stock Details. The
// chosen stock is in the URL so the Counter Sale button below can hand the same
// choice on, and so a link can point straight at one side.
const STOCKS = [
  { key: "dental", label: "Dental Orders" },
  { key: "el3awama", label: "El3awama Orders" },
];

function OrdersInner() {
  const params = useSearchParams();
  const router = useRouter();
  const fromUrl = params.get("stock");
  const [stock, setStock] = useState(STOCKS.some((s) => s.key === fromUrl) ? fromUrl : "dental");

  function choose(key) {
    setStock(key);
    router.replace(`/dashboard/stock/orders?stock=${key}`, { scroll: false });
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        {STOCKS.map((s) => (
          <button
            key={s.key}
            onClick={() => choose(s.key)}
            style={{
              padding: "10px 22px",
              borderRadius: 10,
              border: `1px solid ${stock === s.key ? theme.navy : "#ddd"}`,
              background: stock === s.key ? theme.navy : "#fff",
              color: stock === s.key ? "#fff" : theme.navy,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {s.label}
          </button>
        ))}
        {/* Counter Sale left the sidebar and lives here instead. It carries the
            stock currently being viewed, so opening it from Dental Orders lands
            on the dental counter rather than making the choice twice. */}
        <Link
          href={`/dashboard/counter-sale?stock=${stock}`}
          style={{
            marginLeft: "auto",
            padding: "10px 22px",
            borderRadius: 10,
            border: "none",
            background: `linear-gradient(135deg, ${theme.gold}, ${theme.goldLight})`,
            color: theme.navy,
            fontWeight: 700,
            textDecoration: "none",
          }}
        >
          + Counter Sale
        </Link>
      </div>
      {stock === "dental" ? <DentalOrdersPanel /> : <El3awamaOrdersPanel />}
    </>
  );
}

export default function StockOrdersPage() {
  return (
    <Suspense fallback={null}>
      <OrdersInner />
    </Suspense>
  );
}
