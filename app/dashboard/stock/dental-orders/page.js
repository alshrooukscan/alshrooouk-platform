"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Merged into the single Stock Orders page. Kept as a redirect for bookmarks.
export default function DentalOrdersRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/dashboard/stock/orders?stock=dental"); }, [router]);
  return null;
}
