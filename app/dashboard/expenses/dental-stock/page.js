"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Merged into the single Brands Cash page. Kept as a redirect: staff have these
// links, and several WhatsApp messages point at them.
export default function Redirect_dental_stock() {
  const router = useRouter();
  useEffect(() => { router.replace("/dashboard/expenses?brand=dental-stock"); }, [router]);
  return null;
}
