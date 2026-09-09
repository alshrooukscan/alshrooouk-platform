"use client";
import { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import BrandCashPage from "../../../components/BrandCashPage";
import { usePermissions } from "../../../lib/usePermissions";
import { theme } from "../../../lib/theme";

// The three brand cash pages were three sidebar entries showing the same screen
// against a different business. One page with a switch, matching Stock Details
// and Stock Orders.
const BRANDS = [
  { key: "scan", slug: "scan", label: "Scan", permissionKey: "expenses_scan" },
  { key: "dental_stock", slug: "dental-stock", label: "Dental Stock", permissionKey: "expenses_dental_stock" },
  { key: "el3awama_stock", slug: "el3awama-stock", label: "El3awama Stock", permissionKey: "expenses_el3awama_stock" },
];

function BrandsCashInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { can, isAdmin, loading: permsLoading } = usePermissions();

  // Each business is granted separately, and the sidebar used to be what hid
  // one you had no access to. With a single page that job moves here: only the
  // businesses this person can actually see are offered, so nobody is handed a
  // button that opens a refusal.
  const allowed = permsLoading ? BRANDS : BRANDS.filter((b) => isAdmin || can(b.permissionKey));

  const fromUrl = params.get("brand");
  const [brand, setBrand] = useState(fromUrl || null);
  const current = allowed.find((b) => b.slug === brand) || allowed[0];

  useEffect(() => {
    if (!permsLoading && current && brand !== current.slug) setBrand(current.slug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permsLoading, current?.slug]);

  function choose(slug) {
    setBrand(slug);
    router.replace(`/dashboard/expenses?brand=${slug}`, { scroll: false });
  }

  if (permsLoading) return null;
  if (!current) {
    return <p style={{ color: theme.gray }}>You do not have access to any business&apos;s cash.</p>;
  }

  return (
    <>
      {allowed.length > 1 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
          {allowed.map((b) => (
            <button
              key={b.slug}
              onClick={() => choose(b.slug)}
              style={{
                padding: "10px 22px",
                borderRadius: 10,
                border: `1px solid ${current.slug === b.slug ? theme.navy : "#ddd"}`,
                background: current.slug === b.slug ? theme.navy : "#fff",
                color: current.slug === b.slug ? "#fff" : theme.navy,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {b.label} Cash
            </button>
          ))}
        </div>
      )}
      <BrandCashPage
        key={current.key}
        brand={current.key}
        brandLabel={current.label}
        permissionKey={current.permissionKey}
      />
    </>
  );
}

export default function BrandsCashPage() {
  return (
    <Suspense fallback={null}>
      <BrandsCashInner />
    </Suspense>
  );
}
