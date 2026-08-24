"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Dental and El3awama Stock are now separate real pages, matching their own
// sidebar entries. This bare route only exists for old bookmarks/links.
export default function StockIndexRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/stock/dental");
  }, [router]);
  return null;
}
