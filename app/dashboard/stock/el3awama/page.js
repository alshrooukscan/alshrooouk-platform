"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Merged into the single Stock Details page. Kept as a redirect so existing
// bookmarks and any links already sent to staff still land in the right place.
export default function Redirectel3awama() {
  const router = useRouter();
  useEffect(() => { router.replace("/dashboard/stock?stock=el3awama"); }, [router]);
  return null;
}
