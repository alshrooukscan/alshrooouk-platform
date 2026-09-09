"use client";
import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import StockCategoryPage from "../../../components/StockCategoryPage";
import { theme } from "../../../lib/theme";

// Dental and El3awama used to be two sidebar entries and two routes. They are
// the same screen against a different set of items, so they are now one page
// with a switch. The chosen stock lives in the URL (?stock=el3awama), which
// keeps links, refreshes and the back button working, and lets other pages -
// Stock Orders in particular - open this page already on the right stock.
const STOCKS = [
  { key: "dental", label: "Dental Supply" },
  { key: "el3awama", label: "El3awama F&B" },
];

function StockDetailsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const fromUrl = params.get("stock");
  const [stock, setStock] = useState(STOCKS.some((s) => s.key === fromUrl) ? fromUrl : "dental");
  const current = STOCKS.find((s) => s.key === stock);

  function choose(key) {
    setStock(key);
    router.replace(`/dashboard/stock?stock=${key}`, { scroll: false });
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
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
      </div>
      <StockCategoryPage key={stock} category={stock} title={current.label} />
    </>
  );
}

export default function StockDetailsPage() {
  // useSearchParams needs a Suspense boundary to prerender.
  return (
    <Suspense fallback={null}>
      <StockDetailsInner />
    </Suspense>
  );
}
