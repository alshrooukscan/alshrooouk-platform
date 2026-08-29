"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Folded into Action Center - this route now just forwards anyone with an
// old link or bookmark rather than leaving a dead page or a 404 behind.
export default function ConfirmationQueueRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/action-center");
  }, [router]);
  return null;
}
